# Code Style

This repo local style rule: mechanical convention tooling cannot enforce.

## Tooling owns style

`eslint.config.js`, `.prettierrc.json`, `tsconfig.json` = style definition here. No hand-police what they enforce. No restate rule in prose — read config.

Before call work done:

```bash
pnpm lint:fix
pnpm format
pnpm typecheck
pnpm test
```

`.husky/pre-commit` run `pnpm lint && pnpm format:check`, reject commit if either fail. Skip these only move failure later.

Fix code, not linter: silence rule to make `pnpm lint` green not fix. See **Escape hatches** for narrow legit disable.

## Prototypes

Tooling still apply to spike. Judgment rule — no.

## Comments

Explain why, not what. Keep the density low; a comment earns its place by
carrying context the code cannot.

```ts
// Authorization for `Skill(implement)` under GitHub Actions.
//
// The skill is model-invocable, so Claude decides *whether* a comment meant
// "implement". These rules decide whether it is *allowed to*, from facts the
// agent cannot write: the issue's labels and its author's association.
```

`// gates the implement skill` would have earned nothing. A comment that
records a decision should name the ADR that made it — that is how a reader
gets from a line of code to the reasoning behind it.

## Escape hatches

No `eslint-disable` or `@ts-expect-error` without reason attach. Use `--` form so reason travel with directive:

```ts
// eslint-disable-next-line no-param-reassign -- writing through the ref is the point
ref.current = node;
```

Reason say why rule wrong _here_. Restate what rule check earn nothing. Narrow to one line — file-wide disable hide next violation.

## Scripts

One directory per script, named for script. `index.ts` = I/O composition root. Pure logic in `<name>.utils.ts`. Test colocated `<name>.utils.test.ts` — cover `.utils`, not `index.ts`.

```
scripts/
├── generate-pr-description/
│   ├── index.ts                              # argv, git, stdout
│   ├── generate-pr-description.utils.ts      # pure functions
│   └── generate-pr-description.utils.test.ts
└── validate-skills/
    ├── index.ts                              # reads files, prints, throws
    ├── validate-skills.utils.ts              # pure functions
    └── validate-skills.utils.test.ts
```

`index.ts` hold every side effect — read, spawn, print, throw. Keep it straight-line: no branch worth test belong there. Push decision into `.utils` where test reach it without filesystem.

Pass resolved value into pure function, not the means to fetch it. `findMissingSkills` take `(path) => boolean` and `findSymlinkIssue` take link target string — caller do I/O first. Run script by `tsx`. Wire as `package.json` script only when a human run it local — `pnpm validate-skills` earn its entry, a CI-only or hook-only entry point no. Those invoke by path: `pnpm tsx scripts/<name>/index.ts`, same as `generate-pr-description` do from `pr-description.yml` and the `open-pr` skill. Manifest script = local development surface, not inventory of every script.
