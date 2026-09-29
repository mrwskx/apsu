import { describe, expect, it } from 'vitest';

import type { SkillFile, SkillsLock } from './validate-skills.utils';
import {
  extractSkills,
  findLockIssues,
  findMissingSkills,
  findSymlinkIssue,
  hashSkill,
} from './validate-skills.utils';

describe('findSymlinkIssue', () => {
  it('reports not-symlink when .claude/skills is a real directory', () => {
    expect(findSymlinkIssue(null)).toEqual({ kind: 'not-symlink' });
  });

  it('accepts the link the repo actually uses', () => {
    expect(findSymlinkIssue('../.agents/skills')).toBeUndefined();
  });

  it('reports wrong-target when the link points elsewhere', () => {
    expect(findSymlinkIssue('../elsewhere/skills')).toEqual({
      kind: 'wrong-target',
      target: '../elsewhere/skills',
    });
  });

  it('normalises the target rather than comparing it as a string', () => {
    expect(findSymlinkIssue('../.agents/skills/')).toBeUndefined();
    expect(findSymlinkIssue('../.agents/../.agents/skills')).toBeUndefined();
  });
});

describe('extractSkills', () => {
  it('extracts skill names from table rows', () => {
    const markdown = '| `grilling` | "grill me" |\n| `tdd` | "test-first" |';

    expect(extractSkills(markdown)).toEqual(['grilling', 'tdd']);
  });

  it('tolerates the cell padding Prettier adds to aligned tables', () => {
    expect(extractSkills('|   `tdd`   | "test-first" |')).toEqual(['tdd']);
  });

  it('ignores table cells that are not backtick-wrapped', () => {
    const markdown = '| tdd | "test-first" |\n| `research` | "look up" |';

    expect(extractSkills(markdown)).toEqual(['research']);
  });

  it('ignores names containing uppercase letters', () => {
    expect(extractSkills('| `NotASkill` | x |\n| `open-pr` | y |')).toEqual([
      'open-pr',
    ]);
  });

  it('returns an empty array when no skill rows are present', () => {
    expect(extractSkills('# Heading\n\n| Skill | Trigger |')).toEqual([]);
  });
});

describe('findMissingSkills', () => {
  it('returns nothing when every documented skill has a SKILL.md', () => {
    expect(findMissingSkills(['tdd'], () => true)).toEqual([]);
  });

  it('reports the path it expected the skill to live at', () => {
    expect(findMissingSkills(['tdd'], () => false)).toEqual([
      { skill: 'tdd', path: '.claude/skills/tdd/SKILL.md' },
    ]);
  });

  it('reports only the skills that are absent', () => {
    const present = new Set(['.claude/skills/research/SKILL.md']);

    expect(
      findMissingSkills(['tdd', 'research'], path => present.has(path)),
    ).toEqual([{ skill: 'tdd', path: '.claude/skills/tdd/SKILL.md' }]);
  });

  it('returns nothing when no skills are documented', () => {
    expect(findMissingSkills([], () => false)).toEqual([]);
  });
});

describe('hashSkill', () => {
  const files: [SkillFile, SkillFile] = [
    { path: 'SKILL.md', content: '# Skill' },
    { path: 'scripts/run.sh', content: 'echo hi' },
  ];

  it('is stable across input ordering', () => {
    expect(hashSkill(files)).toEqual(hashSkill([...files].reverse()));
  });

  it("changes when a file's content changes", () => {
    const edited = [{ path: 'SKILL.md', content: '# Skill ' }, files[1]];

    expect(hashSkill(edited)).not.toEqual(hashSkill(files));
  });

  it('changes when a file is deleted', () => {
    expect(hashSkill([files[0]])).not.toEqual(hashSkill(files));
  });

  it('changes when a file is renamed', () => {
    const renamed = [files[0], { path: 'scripts/go.sh', content: 'echo hi' }];

    expect(hashSkill(renamed)).not.toEqual(hashSkill(files));
  });

  it('does not confuse a path boundary with content', () => {
    expect(hashSkill([{ path: 'ab', content: 'c' }])).not.toEqual(
      hashSkill([{ path: 'a', content: 'bc' }]),
    );
  });
});

describe('findLockIssues', () => {
  const lock: SkillsLock = {
    version: 2,
    skills: {
      tdd: {
        source: 'mattpocock/skills',
        path: 'skills/engineering/tdd',
        hash: 'aaa',
      },
    },
    local: ['implement'],
  };

  it('passes when every directory matches the lock', () => {
    expect(findLockIssues({ tdd: 'aaa', implement: 'zzz' }, lock)).toEqual([]);
  });

  it('flags a locked skill whose directory hash has changed', () => {
    expect(findLockIssues({ tdd: 'bbb', implement: 'zzz' }, lock)).toEqual([
      { kind: 'hash-mismatch', skill: 'tdd' },
    ]);
  });

  it('ignores edits to a skill named in local', () => {
    expect(findLockIssues({ tdd: 'aaa', implement: 'yyy' }, lock)).toEqual([]);
  });

  it('flags a directory in neither list', () => {
    expect(
      findLockIssues({ tdd: 'aaa', implement: 'zzz', stray: 'ccc' }, lock),
    ).toEqual([{ kind: 'unaccounted', skill: 'stray' }]);
  });

  it('flags a locked entry with no directory', () => {
    expect(findLockIssues({ implement: 'zzz' }, lock)).toEqual([
      { kind: 'orphan-entry', skill: 'tdd' },
    ]);
  });

  it('flags a local entry with no directory', () => {
    expect(findLockIssues({ tdd: 'aaa' }, lock)).toEqual([
      { kind: 'orphan-entry', skill: 'implement' },
    ]);
  });
});
