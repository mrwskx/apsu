// Posts how an agent run ended onto the thread that asked for it.
//
// Runs as the last step of every agent job, under `if: always()`, so it also
// speaks for the endings that reach no code of ours: a cancelled job, a step
// that died before the agent, an action that skipped itself. `always()` is why
// this is a step and not a downstream job — `execution_file` is a runner-local
// path that dies with the job, and without it a report can only repeat the red
// X that GitHub already shows.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  classify,
  findResultEntry,
  lastCommentId,
  parseTier,
  planCommentWrite,
} from './report-run.utils';
import type { Execution, RunFacts } from './report-run.utils';

const execFileAsync = promisify(execFile);

/**
 * Every external call this script makes is best-effort. A report that cannot be
 * gathered is a shorter report; a report that throws is a red X on a job that
 * otherwise succeeded, which is the thing this script exists to stop.
 */
async function tryRun(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 30_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readExecution(path: string): Promise<Execution | null> {
  if (!path) {
    return null;
  }

  try {
    return findResultEntry(JSON.parse(await readFile(path, 'utf-8')));
  } catch (error) {
    // Absent, truncated, or not JSON — all three degrade the same way.
    console.error(`report-run: could not read ${path}: ${String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const {
    GITHUB_REPOSITORY: repo = '',
    ISSUE = '',
    BRANCH: branch = '',
    RUN_URL: runUrl = '',
    GITHUB_RUN_ID: runId = '',
    TIER,
    MAX_TURNS = '0',
    TIMEOUT_MINUTES = '0',
    JOB_STATUS: jobStatus = '',
    AGENT_OUTCOME: agentOutcome = '',
    EXECUTION_FILE = '',
    GATE_REASON = '',
    REPORT_DRY_RUN,
  } = process.env;
  const issue = Number(ISSUE);
  const tier = parseTier(TIER);

  if (!repo || !issue || !tier) {
    console.error(
      'report-run: GITHUB_REPOSITORY or ISSUE unset, or TIER unknown; nothing to report onto.',
    );
    return;
  }

  // `branch_name` is a name, not evidence: the action populates it for a branch
  // it never pushed. Every claim below is read back from the remote instead.
  const branchPushed =
    branch !== '' &&
    (await tryRun('git', [
      'ls-remote',
      '--exit-code',
      '--heads',
      'origin',
      branch,
    ])) !== null;

  let commitsAhead = 0;
  let pr: string | null = null;

  if (branchPushed) {
    await tryRun('git', ['fetch', '--quiet', 'origin', branch, 'main']);
    commitsAhead = Number(
      (await tryRun('git', [
        'rev-list',
        '--count',
        `origin/main..origin/${branch}`,
      ])) ?? '0',
    );
    pr = await tryRun('gh', [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      branch,
      '--json',
      'number',
      '--jq',
      '.[0].number // empty',
    ]);
  }

  const facts: RunFacts = {
    tier,
    issue,
    branch,
    maxTurns: Number(MAX_TURNS),
    timeoutMinutes: Number(TIMEOUT_MINUTES),
    jobStatus,
    agentOutcome,
    execution: await readExecution(EXECUTION_FILE),
    gateReason: GATE_REASON.trim(),
    branchPushed,
    commitsAhead,
    prNumber: pr ? Number(pr) : null,
  };

  const report = classify(facts);
  if (!report) {
    console.log('report-run: the run left its work behind; nothing to say.');
    return;
  }

  const existingId = lastCommentId(
    await tryRun('gh', [
      'api',
      `repos/${repo}/issues/${issue.toFixed()}/comments`,
      '--paginate',
      '--jq',
      `.[] | select(.body | contains("actions/runs/${runId}")) | .id`,
    ]),
  );

  const existingBody = existingId
    ? await tryRun('gh', [
        'api',
        `repos/${repo}/issues/comments/${existingId}`,
        '--jq',
        '.body',
      ])
    : null;

  const { intent, body, args } = planCommentWrite(
    { repo, issue, existingId, existingBody },
    report,
    runUrl,
  );

  if (REPORT_DRY_RUN) {
    console.log(intent);
    console.log(body);
    return;
  }

  const written = await tryRun('gh', args);

  // One attempt, and a failed write never fails the run. The log line carries
  // the whole body, so the finding survives even when the comment does not.
  if (written === null) {
    console.error(
      'report-run: could not write the comment. It would have said:\n',
    );
    console.error(body);
  }
}

await main();
