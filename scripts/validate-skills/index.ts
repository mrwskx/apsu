import { access, lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { SkillsLock } from './validate-skills.utils';
import {
  CLAUDE_SKILLS_DIR,
  extractSkills,
  findLockIssues,
  findMissingSkills,
  findSymlinkIssue,
  hashSkill,
  LOCK_ISSUE_TEXT,
  SKILLS_DIR,
} from './validate-skills.utils';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const claudeMd = await readFile('CLAUDE.md', 'utf-8');

// The Skills tables are a routing table for model-invoked skills, not an
// inventory: user-invoked and generic skills are deliberately unlisted, so only
// what the tables name is checked.
const documented = extractSkills(claudeMd);

// findMissingSkills takes a synchronous predicate so it stays pure and trivially
// testable; resolve the filesystem answers up front and hand it a lookup.
const presentPaths = new Set(
  (
    await Promise.all(
      documented.map(async skill => {
        const path = `${CLAUDE_SKILLS_DIR}/${skill}/SKILL.md`;
        return (await exists(path)) ? path : undefined;
      }),
    )
  ).filter(path => path !== undefined),
);
const missing = findMissingSkills(documented, path => presentPaths.has(path));

// A single directory symlink, not one per skill: .claude/skills -> ../.agents/skills.
const stats = await lstat(CLAUDE_SKILLS_DIR);
const symlinkIssue = findSymlinkIssue(
  stats.isSymbolicLink() ? await readlink(CLAUDE_SKILLS_DIR) : null,
);

// One walk of .agents/skills, one hash per directory. Any further
// reconciliation against skills-lock.json reads these rather than walking again.
const skillDirs = await readdir(SKILLS_DIR);
const hashes = Object.fromEntries(
  await Promise.all(
    skillDirs.map(async (skill): Promise<[string, string]> => {
      const dir = join(SKILLS_DIR, skill);
      const entries = await readdir(dir, {
        recursive: true,
        withFileTypes: true,
      });

      return [
        skill,
        hashSkill(
          await Promise.all(
            entries
              .filter(entry => entry.isFile())
              .map(async entry => {
                const full = join(entry.parentPath, entry.name);
                return {
                  path: relative(dir, full),
                  content: await readFile(full, 'utf-8'),
                };
              }),
          ),
        ),
      ];
    }),
  ),
);
const lock = JSON.parse(
  await readFile('skills-lock.json', 'utf-8'),
) as SkillsLock;
const lockIssues = findLockIssues(hashes, lock);

for (const { skill, path } of missing) {
  console.error(`Missing: ${skill} → ${path}`);
}
if (symlinkIssue?.kind === 'not-symlink') {
  console.error(`Not a symlink: ${CLAUDE_SKILLS_DIR} → ${SKILLS_DIR}`);
}
if (symlinkIssue?.kind === 'wrong-target') {
  console.error(
    `Wrong symlink target: ${CLAUDE_SKILLS_DIR} → ${symlinkIssue.target}, expected ${SKILLS_DIR}`,
  );
}

for (const { kind, skill } of lockIssues) {
  const { label, remedy } = LOCK_ISSUE_TEXT[kind];
  console.error(`${label}: ${skill} — ${remedy}`);
}

const total = missing.length + (symlinkIssue ? 1 : 0) + lockIssues.length;
if (total > 0) {
  throw new Error(`${total.toFixed()} issue(s) found.`);
}

console.log(
  `All ${documented.length.toFixed()} documented skills present. Symlink in sync. ` +
    `${skillDirs.length.toFixed()} skill directories locked or declared local.`,
);
