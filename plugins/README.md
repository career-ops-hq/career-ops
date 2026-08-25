# career-ops plugins

The plugin layer is the **opt-in home for integrations that need a key or talk
to an external service** — things the zero-keys, local-first core deliberately
doesn't carry. It generalizes the proven `providers/` pattern: drop a directory
in here, declare a manifest, and it's discovered automatically.

> **Not the Claude Code plugin.** This is unrelated to `.claude-plugin/` (the
> Claude Code marketplace metadata). These plugins extend career-ops itself.

## Default: off

Plugins load **only** when you opt in. With no `config/plugins.yml`, the core
runs exactly as it always has — no plugin code runs, no `.env` is read, nothing
changes. Two gates must both be satisfied:

1. **Enable** the plugin in `config/plugins.yml` (copy `config/plugins.example.yml`).
2. **Provide its keys** in your own `.env` (each plugin declares which it needs).
   Run `node doctor.mjs` or `node plugins.mjs list` to see what's missing.

## Anatomy of a plugin

A plugin is a directory under `plugins/` (bundled, shipped with career-ops) or
`plugins.local/` (your own, gitignored, never auto-updated):

```
plugins/<id>/
  manifest.json     # parsed, not executed — validated before any code is imported
  index.mjs         # default-exports an object keyed by hook type
  _anything.mjs     # helpers (the _ prefix means "never discovered as a plugin")
```

### manifest.json

```json
{
  "id": "wellfound",                 // must equal the directory name; [a-z0-9-]
  "apiVersion": 1,
  "description": "One mission-framed line.",
  "hooks": ["provider"],             // any of: provider, ingest, search, notify, export
  "requiredEnv": ["WELLFOUND_TOKEN"],// env VAR NAMES only — values go in .env
  "allowedHosts": ["api.wellfound.com"], // required when requiredEnv is non-empty
  "humanInTheLoop": true             // must be true
}
```

### Hooks (`index.mjs` default export)

| Hook | Signature | Does |
|------|-----------|------|
| `provider` | `{ id, detect?, fetch(entry, ctx) → Job[] }` | A keyed/auth-gated job source. Same shape as `providers/_types.js`. Runs via `scan` on a `provider: <id>` entry in `portals.yml`. |
| `ingest` | `(ctx) → Job[]` | Pull postings from a service (email, a board). |
| `search` | `(query, ctx) → Job[]` | Postings for a query string. |
| `export` | `(snapshot, ctx) → {pushed}` | Push a **read-only** tracker snapshot to your own external store. |
| `notify` | `(payload, ctx) → void` | Send an outbound notification. |

Producers (`provider`/`ingest`/`search`) **return** `Job[]`
(`{title, url, company, location}`); the engine — never the plugin — writes them
to `data/pipeline.md` through the canonical writer, so a plugin can't break the
data formats the web reads. Non-provider hooks run explicitly:

```bash
node plugins.mjs list
node plugins.mjs run gmail                       # ingest
node plugins.mjs run notion search "platform"    # search
node plugins.mjs run notion export [--dry-run]   # export
```

### The `ctx` object

- `fetch(url, opts)` — the **guarded** primitive: HTTPS-only, pinned to your
  `allowedHosts`, `redirect:'manual'` re-validating every hop and stripping
  credentials on a hostname change. **Route your HTTP through `ctx.fetch`** (or
  the `fetchText`/`fetchJson` conveniences over it) so the egress guard actually
  runs — a plugin that calls global `fetch` bypasses it (the bundled `apify`
  plugin is one deliberate exception: its client self-constrains to a single
  hardcoded host, documented in its code).
- `env` (frozen, scoped to your declared keys), `settings` (your non-secret
  `config/plugins.yml` block), `log` (redacts your declared secrets), `dryRun`.

## Your own plugins → `plugins.local/`

Put private or experimental plugins in **`plugins.local/`** (a sibling of
`plugins/`), never in `plugins/`. `plugins.local/` is gitignored and never
auto-updated, so updates can't clobber it and a same-id bundled plugin can't be
shadowed by it. Bundled plugins always win an id collision.

## Trust model (read this)

career-ops is plain ESM with no build step, so the engine **cannot truly
sandbox** a plugin's imports. `allowedHosts`, the scoped `ctx.env`, and the
no-auto-submit hook taxonomy constrain an **honest** plugin and make every loaded
plugin visible (`doctor` / `plugins.mjs list`) — but they are not a hard
boundary against malicious code, which can reach `process.env` or the network
directly. Containment is the same as everywhere else in open source:

- **Bundled plugins** (`plugins/`) are code-reviewed exactly like `providers/`.
  CI checks that they declare no core-owned secret, import no browser-automation
  or process-spawning module, and never auto-submit.
- **`plugins.local/`** runs with **your** trust — you installed it. Treat a
  third-party plugin like any code you run on your machine.

## Not a plugin

These don't belong in the plugin layer — they're a different direction:

- **Centralized infrastructure** the project would operate — hosted job
  aggregation, a shared matching service, proxies/Workers. That's a **separate,
  opt-in service**, discussed in
  [Where career-ops is going (#904)](https://github.com/santifer/career-ops/discussions/904) —
  not the open-core.
- **Auto-submitting / blind-applying** to jobs. career-ops is a decision-support
  tool, not a spam bot — it drafts applications for **you** to review and submit.
  No hook can submit, and `humanInTheLoop: true` is mandatory. This holds
  everywhere, in core and plugins alike.

See `CONTRIBUTING.md` → "Scope" for the full boundary.
