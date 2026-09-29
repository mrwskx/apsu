# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

`ready-for-agent` here means "an agent can finish this on a GitHub Actions runner". Whatever `ci.yml` runs, an agent can reach on its own. What it cannot do is look at anything. An issue whose acceptance criteria need a person to judge rendered output is `ready-for-human`, however well specified it is.

The label is load-bearing: without it an implement run is refused before any agent starts, and `scripts/gate-implement` fails the job if one is dispatched anyway.

Edit the right-hand column to match whatever vocabulary you actually use.

## CI/CD workflow configuration is always `ready-for-human`

A ticket that requires changing CI/CD workflow configuration is never `ready-for-agent` — on any tracker, an agent's push credentials cannot modify workflow definitions, so the change is rejected. Give the workflow change its own `ready-for-human` ticket; tickets blocked by it can stay `ready-for-agent`.
