// Authorization for `Skill(implement)` under GitHub Actions.
//
// The skill is model-invocable, so Claude decides *whether* a comment meant
// "implement". These rules decide whether it is *allowed to*, from facts a
// human set deliberately: the issue's state, its labels, its author's
// association, and its blocking edges. The agent runs with `issues: write` and
// so *could* rewrite any of them — nothing here is tamper-proof. What it cannot
// do is rewrite them unseen: every such edit lands in the issue timeline.

const TRUSTED_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const AGENT_LABEL = 'ready-for-agent';

// Naming every blocker past this many makes the refusal unreadable without
// making it more actionable.
const MAX_NAMED_BLOCKERS = 3;

/** One edge from `dependencies/blocked_by`. */
export interface BlockingIssue {
  number: number;
  state: string;
}

export interface IssueFacts {
  number: number;
  state: string;
  labels: string[];
  authorAssociation: string;
  isPullRequest: boolean;
  /** Raw `dependencies/blocked_by` response — `decide` applies the open-only rule. */
  blockedBy: BlockingIssue[];
}

/** The `gh api repos/{repo}/issues/{number}` fields the decision reads. */
export interface IssuePayload {
  number: number;
  state: string;
  labels: { name: string }[];
  author_association: string;
  /** Present only when the number names a pull request — the endpoint serves both. */
  pull_request?: object;
}

/**
 * A payload missing any required field throws here, and the caller denies.
 * `blockedBy` arrives separately because it is a second endpoint.
 */
export function toIssueFacts(
  payload: IssuePayload,
  blockedBy: BlockingIssue[],
): IssueFacts {
  return {
    number: payload.number,
    state: payload.state,
    labels: payload.labels.map(label => label.name),
    authorAssociation: payload.author_association,
    isPullRequest: payload.pull_request !== undefined,
    blockedBy,
  };
}

function describeBlockers(numbers: number[]): string {
  const named = numbers
    .slice(0, MAX_NAMED_BLOCKERS)
    .map(n => `#${n.toFixed()}`);
  const rest = numbers.length - named.length;

  return rest > 0
    ? `${named.join(', ')} and ${rest.toFixed()} other${rest === 1 ? '' : 's'}`
    : named.join(', ');
}

export type Decision = { allow: true } | { allow: false; reason: string };

/**
 * What a failed `dependencies/blocked_by` read means. HTTP 404 is a repository
 * with no dependency graph, which is no blockers rather than an error —
 * denying on it would brick every run in the repo. Any other status is a read
 * we cannot vouch for, and the run stops rather than assuming none.
 */
export function decideOnUnreadableBlockers(stderr: string): Decision {
  const status = /HTTP (\d+)/.exec(stderr)?.[1];

  if (status === '404') {
    return { allow: true };
  }

  return {
    allow: false,
    reason:
      'Not starting an implementation run: its blocking issues could not be read ' +
      `(\`HTTP ${status ?? 'unknown'}\`). Try again, or remove the dependency if it is stale.`,
  };
}

/**
 * `job` is the workflow job asking — `implement` and `pr` can do the work,
 * `converse` is the read-only tier and can only report what it found.
 */
export function decide(facts: IssueFacts, job: string): Decision {
  if (facts.isPullRequest) {
    return {
      allow: false,
      reason:
        'The implement skill is issue-scoped, and this is a pull request. ' +
        'Work the diff directly instead.',
    };
  }

  // Checked before the label: "this issue is closed" is a more useful answer
  // than "this issue is not labelled" for a closed issue that carries one.
  if (facts.state === 'closed') {
    return {
      allow: false,
      reason:
        `Issue #${facts.number.toFixed()} is closed. If the work is genuinely outstanding, ` +
        'reopen it; a closed issue is not a request.',
    };
  }

  if (!facts.labels.includes(AGENT_LABEL)) {
    return {
      allow: false,
      reason:
        `Not authorized: issue #${facts.number.toFixed()} is not labelled \`${AGENT_LABEL}\`. ` +
        'Say so on the thread and stop — applying the label is a maintainer decision.',
    };
  }

  if (!TRUSTED_AUTHORS.has(facts.authorAssociation)) {
    return {
      allow: false,
      reason:
        `Not authorized: issue #${facts.number.toFixed()} was opened by an outside author ` +
        `(${facts.authorAssociation}), so its body is untrusted input. It needs rewriting ` +
        'as a maintainer-authored spec with `/to-spec` first.',
    };
  }

  const openBlockers = facts.blockedBy
    .filter(blocker => blocker.state === 'open')
    .map(blocker => blocker.number);

  if (openBlockers.length > 0) {
    return {
      allow: false,
      reason: `Issue #${facts.number.toFixed()} is blocked by ${describeBlockers(openBlockers)}.`,
    };
  }

  if (job === 'converse') {
    return {
      allow: false,
      reason:
        `Issue #${facts.number.toFixed()} is authorized, but this job is read-only and cannot ` +
        'finish an implementation. Say so on the thread, and that a maintainer can ' +
        `start one by commenting \`@claude implement ${facts.number.toFixed()}\` on the issue. ` +
        'Then stop.',
    };
  }

  return { allow: true };
}
