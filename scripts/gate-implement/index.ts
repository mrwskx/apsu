// PreToolUse hook for `Skill(implement)`. Exit 2 denies the call and shows
// stderr to Claude; exit 0 allows it.

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  decide,
  decideOnUnreadableBlockers,
  parseJob,
  recordsRefusal,
  toIssueFacts,
} from './gate-implement.utils';
import type {
  BlockingIssue,
  IssueFacts,
  IssuePayload,
} from './gate-implement.utils';

const execFileAsync = promisify(execFile);

const {
  GITHUB_ACTIONS,
  GITHUB_ENV,
  GITHUB_REPOSITORY: repo,
  GATE_ISSUE: issue,
  GATE_JOB,
} = process.env;
const job = parseJob(GATE_JOB);

// Hand the refusal to the job as well as to Claude. A failed step is silent on
// the thread, and `scripts/report-run` quotes this verbatim rather than
// inventing a second wording for a decision made here.
async function deny(reason: string): Promise<void> {
  console.error(reason);
  process.exitCode = 2;

  if (GITHUB_ENV && recordsRefusal(job)) {
    await appendFile(
      GITHUB_ENV,
      `GATE_REASON<<__GATE__\n${reason}\n__GATE__\n`,
    );
  }
}

async function main(): Promise<void> {
  // Local sessions are supervised — the gate exists for unattended runs only.
  if (!GITHUB_ACTIONS) {
    return;
  }

  if (!repo || !issue || !job) {
    await deny(
      'Gate cannot verify this run (GITHUB_REPOSITORY or GATE_ISSUE unset, or GATE_JOB unknown). Denying.',
    );
    return;
  }

  // A second endpoint, and one that need not answer: see
  // decideOnUnreadableBlockers for what each failure means.
  let blockedBy: BlockingIssue[] = [];
  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${repo}/issues/${issue}/dependencies/blocked_by`,
    ]);
    blockedBy = (JSON.parse(stdout) as BlockingIssue[]).map(
      ({ number, state }) => ({ number, state }),
    );
  } catch (error) {
    const { stderr } = error as { stderr?: string };
    const decision = decideOnUnreadableBlockers(stderr ?? String(error));

    if (!decision.allow) {
      await deny(decision.reason);
      return;
    }
  }

  // GATE_ISSUE names the issue; the facts always come from the API, so pointing
  // the gate at another number cannot invent a label on it.
  let facts: IssueFacts;
  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${repo}/issues/${issue}`,
    ]);
    facts = toIssueFacts(JSON.parse(stdout) as IssuePayload, blockedBy);
  } catch (error) {
    await deny(
      `Gate could not read issue #${issue}: ${String(error)}. Denying.`,
    );
    return;
  }

  const decision = decide(facts, job);
  if (!decision.allow) {
    await deny(decision.reason);
  }
}

await main();
