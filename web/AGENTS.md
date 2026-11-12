# Working in `web/`

The web app is a **view over the user's own files**, not a second engine. Read this
before changing anything under `web/`.

## The three rules that are not style preferences

1. **Orchestrate the core; never reimplement it.** The CLI already resolves tracker
   paths, matches tailored CVs and canonicalises statuses: call it, or mirror it
   behind a parity test. A second implementation of the same rule is how the two
   halves start disagreeing, and the disagreement is always silent.
   `web/src/lib/core/` holds the access layer for exactly this.

2. **Markdown is the source of truth.** `data/applications.md`, `cv.md`, `reports/`
   are canonical; anything else is a derived index. Status changes go through
   `/api/status`, which delegates to the root `set-status.mjs`. That is the single
   write path, and it is single on purpose. Never write a user's file from a route
   that bypasses it.

3. **Nothing is ever submitted automatically.** The apply flow fills in and previews;
   a human presses send. There is no exception, no flag, and no "just for testing".
   The browser is the Playwright session from `apply-scope.mjs`. Do not attach to
   the user's open Chrome, read `DevToolsActivePort`, or pass a remote-debugging port.

## A missing file is not a malformed file

Treating a parse error as "not there yet" is how a user's config gets overwritten
with the shipped example. Distinguish `ENOENT` from every other failure, and let a
broken user-layer file surface as an error the user can act on rather than as an
empty default. (`web/src/lib/portals-config.mjs` is the worked example.)

## Testing

Logic that deserves a test lives in a plain `.mjs` module so `node --test` can import
it with no build step and no `@/` alias loader. See `tracker-table.mjs`,
`cv-selection.mjs`, `report-sections.mjs`. A component is not a place to put a rule
you want to assert.

```
npm test          # node --test "tests/**/*.test.mjs"
npm run typecheck # tsc --noEmit
npm run dev       # the app, reading the sibling career-ops files
```

Point `CAREER_OPS_ROOT` at a scratch directory when you need data to test against;
it is how the app finds the user's files, and it keeps your real pipeline out of it.

## Reviews and scope

`web/` is maintained as first-party: functional and correctness fixes are very
welcome, design and feature proposals are routed to Discussion #156 so the surface
stays coherent. That is a routing decision, not a judgement on the work.

## Next.js version

This app runs a recent Next.js whose APIs and conventions may differ from your
training data: read the relevant guide in `node_modules/next/dist/docs/` before
writing code. `agentRules: false` in `next.config.mjs` stops `next dev` from
rewriting this file.
