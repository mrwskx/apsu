import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export const SKILLS_DIR = '.agents/skills';
export const CLAUDE_SKILLS_DIR = '.claude/skills';

// Tolerates the cell padding Prettier adds when it aligns Markdown tables.
const SKILL_ROW = /\|[ \t]*`([a-z-]+)`[ \t]*\|/g;

export function extractSkills(markdown: string): string[] {
  return [...markdown.matchAll(SKILL_ROW)]
    .map((match): string | undefined => match[1])
    .filter(skill => skill !== undefined);
}

export interface MissingSkill {
  skill: string;
  path: string;
}

export function findMissingSkills(
  skills: string[],
  exists: (path: string) => boolean,
): MissingSkill[] {
  return skills
    .map(skill => ({ skill, path: `${CLAUDE_SKILLS_DIR}/${skill}/SKILL.md` }))
    .filter(({ path }) => !exists(path));
}

export type SymlinkIssue =
  { kind: 'not-symlink' } | { kind: 'wrong-target'; target: string };

export function findSymlinkIssue(
  target: string | null,
): SymlinkIssue | undefined {
  if (target === null) {
    return { kind: 'not-symlink' };
  }

  // Both directories sit at the repo root, so the link target is resolved
  // relative to .claude/ — the directory the symlink itself lives in.
  if (resolve(dirname(CLAUDE_SKILLS_DIR), target) !== resolve(SKILLS_DIR)) {
    return { kind: 'wrong-target', target };
  }

  return undefined;
}

// ── skills-lock.json v2 ──────────────────────────────────────────────────────

export interface LockedSkill {
  source: string;
  path?: string;
  version?: string;
  hash: string;
}

export interface SkillsLock {
  version: number;
  // Indexing a parsed lock can miss, so the value is optional.
  skills: Record<string, LockedSkill | undefined>;
  local: string[];
}

export interface SkillFile {
  path: string;
  content: string;
}

// A per-file hash cannot notice a file deleted upstream, so the lock covers the
// whole directory: every path relative to it, sorted, with its contents. NUL
// separates the fields because no path or file we vendor contains one.
export function hashSkill(files: SkillFile[]): string {
  const hash = createHash('sha256');

  for (const { path, content } of [...files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    hash.update(`${path}\0${content}\0`);
  }

  return hash.digest('hex');
}

export type LockIssue =
  | { kind: 'unaccounted'; skill: string }
  | { kind: 'hash-mismatch'; skill: string }
  | { kind: 'orphan-entry'; skill: string };

export const LOCK_ISSUE_TEXT: Record<
  LockIssue['kind'],
  { label: string; remedy: string }
> = {
  unaccounted: {
    label: 'Unaccounted skill',
    remedy: 'add it to `skills` or `local` in skills-lock.json',
  },
  'hash-mismatch': {
    label: 'Locked skill modified',
    remedy:
      're-vendor it, or update its hash in skills-lock.json if the edit is deliberate',
  },
  'orphan-entry': {
    label: 'Lock entry with no directory',
    remedy: 'remove it from skills-lock.json',
  },
};

// `hashes` is one entry per directory in .agents/skills, keyed by skill name.
export function findLockIssues(
  hashes: Record<string, string>,
  lock: SkillsLock,
): LockIssue[] {
  const local = new Set(lock.local);
  const issues: LockIssue[] = [];

  for (const [skill, hash] of Object.entries(hashes)) {
    const locked = lock.skills[skill];

    if (locked) {
      if (locked.hash !== hash) {
        issues.push({ kind: 'hash-mismatch', skill });
      }
    } else if (!local.has(skill)) {
      issues.push({ kind: 'unaccounted', skill });
    }
  }

  for (const skill of [...Object.keys(lock.skills), ...lock.local]) {
    if (!(skill in hashes)) {
      issues.push({ kind: 'orphan-entry', skill });
    }
  }

  return issues;
}
