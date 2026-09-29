// What a finished agent run says for itself, on the thread that asked for it.
//
// The trigger is inverted: report *unless* the run left work behind. Asking one
// question — did anything survive this run? — covers the failure classes that
// look nothing alike from the inside (a turn cap, a job timeout, an action that
// skipped itself) but are identical from the thread, where all of them read as
// silence. Enumerating causes instead needs a new branch every time a novel
// door opens onto the same room.

export interface Execution {
  subtype?: string;
  num_turns?: number;
  permission_denials_count?: number;
}

export interface RunFacts {
  tier: 'implement' | 'pr' | 'converse';
  issue: number;
  branch: string;
  maxTurns: number;
  timeoutMinutes: number;
  /** `job.status` as the step runs — `cancelled` is how a `timeout-minutes` expiry arrives. */
  jobStatus: string;
  /** `steps.claude.outcome`. Not `outputs.conclusion`, which is empty on a failed action. */
  agentOutcome: string;
  /** Parsed `execution_file`, or null when the action wrote none. */
  execution: Execution | null;
  /** The guard job's own refusal text, empty unless it refused. */
  gateReason: string;
  branchPushed: boolean;
  commitsAhead: number;
  prNumber: number | null;
}

/** A headline and one line under it — the whole report, so it reads at a glance. */
export interface Report {
  headline: string;
  next: string;
}

const plural = (n: number) => (n === 1 ? '' : 's');

/**
 * The number that explains the ending, and only that one. `total_cost_usd` and
 * duration are already in the run log; a permission-denial count is not, and it
 * is the whole diagnosis when a run dies with write access it never got to use.
 */
function cause(facts: RunFacts): string {
  const { execution: run, maxTurns } = facts;

  if (run?.subtype === 'error_max_turns') {
    return `at turn ${(run.num_turns ?? maxTurns).toFixed()} of ${maxTurns.toFixed()}`;
  }

  if (run?.permission_denials_count) {
    return `after ${run.permission_denials_count.toFixed()} permission denial${plural(run.permission_denials_count)}`;
  }

  return 'on an error';
}

/** Whether the run stranded its work: no branch on the remote, or nothing on it. */
function pushedNothing(facts: RunFacts): boolean {
  return !facts.branchPushed || facts.commitsAhead === 0;
}

/** What the run left behind, stated as fact — the caller has already looked. */
function workState(facts: RunFacts): string {
  if (pushedNothing(facts)) {
    return 'Nothing was pushed.';
  }

  const commits = `${facts.commitsAhead.toFixed()} commit${plural(facts.commitsAhead)}`;

  if (facts.prNumber !== null) {
    return `PR #${facts.prNumber.toFixed()} carries the ${commits} it managed — incomplete.`;
  }

  return `\`${facts.branch}\` carries ${commits}; no PR was opened.`;
}

export function classify(facts: RunFacts): Report | null {
  if (facts.gateReason) {
    return { headline: 'Not starting a run', next: facts.gateReason };
  }

  if (facts.jobStatus === 'cancelled') {
    return {
      headline: `Timed out at ${facts.timeoutMinutes.toFixed()}m`,
      next: `${workState(facts)} Re-run to continue.`,
    };
  }

  // Green, with no execution log to show for it: the action declined to start,
  // silently and indistinguishably from a clean run. It has more than one
  // reason to do that — a workflow file differing from the default branch, a
  // commenter it will not act for — and this step cannot see which, so it
  // reports the observation and points at the log rather than naming a cause it
  // never checked.
  if (
    facts.agentOutcome === 'skipped' ||
    (facts.agentOutcome === 'success' && !facts.execution)
  ) {
    return {
      headline: 'The agent never started',
      next: 'It wrote no execution log, so it declined before running. The action states its reason in the job log.',
    };
  }

  if (facts.agentOutcome === 'failure') {
    return {
      headline: `Stopped ${cause(facts)}`,
      next: pushedNothing(facts)
        ? `Nothing to review. Re-run, or split #${facts.issue.toFixed()}.`
        : workState(facts),
    };
  }

  // Everything below asks what the run produced — a branch, commits, a PR —
  // and only `implement` owes that answer. `converse` commits nothing by
  // design, and `pr` iterates on a pull request that already exists, so for
  // both of them "finished having pushed nothing" is the normal ending and
  // reporting it would put a false alarm on every question asked of them.
  if (facts.tier === 'implement') {
    if (pushedNothing(facts)) {
      const denials = facts.execution?.permission_denials_count ?? 0;

      return {
        headline: denials
          ? `Finished having pushed nothing, after ${denials.toFixed()} permission denial${plural(denials)}`
          : 'Finished having pushed nothing',
        next: `No branch, no PR. Check whether #${facts.issue.toFixed()} was already done.`,
      };
    }

    if (facts.prNumber === null) {
      return {
        headline: 'Pushed commits but opened no pull request',
        next: `${workState(facts)} Open one from it to get CI and a review.`,
      };
    }
  }

  // The agent finished and its work is on a PR, but a later step went red.
  if (facts.jobStatus === 'failure') {
    return {
      headline: 'The run ended red after the agent finished',
      next: `${workState(facts)} The failure is in the job log.`,
    };
  }

  return null;
}

/**
 * The `result` entry of an execution log, or null when the file held anything
 * else. Takes the parsed value rather than a path so the degrade path — a log
 * that is absent, truncated or not the shape expected — is reachable in a test
 * without a filesystem.
 */
export function findResultEntry(log: unknown): Execution | null {
  const entries: unknown[] = Array.isArray(log) ? log : [log];

  const result = entries.find(
    entry =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { type?: unknown }).type === 'result',
  );

  return (result as Execution | undefined) ?? null;
}

/**
 * The id of the comment this run already owns, from the newline-separated ids
 * `gh api --jq` prints. Last wins: an issue can carry comments from more than
 * one run, and only the newest match is this run's own tracking comment.
 */
export function lastCommentId(stdout: string | null): string | undefined {
  return stdout?.split('\n').filter(Boolean).pop();
}

// The action appends this while the run is live and is supposed to take it back
// afterwards. It does not when the agent dies before rewriting the comment
// itself, and an animated GIF that outlives its runner reads as a job still
// working. Anchored to the end of the body so an image the agent deliberately
// embedded is never mistaken for it.
const SPINNER =
  /\n*<img src="https:\/\/github\.com\/user-attachments\/assets\/[^"]+" width="14px" height="14px"[^>]*>\s*$/;

export function stripSpinner(body: string): string {
  return body.replace(SPINNER, '');
}

export function formatReport(report: Report, runUrl: string): string {
  return `**${report.headline}** — [run](${runUrl})\n\n${report.next}`;
}

/**
 * Append, never replace. A tracking comment can hold the only copy of something
 * that matters — a rejected push, a diff left for manual application — and
 * nothing here can tell that from a stale checklist.
 */
export function composeComment(
  existingBody: string,
  report: Report,
  runUrl: string,
): string {
  return `${stripSpinner(existingBody).trimEnd()}\n\n---\n\n${formatReport(report, runUrl)}\n`;
}
