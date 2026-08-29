# career-ops web (alpha)

An **experimental, opt-in web UI** for career-ops. It is a local-first *view* over
the exact same files the CLI reads and writes (`data/pipeline.md`,
`data/applications.md`, `reports/`, `config/`): no parallel engine, no separate
database, no server. If you never run it, nothing about your CLI workflow changes.

> **Status: alpha.** Expect rough edges. Feedback →
> [Discussion #1142](https://github.com/career-ops-hq/career-ops/discussions/1142) ·
> roadmap context → [Discussion #156](https://github.com/career-ops-hq/career-ops/discussions/156).

## Quick start

Requires Node 22+ (see [Tests](#tests) — `npm test`'s glob discovery needs it).

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. The app reads the career-ops checkout it lives in
(the parent directory) — your existing CV, pipeline and reports appear as-is.

The server binds IPv4 loopback, so reach it as `localhost` or `127.0.0.1`;
`http://[::1]:3000` has nothing listening on it.

## What works today

- **Pipeline** — your tracker as a sortable, filterable table; status changes
  write back through the core's own scripts.
- **Explore** — the free reverse-ATS scan with an honest partial-dataset
  indicator, plus AI-assisted discovery (bring your own CLI/keys, including Grok Build CLI).
- **Apply** — assisted form prefill with a hard rule inherited from the core:
  **it never submits for you** — you always press the button.
- **Today / Analytics / CV / Config** — action queue, funnel, CV editing with
  preview, settings.

## Safety

- **Local-first:** the local web app runs entirely on your machine — no cloud,
  no account needed. Your CV and data stay in your own files.
- **Loopback by default:** `npm run dev` and `npm start` bind `127.0.0.1`, so
  nothing else on your network can reach the dashboard. It has no login — the
  bind is the access control. Opt out deliberately with
  `CAREER_OPS_WEB_ALLOWED_HOSTS` ([below](#exposing-it-beyond-this-machine)).
- **Never auto-submits:** the apply flow drafts and prefills; submitting is
  always a human action.
- **CV generation never asks the agent to write:** the `pdf` worker tailors your
  CV and emits it inline in a `<<cv-html>>` envelope; the backend parses that
  envelope, writes the HTML, and renders the PDF itself. Job postings and
  evaluation reports are untrusted input that reaches this agent, so the safest
  thing is for it to hold no write tool at all — on Claude Code every write-capable
  tool is disallowed for this mode (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`
  and `Bash`). Other CLIs are invoked with a bare prompt and keep their own default
  tool access, so on those the agent still *holds* write tools — what the pipeline
  guarantees is that the CV which gets rendered is the one the backend parsed out of
  the envelope, never a file an agent wrote behind it.
- **Additive:** the web is isolated from the core's packaging, CI and release
  automation. The CLI works exactly the same without it.

## Development

```bash
npm run dev          # dev server (Turbopack)
npm test             # unit suites (node --test, no framework)
npx tsc --noEmit     # typecheck
npm run build        # production build
```

Set `CAREER_OPS_ROOT=/path/to/checkout` in `web/.env.local` to point the app at
a different career-ops directory (useful for testing against sample data).

`/api` is gated by the same-origin + loopback guard in `src/lib/origin-guard.mjs`.
Two opt-ins widen it, both unset by default and both in `web/.env.local`:
`CAREER_OPS_WEB_ALLOWED_HOSTS` names extra non-loopback hosts the dashboard may
answer on, and `CAREER_OPS_ALLOWED_ORIGINS` names origins allowed to call the
API from outside the app — a comma- or space-separated list, no trailing slash.
The second is what a local companion client needs: a browser extension calls
from a `chrome-extension://` origin, which Fetch Metadata always reports as
`cross-site`, so the guard refuses it unless the id is named here. The host
layer still applies to an allowlisted origin.

Pass one-off flags through npm's `--`: `npm run dev -- -p 4000`.

### Exposing it beyond this machine

`CAREER_OPS_WEB_ALLOWED_HOSTS` is the switch. Unset (or blank) the server binds
`127.0.0.1`; name a host it cannot already reach on loopback and the server binds
`0.0.0.0`, with the API guard answering for loopback and the hosts you named:

```bash
CAREER_OPS_WEB_ALLOWED_HOSTS="192.168.1.50" npm run dev
```

Naming only loopback (`localhost`, `127.0.0.1`, `::1`) is not an opt-in and
changes nothing — the guard already answers for those, so widening the socket
would expose every interface while granting no host that wasn't already allowed.

Set through `CAREER_OPS_WEB_ALLOWED_HOSTS`, neither layer can widen without the
other — the bind and the allow-list are derived from that one value. They are not
equivalent, and two things move them apart: the guard also answers for loopback,
which no bind address changes, and a `-H` of your own moves the bind while the
allow-list stays as it was (see below).

Understand what you are turning on. The host allow-list covers `/api/*` only
(`src/proxy.ts`'s matcher), so once the socket is open **every page the
dashboard renders — your CV, pipeline and reports — is readable by anyone who
can reach that port**, and there is no login. Two further caveats: a client that
can reach the port can also supply its own `Host` header, so on a widened bind
the allow-list filters honest clients rather than hostile ones; and `0.0.0.0` is
IPv4-only, so an opted-in IPv6 address will pass the filter with nothing
listening for it.

You can also override the bind directly — `npm run dev -- -H 0.0.0.0` — since
Next keeps the last value of a repeated option. **Prefer the env var.** An `-H`
on its own opens the socket while the allow-list stays empty, which is the one
combination with no honest reading: the guard then refuses LAN clients that
identify themselves truthfully and admits any that spell `Host: localhost`. The
launcher says so on startup rather than doing it quietly.

Use it on a network you trust, and prefer an SSH tunnel
(`ssh -L 3000:127.0.0.1:3000 you@box`) where you can — that needs no env var at
all and keeps the bind on loopback.

### Tests

Suites live in `web/tests/`, mirroring the path of what they test under
`web/src/` — so `src/lib/clean-chips.mjs` is tested by
`tests/lib/clean-chips.test.mjs`. Name the file `{module}.test.mjs`.

Root-level scripts are the one exception: `server.mjs` is tested by
`tests/lib/server-launcher.test.mjs`, because `test-all.mjs`'s parity check gates
only `web/tests/lib/` and a suite outside it would never run in the required check.

`npm test` discovers them with a glob (`tests/**/*.test.mjs`), so a new suite
needs **no registration** — just add the file. **Requires Node ≥ 22**: earlier
versions don't expand CLI globs for `node --test`, so `npm test` prints
`Could not find '…'`, runs nothing and exits 1. Hence `engines.node` in
`web/package.json` — a higher floor than `next` itself asks for.

Three constraints follow from all this:

- **Keep tests out of `src/`.** `src/` is the Next.js app's own tree, scanned by
  `next build`'s file tracing and `tsc --noEmit`; test files there entangle
  fixtures with build and route conventions.
- **Use `.mjs`, not `.ts`.** There is no test framework and no TypeScript loader
  by design — `node --test` cannot run a `.ts` suite, so one would look like
  coverage and never execute. Extract the logic under test into a plain `.mjs`
  module (the pattern `src/lib/pdf-paths.mjs` and `src/lib/pdf-render.mjs`
  already follow) and import it from the test.
- **Web suites use `node:test`; core suites don't.** Here you write
  `import { test } from "node:test"` with `node:assert/strict`. The root
  `tests/` suite deliberately uses neither — it has its own `pass`/`fail`
  helpers, because [#1440](https://github.com/career-ops-hq/career-ops/issues/1440)
  requires the core suite to run on a bare clone with "no framework, not even
  `node:test`". Don't carry either style across the boundary.

`tests/web-test-layout.test.mjs` in the **root** suite enforces all of the above
on every PR, including that `npm test` never goes back to listing suites by name
([#2360](https://github.com/career-ops-hq/career-ops/issues/2360)).
