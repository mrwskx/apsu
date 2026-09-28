import { describe, it, expect } from 'vitest';
import {
  decide,
  decideOnUnreadableBlockers,
  toIssueFacts,
  AGENT_LABEL,
} from './gate-implement.utils';
import type { IssueFacts } from './gate-implement.utils';

// An issue a maintainer marked ready. Every case below is this one with
// something taken away.
const authorized: IssueFacts = {
  number: 159,
  state: 'open',
  labels: [AGENT_LABEL, 'feature'],
  authorAssociation: 'OWNER',
  isPullRequest: false,
  blockedBy: [],
};

describe('toIssueFacts', () => {
  const payload = {
    number: 159,
    state: 'open',
    labels: [{ name: AGENT_LABEL }, { name: 'feature' }],
    author_association: 'OWNER',
  };

  it('flattens the labels and renames the author association', () => {
    expect(toIssueFacts(payload, [])).toEqual(authorized);
  });

  // The endpoint serves pull requests under the same path, and only this field
  // tells the two apart.
  it('reads a pull request off the pull_request field', () => {
    expect(
      toIssueFacts({ ...payload, pull_request: {} }, []).isPullRequest,
    ).toBe(true);
  });
});

describe('decide', () => {
  it('allows an authorized issue from the implement job', () => {
    expect(decide(authorized, 'implement')).toEqual({ allow: true });
  });

  it('allows an authorized issue from the pr job', () => {
    expect(decide(authorized, 'pr')).toEqual({ allow: true });
  });

  it('denies a pull request, whatever its labels say', () => {
    const decision = decide(
      { ...authorized, isPullRequest: true },
      'implement',
    );
    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('issue-scoped'),
    );
  });

  it('denies a closed issue', () => {
    const decision = decide({ ...authorized, state: 'closed' }, 'implement');
    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('is closed'),
    );
  });

  it('says closed rather than unlabelled when an issue is both', () => {
    const decision = decide(
      { ...authorized, state: 'closed', labels: [] },
      'implement',
    );
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('is closed'),
    );
  });

  it('denies an unlabelled issue', () => {
    const decision = decide(
      { ...authorized, labels: ['feature'] },
      'implement',
    );
    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining(AGENT_LABEL),
    );
  });

  it('denies an outside-authored issue even when labelled', () => {
    const decision = decide(
      { ...authorized, authorAssociation: 'CONTRIBUTOR' },
      'implement',
    );
    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('/to-spec'),
    );
  });

  it('accepts MEMBER and COLLABORATOR as trusted authors', () => {
    for (const authorAssociation of ['MEMBER', 'COLLABORATOR']) {
      expect(decide({ ...authorized, authorAssociation }, 'implement')).toEqual(
        {
          allow: true,
        },
      );
    }
  });

  describe('blocking issues', () => {
    it('denies an issue with an open blocker, naming it', () => {
      const decision = decide(
        { ...authorized, blockedBy: [{ number: 91, state: 'open' }] },
        'implement',
      );

      expect(decision.allow).toBe(false);
      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining('blocked by #91'),
      );
    });

    // A closed blocker is a dependency that was satisfied, not one to wait on.
    it('ignores a closed blocker', () => {
      expect(
        decide(
          { ...authorized, blockedBy: [{ number: 91, state: 'closed' }] },
          'implement',
        ),
      ).toEqual({ allow: true });
    });

    it('names only the open blockers when the edges are mixed', () => {
      const decision = decide(
        {
          ...authorized,
          blockedBy: [
            { number: 91, state: 'closed' },
            { number: 92, state: 'open' },
          ],
        },
        'implement',
      );

      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining('blocked by #92'),
      );
    });

    it('counts the rest rather than listing every blocker', () => {
      const blockedBy = [10, 20, 30, 40, 50, 60].map(number => ({
        number,
        state: 'open',
      }));
      const decision = decide({ ...authorized, blockedBy }, 'implement');

      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining('#10, #20, #30 and 3 others'),
      );
    });

    it('writes one remaining blocker without an s', () => {
      const blockedBy = [10, 20, 30, 40].map(number => ({
        number,
        state: 'open',
      }));
      const decision = decide({ ...authorized, blockedBy }, 'implement');

      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining('and 1 other.'),
      );
    });

    // Authorization is the earlier question: an unlabelled issue is refused for
    // the label, not for a blocker a maintainer never approved work on anyway.
    it('reports the missing label before a blocker', () => {
      const decision = decide(
        {
          ...authorized,
          labels: [],
          blockedBy: [{ number: 91, state: 'open' }],
        },
        'implement',
      );

      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining(AGENT_LABEL),
      );
    });

    it('tells the converse job it is blocked rather than how to start a run', () => {
      const decision = decide(
        { ...authorized, blockedBy: [{ number: 91, state: 'open' }] },
        'converse',
      );

      expect(decision).toHaveProperty(
        'reason',
        expect.stringContaining('blocked by #91'),
      );
    });
  });

  // The routing denial: authorized, but the read-only job cannot finish the work.
  // It names the comment a maintainer would type, since this tier has no way to
  // start a run itself.
  it('tells the converse job to hand off, naming the comment and the issue', () => {
    const decision = decide(authorized, 'converse');
    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('`@claude implement 159`'),
    );
    expect(decision).not.toHaveProperty(
      'reason',
      expect.stringContaining('gh workflow run'),
    );
  });

  it('checks authorization before routing, so converse is not told to hand off an unlabelled issue', () => {
    const decision = decide({ ...authorized, labels: [] }, 'converse');
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining(AGENT_LABEL),
    );
  });
});

describe('decideOnUnreadableBlockers', () => {
  // The dependency graph is not enabled on every repository, and denying on
  // its absence would refuse every run here permanently.
  it('treats a 404 as no blockers', () => {
    expect(decideOnUnreadableBlockers('gh: Not Found (HTTP 404)')).toEqual({
      allow: true,
    });
  });

  it.each(['403', '500', '502'])('refuses on HTTP %s, naming it', status => {
    const decision = decideOnUnreadableBlockers(`gh: failed (HTTP ${status})`);

    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining(`HTTP ${status}`),
    );
  });

  // A spawn failure or a timeout carries no status at all.
  it('refuses when the failure names no status', () => {
    const decision = decideOnUnreadableBlockers('Error: spawn gh ENOENT');

    expect(decision.allow).toBe(false);
    expect(decision).toHaveProperty(
      'reason',
      expect.stringContaining('HTTP unknown'),
    );
  });
});
