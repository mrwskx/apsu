---
name: implement
description: Read a GitHub issue and implement the fix or feature, then record the outcome back on it — ticks, strikes and a notes comment.
---

# Implement

Read a GitHub issue and implement the fix or feature.

## Surface

Steps 4–7 differ depending on where the skill runs. Check once, up front:

```bash
[ -n "$GITHUB_ACTIONS" ] && echo unattended || echo local
```

- **local** — a supervised session. You summarize and stop; the user commits. Nothing is written to the issue without their approval.
- **unattended** — a GitHub Actions run. There is no user and the runner is destroyed when the job ends, so uncommitted work is lost. Commit as you go; the workflow opens the PR.

Unattended, a hook may deny this skill when you invoke it yourself — usually because you are in the read-only `converse` job and should escalate instead. The denial says what to do. Do that and stop. The workflow's own route is authorized before the run starts, so reaching Step 4 there means the issue already cleared it.

Everything before Step 4 is identical on both surfaces.

## Step 1 — Resolve issue number

**Completion criterion:** one confirmed issue number in hand.

1. If an argument was passed (`/implement 42`), use it.
2. Else parse the current branch name for a leading integer (e.g. `42-fix-login` → `42`). Confirm with the user: "Found issue #42 from branch name — correct?"
3. If neither yields a number, prompt: "Which issue number should I implement?"

## Step 2 — Read the issue

```bash
gh issue view <number> --json title,body,comments
```

Parse: title, body, and any clarifying comments. Build a clear mental model of what "done" looks like before touching any code.

**Never run `gh issue close`.** Closing happens when the merged PR references the issue, which is outside this skill's scope. Writing to the issue belongs in Step 7, once the work exists.

## Step 3 — Prepare the branch

```bash
# check for existing branch referencing the issue number
git branch --list "*<number>-*" --all
```

- Branch exists → `git checkout <branch>`
- Branch missing → switch to main first, then create:
  ```bash
  git checkout main
  git pull
  git checkout -b <number>-<kebab-slug-of-title>
  ```

## Step 4 — Implement

Read `docs/agents/code-style.md` before writing code.

Invoke `/ponytail` before writing any code — stop at the first rung that holds.

Use `/tdd` where behaviors have clear, pre-agreed seams. Otherwise implement directly with ponytail principles.

Write in vertical slices — one behavior at a time, only what the issue requires.

Run typechecking and single test files regularly throughout. Run the full test suite once at the end.

**Unattended only:** invoke `/commit-changes` after each vertical slice, as soon as its tests pass. An unattended run can be cut short by a turn cap or a job timeout at any point — committing per slice means what it finished so far survives as a reviewable branch instead of being discarded with the runner.

**Completion criterion:** the issue's acceptance criteria are met, all existing tests pass, and every line written traces to a line of the issue.

## Step 5 — Review

**Local only.** Invoke `/code-review` on the completed work before summarizing.

Skip this step when unattended. `/code-review` fans out three parallel sub-agents, and the turn budget is the scarcest thing an unattended run has. Its output is a ready-for-review PR that has had no automated review — review happens on the PR, locally or by commenting `@claude` on it.

## Step 6 — Finish

### Local

Output a concise summary:

- Implements `#<number> — <title>`
- Branch: `<branch-name>`
- What changed: one bullet per file modified, one line each
- Tests added (if any): one bullet per test, one line each
- What was deliberately skipped (ponytail tradeoffs, if any)

Committing is the user's next step, after Step 7.

### Unattended

Commit anything still uncommitted with `/commit-changes`.

The branch is the output. The workflow opens the PR from it once the run ends — titled from the issue, Overview generated from your commits.

Report the same summary as the local path. Then go to Step 7 — unattended it writes the issue without asking.

## Step 7 — Update the issue

Record what the run verified and what it changed. Same procedure on both surfaces — the only difference is that local asks before writing. Runs last, after the Step 6 summary, on both surfaces.

### 1. Re-read the body

```bash
gh issue view <number> --json body --jq .body > "$body"   # $body from mktemp
```

Build everything below from *that* text. The Step 2 copy may be stale, and `gh issue edit --body-file` replaces the whole body — writing from a stale copy silently reverts an edit someone made mid-run.

### 2. Transform the body

- Tick `- [x]` only on **nameable evidence**: a passing test, a command's output, a specific diff. "I wrote the code that should do it" is not evidence — leave the box empty.
- Untick a box whose evidence now contradicts it.
- Strike stale prose — acceptance criteria or narrative, anywhere in the body — by wrapping it in `~~`. **Strike, never delete.**
- Supersede a criterion inside its own line rather than adding one beside it:
  `- [x] ~~Returns 418 on replay~~ Returns 409 on replay`

### 3. Build the notes comment

One durable comment per issue, opening with `<!-- implement:notes -->`. It **accumulates**: read the existing one and merge into it.

- **AC table** — one row per criterion, keyed on the line's *live* text (what is left outside `~~…~~`). Same text updates the row, unseen text adds one, and a row whose criterion is no longer in the body is marked `withdrawn` and kept. A supersede this run performed renames its row — `Returns 409 on replay (was: 418)` — because it knows both texts; withdrawn-plus-new is only for a criterion that vanished between runs.
- **Deviations** — append-only bullets. A deviation *contradicts or exceeds the issue text*: a changed or dropped criterion, an unrequested addition. Every strike is one. Choices the issue left open — file layout, naming, which helper — are not, and belong in the summary.
- Unattended, head the comment with the branch. The PR cross-references itself onto the issue when the workflow opens it.
- **Issue with no Acceptance Criteria section:** skip the table, comment only when there is a deviation, and leave the body as it is.

### 4. Local only — one approval

Print the proposed body as a diff against the fresh one, plus the comment text, and ask once: "Apply to #\<number\>?" Rejected → write nothing, and say so in the summary.

### 5. Write

```bash
gh issue edit <number> --body-file "$body"

# Numeric id: the one from `gh issue view --json comments` is a GraphQL node id and 404s here.
id=$(gh api repos/{owner}/{repo}/issues/<number>/comments \
       --jq '.[] | select(.body | contains("<!-- implement:notes -->")) | .id')
if [ -n "$id" ]; then
  gh api "repos/{owner}/{repo}/issues/comments/$id" -X PATCH -F body=@"$notes"
else
  gh issue comment <number> --body-file "$notes"
fi
```

Skip either write when the new text is byte-identical to what is already there.

**A failed write never fails the run.** One attempt each; on failure print the payload it would have written and carry on. The branch is the output, and the PR the workflow opens from it — worth more than a bookkeeping call that 502s.
