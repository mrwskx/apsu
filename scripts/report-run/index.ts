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
  composeComment,
  findResultEntry,
  formatReport,
  lastCommentId,
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
  const repo = process.env['GITHUB_REPOSITORY'] ?? '';
  const issue = Number(process.env['ISSUE'] ?? '');
  const branch = process.env['BRANCH'] ?? '';
  const runUrl = process.env['RUN_URL'] ?? '';
  const runId = process.env['GITHUB_RUN_ID'] ?? '';

  if (!repo || !issue) {
    console.error(
      'report-run: GITHUB_REPOSITORY or ISSUE unset; nothing to report onto.',
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
    tier: (process.env['TIER'] ?? 'implement') as RunFacts['tier'],
    issue,
    branch,
    maxTurns: Number(process.env['MAX_TURNS'] ?? '0'),
    timeoutMinutes: Number(process.env['TIMEOUT_MINUTES'] ?? '0'),
    jobStatus: process.env['JOB_STATUS'] ?? '',
    agentOutcome: process.env['AGENT_OUTCOME'] ?? '',
    execution: await readExecution(process.env['EXECUTION_FILE'] ?? ''),
    gateReason: (process.env['GATE_REASON'] ?? '').trim(),
    branchPushed,
    commitsAhead,
    prNumber: pr ? Number(pr) : null,
  };

  const report = classify(facts);
  if (!report) {
    console.log('report-run: the run left its work behind; nothing to say.');
    return;
  }

  // The action's own tracking comment already carries this run's URL, and it is
  // a better home for the outcome than a fresh comment nobody asked for.
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

  const body =
    existingId && existingBody !== null
      ? composeComment(existingBody, report, runUrl)
      : `${formatReport(report, runUrl)}\n`;

  if (process.env['REPORT_DRY_RUN']) {
    console.log(
      existingId
        ? `--- would PATCH comment ${existingId} ---`
        : '--- would post a new comment ---',
    );
    console.log(body);
    return;
  }

  // Passed as argv rather than through a temp file: execFile spawns no shell,
  // so the body needs no quoting and leaves nothing behind on the runner.
  const written = existingId
    ? await tryRun('gh', [
        'api',
        `repos/${repo}/issues/comments/${existingId}`,
        '-X',
        'PATCH',
        '-f',
        `body=${body}`,
      ])
    : await tryRun('gh', [
        'issue',
        'comment',
        String(issue),
        '--repo',
        repo,
        '--body',
        body,
      ]);

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
