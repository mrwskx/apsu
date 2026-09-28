import { deriveIssueRef } from './generate-pr-description.utils';

// Shell boundary for the `commit-changes` and `open-pr` skills: prints the
// issue number alone, or nothing at all when no issue is behind the branch.
// No trailing newline, so `$(...)` captures it without stripping.
process.stdout.write(deriveIssueRef(process.argv[2] ?? ''));
