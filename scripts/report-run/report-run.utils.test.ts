import { describe, it, expect } from 'vitest';
import {
  classify,
  composeComment,
  findResultEntry,
  formatReport,
  lastCommentId,
  stripSpinner,
} from './report-run.utils';
import type { RunFacts } from './report-run.utils';

// A run that finished, pushed, and opened a PR. Every case below is this one
// with something taken away.
const clean: RunFacts = {
  tier: 'implement',
  issue: 160,
  branch: 'claude/issue-160-20260920-1000',
  maxTurns: 40,
  timeoutMinutes: 30,
  jobStatus: 'success',
  agentOutcome: 'success',
  execution: { subtype: 'success', num_turns: 22, permission_denials_count: 0 },
  gateReason: '',
  branchPushed: true,
  commitsAhead: 3,
  prNumber: 161,
};

describe('classify', () => {
  it('says nothing when the run left its work behind', () => {
    expect(classify(clean)).toBeNull();
  });

  it('repeats the gate refusal verbatim', () => {
    const report = classify({
      ...clean,
      gateReason:
        'this issue is not labelled `ready-for-agent`. Run `/triage` first.',
    });

    expect(report).toEqual({
      headline: 'Not starting a run',
      next: 'this issue is not labelled `ready-for-agent`. Run `/triage` first.',
    });
  });

  it('names the timeout when the job was cancelled', () => {
    const report = classify({
      ...clean,
      jobStatus: 'cancelled',
      prNumber: null,
      commitsAhead: 0,
    });

    expect(report?.headline).toBe('Timed out at 30m');
    expect(report?.next).toContain('Nothing was pushed.');
  });

  it('reports an action that skipped itself', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'skipped',
      execution: null,
    });

    expect(report?.headline).toBe('The agent never started');
    expect(report?.next).toContain('declined before running');
  });

  // The self-skip is green and writes no execution log, which is the only thing
  // separating it from a clean run.
  it('reports a green agent step that produced no execution log', () => {
    const report = classify({ ...clean, execution: null });

    expect(report?.headline).toBe('The agent never started');
  });

  it('names the turn cap, and says there is nothing to review', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: {
        subtype: 'error_max_turns',
        num_turns: 41,
        permission_denials_count: 0,
      },
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    });

    expect(report?.headline).toBe('Stopped at turn 41 of 40');
    expect(report?.next).toBe('Nothing to review. Re-run, or split #160.');
  });

  it('points at the PR when a capped run still pushed', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: { subtype: 'error_max_turns', num_turns: 41 },
    });

    expect(report?.next).toBe(
      'PR #161 carries the 3 commits it managed — incomplete.',
    );
  });

  it('falls back to the cap itself when the log omits the turn count', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: { subtype: 'error_max_turns' },
    });

    expect(report?.headline).toBe('Stopped at turn 40 of 40');
  });

  it('names permission denials when they are the cause', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: {
        subtype: 'error_during_execution',
        permission_denials_count: 15,
      },
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    });

    expect(report?.headline).toBe('Stopped after 15 permission denials');
  });

  it('writes one denial without an s', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: {
        subtype: 'error_during_execution',
        permission_denials_count: 1,
      },
    });

    expect(report?.headline).toBe('Stopped after 1 permission denial');
  });

  it('falls back to a plain error when the log explains nothing', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: {},
    });

    expect(report?.headline).toBe('Stopped on an error');
  });

  // The degrade path: an unreadable execution_file arrives here as null, and a
  // failed run still gets reported, just without the number that explains it.
  it('still reports a failure when there is no execution log at all', () => {
    const report = classify({
      ...clean,
      agentOutcome: 'failure',
      execution: null,
    });

    expect(report?.headline).toBe('Stopped on an error');
  });

  it('reports a green run that pushed nothing', () => {
    const report = classify({
      ...clean,
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    });

    expect(report?.headline).toBe('Finished having pushed nothing');
    expect(report?.next).toContain('#160 was already done');
  });

  it('names denials on a green run that pushed nothing', () => {
    const report = classify({
      ...clean,
      execution: { subtype: 'success', permission_denials_count: 15 },
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    });

    expect(report?.headline).toBe(
      'Finished having pushed nothing, after 15 permission denials',
    );
  });

  it('reports commits that never reached a pull request', () => {
    const report = classify({ ...clean, prNumber: null });

    expect(report?.headline).toBe('Pushed commits but opened no pull request');
    expect(report?.next).toContain('carries 3 commits');
  });

  it('speaks when a later step goes red after the agent finished', () => {
    const report = classify({ ...clean, jobStatus: 'failure' });

    expect(report?.headline).toBe('The run ended red after the agent finished');
  });

  it('stays quiet when converse commits nothing, which is its job', () => {
    const converse: RunFacts = {
      ...clean,
      tier: 'converse',
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    };

    expect(classify(converse)).toBeNull();
  });

  it('stays quiet when pr pushes nothing, which a question does not', () => {
    const pr: RunFacts = {
      ...clean,
      tier: 'pr',
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    };

    expect(classify(pr)).toBeNull();
  });

  it('still reports converse failing', () => {
    const report = classify({
      ...clean,
      tier: 'converse',
      agentOutcome: 'failure',
      execution: { subtype: 'error_max_turns', num_turns: 16 },
      maxTurns: 15,
      branchPushed: false,
      commitsAhead: 0,
      prNumber: null,
    });

    expect(report?.headline).toBe('Stopped at turn 16 of 15');
  });

  it('writes one commit without an s', () => {
    const report = classify({ ...clean, commitsAhead: 1, prNumber: null });

    expect(report?.next).toContain('carries 1 commit;');
  });

  // The gate refuses before the agent exists, so none of the run facts are
  // populated — the refusal has to win over every branch below it.
  it('reports the gate refusal even when the job was also cancelled', () => {
    const report = classify({
      ...clean,
      gateReason: 'this issue was opened by an outside author.',
      jobStatus: 'cancelled',
      agentOutcome: '',
    });

    expect(report?.headline).toBe('Not starting a run');
  });
});

