import { describe, it, expect } from 'vitest';
import {
  parseCC,
  formatDescription,
  isBreaking,
  getSection,
  formatEntry,
  groupBySection,
  generateOverview,
  deriveIssueRef,
  resolveIssueRef,
} from './generate-pr-description.utils';
import type { Commit } from './generate-pr-description.utils';

// ── helpers ──────────────────────────────────────────────────────────────────

const commit = (overrides: Partial<Commit> = {}): Commit => ({
  hash: 'abc1234',
  type: 'feat',
  scope: '',
  breaking: false,
  description: 'Add login.',
  body: '',
  commitUrl: 'https://github.com/org/repo/commit/abc1234',
  ...overrides,
});

// ── parseCC ──────────────────────────────────────────────────────────────────

describe('parseCC', () => {
  it('parses type and description', () => {
    expect(parseCC('feat: add login')).toEqual({
      type: 'feat',
      scope: '',
      breakingBang: false,
      rawDesc: 'add login',
    });
  });

  it('parses type, scope, and description', () => {
    expect(parseCC('fix(auth): correct token expiry')).toEqual({
      type: 'fix',
      scope: 'auth',
      breakingBang: false,
      rawDesc: 'correct token expiry',
    });
  });

  it('parses breaking bang without scope', () => {
    expect(parseCC('feat!: drop legacy api')).toEqual({
      type: 'feat',
      scope: '',
      breakingBang: true,
      rawDesc: 'drop legacy api',
    });
  });

  it('parses breaking bang with scope', () => {
    expect(parseCC('feat(api)!: remove v1 endpoints')).toEqual({
      type: 'feat',
      scope: 'api',
      breakingBang: true,
      rawDesc: 'remove v1 endpoints',
    });
  });

  it('returns empty type for non-CC subject', () => {
    expect(parseCC('update readme')).toEqual({
      type: '',
      scope: '',
      breakingBang: false,
      rawDesc: 'update readme',
    });
  });

  it('preserves colons in description', () => {
    expect(parseCC('fix: handle error: timeout')).toEqual({
      type: 'fix',
      scope: '',
      breakingBang: false,
      rawDesc: 'handle error: timeout',
    });
  });
});

// ── formatDescription ────────────────────────────────────────────────────────

describe('formatDescription', () => {
  it('capitalizes first letter and adds period', () => {
    expect(formatDescription('add login')).toBe('Add login.');
  });

  it('does not double-add period', () => {
    expect(formatDescription('add login.')).toBe('Add login.');
  });

  it('preserves already-capitalized input', () => {
    expect(formatDescription('Add login')).toBe('Add login.');
  });

  it('handles already correct input', () => {
    expect(formatDescription('Add login.')).toBe('Add login.');
  });

  it('returns empty string unchanged', () => {
    expect(formatDescription('')).toBe('');
  });
});

// ── isBreaking ───────────────────────────────────────────────────────────────

describe('isBreaking', () => {
  it('returns true when bang is set', () => {
    expect(isBreaking(true, '')).toBe(true);
  });

  it('returns true when body contains BREAKING CHANGE footer', () => {
    expect(isBreaking(false, 'BREAKING CHANGE: drops v1 api')).toBe(true);
  });

  it('returns true when BREAKING CHANGE is mid-body', () => {
    expect(
      isBreaking(false, 'Some body text.\n\nBREAKING CHANGE: drops v1 api'),
    ).toBe(true);
  });

  it('returns false for normal body', () => {
    expect(isBreaking(false, 'just a normal commit body')).toBe(false);
  });

  it('returns false for empty body and no bang', () => {
    expect(isBreaking(false, '')).toBe(false);
  });

  it('does not match partial token', () => {
    expect(isBreaking(false, 'this is BREAKING CHANGE without colon')).toBe(
      false,
    );
  });
});

// ── getSection ───────────────────────────────────────────────────────────────

describe('getSection', () => {
  it.each([
    ['feat', 'Features'],
    ['fix', 'Bug Fixes'],
    ['perf', 'Performance'],
    ['refactor', 'Refactoring'],
    ['docs', 'Documentation'],
    ['test', 'Tests'],
    ['build', 'Build'],
    ['ci', 'CI'],
  ])('maps %s → %s', (type, section) => {
    expect(getSection(type)).toBe(section);
  });

  it('maps unknown type to Other Changes', () => {
    expect(getSection('chore')).toBe('Other Changes');
  });

  it('maps empty string to Other Changes', () => {
    expect(getSection('')).toBe('Other Changes');
  });
});

// ── formatEntry ──────────────────────────────────────────────────────────────

describe('formatEntry', () => {
  it('formats entry without scope or body', () => {
    expect(formatEntry(commit())).toBe(
      'Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))',
    );
  });

  it('formats entry with scope', () => {
    expect(formatEntry(commit({ scope: 'auth' }))).toBe(
      '**auth:** Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))',
    );
  });

  it('prepends bullet for multi-commit format', () => {
    expect(formatEntry(commit(), true)).toBe(
      '* Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))',
    );
  });

  it('indents body lines with given indent', () => {
    expect(
      formatEntry(commit({ body: 'First line.\nSecond line.' }), true),
    ).toBe(
      '* Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))\n\n  First line.\n  Second line.',
    );
  });

  it('preserves blank lines in body without adding indent', () => {
    expect(formatEntry(commit({ body: 'First.\n\nSecond.' }), true)).toBe(
      '* Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))\n\n  First.\n\n  Second.',
    );
  });

  it('strips trailing newlines from body', () => {
    expect(formatEntry(commit({ body: 'Body line.\n\n' }))).toBe(
      'Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))\n\nBody line.',
    );
  });

  it('no body section when body is empty string', () => {
    expect(formatEntry(commit())).not.toContain('\n\n');
  });
});

