---
name: open-pr
description: >
  Open a pull request for the current branch — pushes it if not yet pushed,
  generates the Overview with the same script CI uses (so the CI auto-populate
  job finds it already correct and exits immediately), and creates the PR
  from the repo's PULL_REQUEST_TEMPLATE.md. Use when the user says "open a
  PR", "open a pull request", "create a PR", "push and open PR", or invokes
  `/open-pr`. Pass `--draft`, or run under GitHub Actions, to open it as a
  draft.
---

## Steps

### 1. Push the branch

```bash
git symbolic-ref --short HEAD
```

Abort if the branch is `main`.

```bash
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
```

No upstream → `git push -u origin <branch>`. Upstream exists → `git push`.

**Completion criterion:** `git status` reports the local branch up to date with its remote.

### 2. Resolve the title

Replicate GitHub's own default: title comes from the commit, not the issue.

```bash
git fetch origin main
git rev-list --count origin/main..HEAD
```

- **Count is 1:** title = that commit's subject (`git log -1 --format=%s`).
- **Count is more than 1:** resolve the issue behind the branch:
  ```bash
  pnpm -s tsx scripts/derive-issue-ref/index.ts "$(git symbolic-ref --short HEAD)"
  ```
  - Non-empty (`ISSUE`) → title = that issue's title (`gh issue view "$ISSUE" --json title --jq .title`).
  - Empty → title = the branch name with `-`/`_` replaced by spaces (e.g. `49-rename-git-commit-skill-to-commit` → `49 rename git commit skill to commit`).

**Completion criterion:** a title in hand — never ask the user for one.

### 3. Generate the Overview

```bash
pnpm -s tsx scripts/generate-pr-description/index.ts "$(git rev-parse origin/main)" "$(git rev-parse HEAD)" "$(gh repo view --json nameWithOwner -q .nameWithOwner)" "$(git symbolic-ref --short HEAD)"
```

This is the exact script `.github/workflows/pr-description.yml` runs to auto-populate `## Overview` on `pull_request: opened` — same base/head/repo/branch shape, same output. Producing it up front means that workflow's own check (section already has non-comment content → `exit 0`) fires on the first run, so it never re-generates.

If the command prints nothing (no commits ahead of `origin/main`), abort — there's nothing to open a PR for.

**Completion criterion:** non-empty Overview text captured.

### 4. Assemble the body from the template

Read `.github/PULL_REQUEST_TEMPLATE.md`. Replace the HTML-comment line under `## Overview` with the generated text from step 3; leave `## Checklist` untouched.

**Completion criterion:** body string with a populated `## Overview` and the template's `## Checklist` intact.

### 5. Create the PR

Open as a draft when either holds:

- the invocation asked for one (`/open-pr --draft`)
- `$GITHUB_ACTIONS` is set — an unattended run never opens a PR that is ready for review

```bash
gh pr create [--draft] --title "<title>" --base main --body "$(cat <<'EOF'
<body>
EOF
)"
```

Post the body exactly as step 4 assembled it: this repo's PR descriptions carry no "Generated with Claude Code" footer. Commit trailers are `commit-changes`' business — this skill pushes commits, it never writes them.

Report the PR URL from the command's output.