describe('findResultEntry', () => {
  it('finds the result entry in a stream-json log', () => {
    const log = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant' },
      { type: 'result', subtype: 'error_max_turns', num_turns: 41 },
    ];

    expect(findResultEntry(log)).toEqual({
      type: 'result',
      subtype: 'error_max_turns',
      num_turns: 41,
    });
  });

  it('accepts a log that is a single object rather than an array', () => {
    expect(findResultEntry({ type: 'result', subtype: 'success' })).toEqual({
      type: 'result',
      subtype: 'success',
    });
  });

  it('returns null when the log holds no result entry', () => {
    expect(findResultEntry([{ type: 'system' }])).toBeNull();
  });

  // What a truncated or wrong-shaped file parses to. Degrading to null costs
  // the report its cause line; throwing here would cost the whole report.
  it.each([null, 'not a log', 42, [], [null], [{}]])(
    'returns null rather than throwing on %j',
    log => {
      expect(findResultEntry(log)).toBeNull();
    },
  );
});

// A tracking comment as the action leaves it when the agent dies mid-run —
// the checklist half-ticked and the spinner still turning.
const TRACKING_COMMENT = `**Claude encountered an error after 5m 6s** —— [View job](https://github.com/mrwskx/papyrus-ui/actions/runs/34890216131)

---
### Tasks

- [x] Gather context (issue #160, CLAUDE.md, skills)
- [ ] Implement changes per issue #160
- [ ] Run validate-skills, typecheck, test
- [ ] Push branch and provide PR link

<img src="https://github.com/user-attachments/assets/5ac382c7-e004-429b-8e35-7feb3e8f9c6f" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />
`;

describe('stripSpinner', () => {
  it('removes the spinner from a tracking comment', () => {
    expect(stripSpinner(TRACKING_COMMENT)).not.toContain('<img');
  });

  it('keeps everything the agent wrote', () => {
    const stripped = stripSpinner(TRACKING_COMMENT);

    expect(stripped).toContain(
      '- [x] Gather context (issue #160, CLAUDE.md, skills)',
    );
    expect(stripped).toContain('- [ ] Push branch and provide PR link');
  });

  it('leaves a body that never had one alone', () => {
    const body = '**Claude finished** — all done.\n';

    expect(stripSpinner(body)).toBe(body);
  });

  // The discriminator is position, not the host: an image the agent embedded
  // mid-body is content, and only the trailing one is the action's.
  it('leaves an image the agent embedded in the body alone', () => {
    const body = `Here is the chart:\n\n<img src="https://github.com/user-attachments/assets/abc" width="14px" height="14px" />\n\nAnd the rest of the report.\n`;

    expect(stripSpinner(body)).toContain('<img');
  });
});

describe('composeComment', () => {
  const report = {
    headline: 'Stopped at turn 41 of 40',
    next: 'Nothing to review. Re-run, or split #160.',
  };
  const url = 'https://github.com/mrwskx/papyrus-ui/actions/runs/34890216131';

  it('appends the report under a rule, with the spinner gone', () => {
    const composed = composeComment(TRACKING_COMMENT, report, url);

    expect(composed).not.toContain('<img');
    expect(composed).toContain(
      '- [x] Gather context (issue #160, CLAUDE.md, skills)',
    );
    expect(composed).toContain('\n\n---\n\n**Stopped at turn 41 of 40**');
    expect(composed).toContain('Nothing to review. Re-run, or split #160.');
  });
});

describe('formatReport', () => {
  it('formats a report as a headline, a link and one line', () => {
    expect(
      formatReport(
        {
          headline: 'Stopped at turn 41 of 40',
          next: 'Nothing to review. Re-run, or split #160.',
        },
        'https://github.com/mrwskx/papyrus-ui/actions/runs/34890216131',
      ),
    ).toBe(
      '**Stopped at turn 41 of 40** — [run](https://github.com/mrwskx/papyrus-ui/actions/runs/34890216131)\n\nNothing to review. Re-run, or split #160.',
    );
  });
});

describe('lastCommentId', () => {
  it('takes the newest id when several comments match', () => {
    expect(lastCommentId('111\n222\n333')).toBe('333');
  });

  it('reads a single id', () => {
    expect(lastCommentId('111')).toBe('111');
  });

  it('returns undefined when no comment matched', () => {
    expect(lastCommentId('')).toBeUndefined();
  });

  // What a failed `gh api` hands back — the report still posts, as a new comment.
  it('returns undefined when the lookup itself failed', () => {
    expect(lastCommentId(null)).toBeUndefined();
  });

  it('ignores the blank line a trailing newline leaves', () => {
    expect(lastCommentId('111\n222\n')).toBe('222');
  });
});
