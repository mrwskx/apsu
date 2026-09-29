// PreToolUse hook for `Skill(implement)`. Exit 2 denies the call and shows
// stderr to Claude; exit 0 allows it.

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  decide,
  decideOnUnreadableBlockers,
  toIssueFacts,
} from './gate-implement.utils';
import type {
  BlockingIssue,
  IssueFacts,
  IssuePayload,
} from './gate-implement.utils';

const execFileAsync = promisify(execFile);

// Hand the refusal to the job as well as to Claude. A failed step is silent on
// the thread, and `scripts/report-run` quotes this verbatim rather than
// inventing a second wording for a decision made here.
//
// Only the implement tier writes it. There, every refusal means the run is not
// authorized. In `pr` and `converse` a denial is the routine answer — the skill
// is issue-scoped, or the tier is read-only — and reporting that as
// "Not starting a run" would contradict the run that is plainly happening.
async function deny(reason: string): Promise<void> {
  console.error(reason);
  process.exitCode = 2;

  const env = process.env['GITHUB_ENV'];
  if (env && process.env['GATE_JOB'] === 'implement') {
    await appendFile(env, `GATE_REASON<<__GATE__\n${reason}\n__GATE__\n`);
  }
}

async function main(): Promise<void> {
  // Local sessions are supervised — the gate exists for unattended runs only.
  if (!process.env['GITHUB_ACTIONS']) {
    return;
  }

  const repo = process.env['GITHUB_REPOSITORY'];
  const issue = process.env['GATE_ISSUE'];

  if (!repo || !issue) {
    await deny(
      'Gate cannot verify this run (GITHUB_REPOSITORY or GATE_ISSUE unset). Denying.',
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

  const decision = decide(facts, process.env['GATE_JOB'] ?? '');
  if (!decision.allow) {
    await deny(decision.reason);
  }
}

await main();
