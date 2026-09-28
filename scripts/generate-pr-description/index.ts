import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  formatDescription,
  generateOverview,
  isBreaking,
  parseCC,
  resolveIssueRef,
} from './generate-pr-description.utils';
import type { Commit } from './generate-pr-description.utils';

const execAsync = promisify(exec);

const [baseSha, headSha, repo, issueOrBranch = ''] = process.argv.slice(2);
if (!baseSha || !headSha || !repo) {
  throw new Error(
    'Usage: index.ts BASE_SHA HEAD_SHA OWNER/REPO [ISSUE_NUMBER|BRANCH]',
  );
}

const issueRef = resolveIssueRef(issueOrBranch);

const repoUrl = `https://github.com/${repo}`;

async function run(cmd: string): Promise<string> {
  const { stdout } = await execAsync(cmd);
  return stdout.trim();
}

const hashes = (
  await run(`git log --reverse --format="%H" "${baseSha}..${headSha}"`)
)
  .split('\n')
  .filter(Boolean);

const commits: Commit[] = await Promise.all(
  hashes.map(async hash => {
    const [shortHash, subject, body] = await Promise.all([
      run(`git rev-parse --short ${hash}`),
      run(`git log -1 --format="%s" ${hash}`),
      run(`git log -1 --format="%b" ${hash}`),
    ]);
    const parsed = parseCC(subject);

    return {
      hash: shortHash,
      type: parsed.type,
      scope: parsed.scope,
      breaking: isBreaking(parsed.breakingBang, body),
      description: formatDescription(parsed.rawDesc),
      body,
      commitUrl: `${repoUrl}/commit/${hash}`,
    };
  }),
);

process.stdout.write(generateOverview(commits, issueRef));
