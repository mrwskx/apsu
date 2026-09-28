# CLAUDE.md - Apsu

## Overview

<!-- Describe what this project is and what Claude does in it. -->

## Purpose

<!-- Describe the user's goal and Claude's role in reaching it. -->

## Workflow

### Response Style

Default to professional tightness. Drop filler words, pleasantries, hedging ("certainly", "great question", "I'll go ahead and"). Keep full sentences and articles. Technical terms, code blocks, IDs, error strings always verbatim. Expand to normal prose only for irreversible-action confirmations or multi-step sequences where compression risks misunderstanding.

## Skills

Match user's request to skill and invoke.

### Planning & Design

| Skill                 | Trigger                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `grilling`            | "grill me", "stress-test this", "poke holes in this", "interview me about this plan"           |
| `domain-modeling`     | "what should we call this", "pin down the terminology", "record this decision", "write an ADR" |
| `codebase-design`     | "design this module", "what's the right interface here", "is this a deep module"               |
| `codifying-standards` | "make that a rule", "we should always do X", "that's the third time we've fixed this"          |

### Building

| Skill                       | Trigger                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `implement`                 | `/implement`, "implement issue N", "work issue N", "pick up issue N"                        |
| `tdd`                       | "test-first", "red-green", "write the test first", "add integration tests"                  |
| `prototype`                 | "prototype this", "spike it", "does this state model feel right", "try a few UI variations" |
| `diagnosing-bugs`           | "diagnose this", "debug this", something broken / throwing / failing / slow                 |
| `resolving-merge-conflicts` | "resolve the conflicts", "fix this merge", "finish the rebase"                              |
| `ponytail`                  | "be lazy", "simplest solution", "yagni", "do less", complaints about over-engineering       |

### Review & Ship

| Skill             | Trigger                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `code-review`     | "review this branch", "review since main", "review my changes", `/code-review`                      |
| `commit-changes`  | "commit", "commit this", "commit my changes", "make a commit", "create a commit", `/commit-changes` |
| `open-pr`         | "open a PR", "open a pull request", "create a PR", "push and open PR", `/open-pr`                   |
| `ponytail-review` | "review for over-engineering", "what can we delete", "is this over-engineered", `/ponytail-review`  |

### Research

| Skill      | Trigger                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `research` | "research this", "look up how X works", "gather the API facts", "check the docs" |

### Agent Skills (Issue Tracking & Triage)

**Issue tracker** — GitHub Issues (`github.com/mvshvssv/apsu`), via `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

**Triage labels** — Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

**Domain docs** — Single-context: `CONTEXT.md` at repo root, `docs/adr/` for past decisions. See `docs/agents/domain.md`.

**Code style** — Conventions tooling can't enforce, across all code. See `docs/agents/code-style.md`.
