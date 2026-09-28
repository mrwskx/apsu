---
name: commit-changes
description: >
  Create a git commit in the current working tree. Reads commitlint rules,
  drafts a terse Conventional Commits message, validates it, then commits.
  Use when the user says "commit", "commit this", "commit my changes", "make
  a commit", "create a commit", or "/commit-changes". Do not trigger for
  read-only queries about commit history.
---

## Steps

### 1. Resolve staged files

Run `git status --porcelain` and count lines beginning with a staged status code (`[MADRC]` in column 1).

**If nothing is staged:** run `git add .`. The system command-run confirmation covers this — no skill-level prompt needed.

**If files are already staged:** proceed — use only those files. Do not run `git add`.

Completion criterion: staged set is non-empty.

### 2. Extract issue number from branch, and decide whether this commit closes it

Run:
```bash
pnpm -s tsx scripts/generate-pr-description/derive-issue-ref.ts "$(git symbolic-ref --short HEAD)"
```

Non-empty output → capture as `ISSUE`. Empty → `ISSUE` unset, step done.

With `ISSUE` set, read what the issue will be judged on:

```bash
gh issue view <ISSUE> --json body --jq .body
```

Judge each criterion against the branch's **cumulative** work — every commit since `main` plus what is staged now, because earlier commits on this branch may already have resolved part of the issue:

```bash
git diff --cached "$(git merge-base origin/main HEAD)"
```

A criterion is **settled** when that cumulative work satisfies it _and_ something in-repo shows it: a diff, a test, a command's output. Otherwise it is **outstanding**, on either of two counts:

- **Work remaining** — this commit is a partial slice and the criterion is not satisfied yet. A later commit on the branch settles it.
- **Manual QA** — satisfied or not, only eyes on something no diff contains can decide it: a running app, a rendered component, a merged `main`, a published package. No commit settles it.

`CLOSES` is set only when every criterion is settled. Three edges:

- An issue with no acceptance criteria section is judged the same way against its prose: `CLOSES` is set when the cumulative work addresses everything the issue asks for.
- An issue `gh` cannot read leaves `CLOSES` unset. A commit never closes an issue this skill was unable to check.
- An issue already closed leaves `CLOSES` unset — there is nothing left to close.

Completion criterion: `ISSUE` noted (may be empty); with `ISSUE` set, every criterion is marked settled or outstanding, and `CLOSES` follows from that.

### 3. Read commitlint rules

Read `commitlint.config.js` from the project root. It defines custom rules beyond Conventional Commits defaults — read the rule implementations directly to learn their intent; don't rely on a fixed list here, since the file is the source of truth and can change independently of this skill.

Completion criterion: custom rules understood; if the file is absent, skip this step and skip lint validation in step 5.

### 4. Generate commit message

Draft a Conventional Commits message from the staged diff (`git diff --cached`), satisfying the rules from step 3.

Keep it caveman-terse:
- Subject: imperative mood ("add", "fix", not "added", "adds"), ≤50 chars when possible, hard cap 72, no trailing period.
- Body: only if the subject isn't self-explanatory; wrap at 72 chars.
- Never write "this commit does X", "I", "we", "now", "currently", emoji, or the scope's own name restated in the subject.

If `ISSUE` is set, `CLOSES` from step 2 decides the footer. A closing keyword claims that merging this commit finishes the issue, so it rides the commit that settles the last criterion — not the slices before it.

- **`CLOSES` set** — the message ends with a closing footer. Keep one the draft already carries (`Closes #N` / `Fixes #N` / `Resolves #N`); otherwise append `Closes #<ISSUE>` as the last footer line, separated from the rest by a blank line if no footer exists yet.
- **`CLOSES` unset** — the message carries no closing keyword, so merging leaves the issue open for the commit, or the person, that settles what is left. Drop a closing footer the draft invented. Substituting `Refs #<ISSUE>` is not the fallback: `commitlint.config.js`'s `footer-no-bare-refs` rejects a footer `#N` that no closing keyword precedes, and the PR overview already carries a non-closing `Refs #<ISSUE>`, so the issue cross-references this work either way.

Footer lines must not end with a period.

### 5. Validate with commitlint

Write the draft message to `/tmp/.commit-msg-draft` and run:

```bash
npx --no -- commitlint --edit /tmp/.commit-msg-draft
```

- **Pass:** proceed to step 6.
- **Fail:** regenerate (step 4) and re-validate. Max 3 total attempts.
  - After 3 failures: show the last draft in a code block, list all lint errors, and stop with: "Could not produce a valid message after 3 attempts. Edit the draft above." Then proceed to step 6 with the user's corrected text, re-validated.

Completion criterion: a lint-clean message exists, or the user has supplied a corrected draft.

### 6. Commit

Run:

```bash
git commit -m "$(cat <<'EOF'
<message>
EOF
)"
```

Report the commit hash and subject line from `git log -1 --oneline`. With `CLOSES` unset, name what is still outstanding and which count it falls on, and state that `#<ISSUE>` stays open.