// ── groupBySection ───────────────────────────────────────────────────────────

describe('groupBySection', () => {
  it('groups commits by type', () => {
    const result = groupBySection([
      commit({ type: 'feat' }),
      commit({ type: 'fix' }),
    ]);
    expect([...result.keys()]).toEqual(['Features', 'Bug Fixes']);
  });

  it('omits empty sections', () => {
    expect(groupBySection([commit({ type: 'feat' })]).has('Bug Fixes')).toBe(
      false,
    );
  });

  it('respects section order regardless of commit order', () => {
    const result = groupBySection([
      commit({ type: 'fix' }),
      commit({ type: 'feat' }),
    ]);
    expect([...result.keys()]).toEqual(['Features', 'Bug Fixes']);
  });

  it('adds breaking commit to Breaking Changes AND its type section', () => {
    const c = commit({ type: 'feat', breaking: true });
    const result = groupBySection([c]);
    expect([...result.keys()]).toEqual(['Breaking Changes', 'Features']);
    expect(result.get('Breaking Changes')).toContain(c);
    expect(result.get('Features')).toContain(c);
  });

  it('does not duplicate in Breaking Changes when type is already there', () => {
    const c = commit({ type: 'chore', breaking: true });
    expect(groupBySection([c]).get('Breaking Changes')).toHaveLength(1);
  });

  it('maps unknown type to Other Changes', () => {
    expect(
      groupBySection([commit({ type: 'chore' })]).has('Other Changes'),
    ).toBe(true);
  });
});

// ── deriveIssueRef ───────────────────────────────────────────────────────────

describe('deriveIssueRef', () => {
  it('derives from a leading-number slug branch', () => {
    expect(deriveIssueRef('92-some-slug')).toBe('92');
  });

  it('derives from a claude/issue-N branch', () => {
    expect(deriveIssueRef('claude/issue-92-20260925-2241')).toBe('92');
  });

  it('derives from a bare issue-N branch', () => {
    expect(deriveIssueRef('issue-92')).toBe('92');
  });

  it('derives from a slash-scoped leading-number branch', () => {
    expect(deriveIssueRef('feature/92-some-slug')).toBe('92');
  });

  it('returns empty string for a branch matching no convention', () => {
    expect(deriveIssueRef('main')).toBe('');
  });

  it('does not mistake a mid-word number for an issue', () => {
    expect(deriveIssueRef('2fa-support')).toBe('');
  });
});

// ── resolveIssueRef ──────────────────────────────────────────────────────────

describe('resolveIssueRef', () => {
  it('returns empty string for empty input', () => {
    expect(resolveIssueRef('')).toBe('');
  });

  it('uses a numeric argument directly', () => {
    expect(resolveIssueRef('92')).toBe('92');
  });

  it('derives from a branch argument', () => {
    expect(resolveIssueRef('claude/issue-92-20260925-2241')).toBe('92');
  });

  it('returns empty string for a branch matching no convention', () => {
    expect(resolveIssueRef('main')).toBe('');
  });
});

// ── generateOverview ─────────────────────────────────────────────────────────

describe('generateOverview', () => {
  it('returns empty string for no commits', () => {
    expect(generateOverview([])).toBe('');
  });

  it('single commit: no section headers, no bullet', () => {
    const result = generateOverview([commit()]);
    expect(result).not.toContain('###');
    expect(result).not.toMatch(/^\* /m);
    expect(result).toContain('Add login.');
  });

  it('single commit with body: body not indented', () => {
    expect(generateOverview([commit({ body: 'Body text.' })])).toContain(
      '\n\nBody text.',
    );
  });

  it('multiple commits: grouped under section headers', () => {
    const result = generateOverview([
      commit({ type: 'feat' }),
      commit({ type: 'fix', description: 'Fix bug.' }),
    ]);
    expect(result).toContain('### Features');
    expect(result).toContain('### Bug Fixes');
  });

  it('multiple commits: entries use bullet format', () => {
    const result = generateOverview([
      commit(),
      commit({ description: 'Second.' }),
    ]);
    expect(result).toMatch(/^\* /m);
  });

  it('multiple commits same type: single section header', () => {
    const result = generateOverview([
      commit(),
      commit({ description: 'Also a feature.' }),
    ]);
    expect((result.match(/### Features/g) ?? []).length).toBe(1);
  });

  it('sections separated by blank line', () => {
    const result = generateOverview([
      commit({ type: 'feat' }),
      commit({ type: 'fix', description: 'Fix.' }),
    ]);
    expect(result).toContain('### Features\n\n* ');
    expect(result).toContain('\n\n### Bug Fixes');
  });

  it('appends a Refs footnote for a single commit when given an issue number', () => {
    expect(generateOverview([commit()], '92')).toBe(
      'Add login. ([abc1234](https://github.com/org/repo/commit/abc1234))\n\nRefs #92',
    );
  });

  it('appends a Refs footnote for multiple commits when given an issue number', () => {
    const result = generateOverview(
      [commit({ type: 'feat' }), commit({ type: 'fix', description: 'Fix.' })],
      '92',
    );
    expect(result.endsWith('\n\nRefs #92')).toBe(true);
  });

  it('adds no footnote when no issue number is given', () => {
    expect(generateOverview([commit()])).not.toContain('Refs #');
  });

  it('adds no footnote for an empty issue number', () => {
    expect(generateOverview([commit()], '')).not.toContain('Refs #');
  });
});
