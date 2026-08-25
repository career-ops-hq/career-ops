// Type catalog for the career-ops plugin contract.
//
// Documentation-only — pure JSDoc @typedef annotations, no build step (the
// project is plain ESM JavaScript). Plugin authors reference these via
// `/** @typedef {import('../_types.js').PluginManifest} PluginManifest */` at
// the top of a `// @ts-check`-enabled file to get IDE hints. The runtime
// contract is enforced by _engine.mjs (validateManifest), not by these
// annotations — exactly the providers/_types.js + scan.mjs split.
//
// Files prefixed with _ are shared helpers and are NEVER discovered as plugins.
//
// A plugin is a directory under plugins/ (bundled, system layer) or
// plugins.local/ (user-installed, gitignored) containing a manifest.json and an
// entry module (default index.mjs). The manifest is JSON — parsed, not executed
// — so the loader and `doctor` can validate and list a plugin WITHOUT importing
// its code. The entry module default-exports an object keyed by hook type.
//
// The unit of currency for the producer hooks is the SAME `Job` the scanner
// uses — see providers/_types.js. Producers RETURN Job[]; the engine (never the
// plugin) writes them through scan.mjs's canonical writers, so a plugin can
// never break the web-facing data formats.

/**
 * The plugin manifest — `plugins/<id>/manifest.json`. Named manifest.json (NOT
 * plugin.json) to avoid colliding with the repo's existing
 * `.claude-plugin/plugin.json` (the unrelated Claude Code plugin marketplace).
 *
 * @typedef {object} PluginManifest
 * @property {string}   id           REQUIRED. ^[a-z0-9][a-z0-9-]*$. MUST equal the directory name (dedup key + anti-spoof).
 * @property {number}   apiVersion   REQUIRED. Must be 1. The engine refuses unknown majors so ctx/hook-signature changes can be versioned once external plugins exist.
 * @property {string}   description  REQUIRED. One line, mission-framed (no revenue/pricing/moat/hosted wording — it ships in a public repo).
 * @property {string[]} hooks        REQUIRED, non-empty. Subset of {'provider','ingest','search','notify','export'}. Anything else (e.g. 'apply'/'submit') is REJECTED — there is deliberately no auto-submit hook.
 * @property {string[]} requiredEnv  REQUIRED (may be []). Env VARIABLE NAMES only, never values. The user supplies values in their own gitignored .env. A reserved-name denylist (core secrets, PATH, AWS_*, …) is rejected.
 * @property {string}   [name]       Optional human label for `doctor`/CLI listings.
 * @property {string}   [version]    Optional semver of the plugin itself.
 * @property {string}   [entry]      Optional. Default 'index.mjs'. Must be a relative *.mjs path that stays inside the plugin directory (traversal-guarded).
 * @property {string[]} [optionalEnv] Optional extra env var names (same denylist applies).
 * @property {string[]} [allowedHosts] Optional egress allowlist. REQUIRED (loader-enforced) when requiredEnv is non-empty. ADVISORY: it catches an honest plugin's own SSRF/redirect bugs when it routes through ctx — it is NOT a containment boundary against malicious code (see the trust note in README.md).
 * @property {boolean}  humanInTheLoop REQUIRED true. The loader hard-rejects false. A plugin may read/ingest/search/notify/export — never auto-submit a job application.
 * @property {string}   [homepage]   Optional URL.
 */

/**
 * The capability object the engine builds per plugin and passes to every hook.
 * Least-privilege by construction, but a CONVENIENCE not a security sandbox —
 * plain ESM cannot isolate a module's ambient imports without a build step.
 * Containment is code review (bundled plugins, same gate as providers/) plus
 * the user's own trust for plugins.local/. See README.md "Trust model".
 *
 * @typedef {object} PluginContext
 * @property {'http'} transport
 * @property {(url: string, opts?: object) => Promise<Response>} fetch  The guarded primitive (HTTPS-only, allowedHosts-pinned, redirect:'manual' with every hop re-validated + cross-host credential strip). Bundled plugins route HTTP through this so the egress guard actually runs. Throws on non-2xx.
 * @property {(url: string, opts?: object) => Promise<string>}  fetchText  Convenience over ctx.fetch → .text().
 * @property {(url: string, opts?: object) => Promise<unknown>} fetchJson  Same guard as fetchText.
 * @property {Readonly<Object<string,string>>} env  Frozen, scoped to this plugin's declared requiredEnv ∪ optionalEnv. A convenience accessor — NOT an isolation boundary (process.env stays globally reachable from any module).
 * @property {Readonly<Object<string,unknown>>} settings  Frozen non-secret settings block for this plugin from config/plugins.yml (e.g. { label, days_back, actor }). Secrets never live here — they go in .env via requiredEnv.
 * @property {(...args: unknown[]) => void} log  Console logger that redacts declared env values from output (accidental-leak hygiene, not an exfiltration control).
 * @property {boolean} dryRun  True when invoked with --dry-run; side-effecting hooks must honor it.
 */

/**
 * The default export of a plugin's entry module — an object with one function
 * per declared hook. Only the hooks named in the manifest are loaded.
 *
 * - provider: BYTE-IDENTICAL to providers/_types.js Provider, plus ctx.env. A
 *   keyed/auth-gated job source. The engine forces detect() to null so a keyed
 *   provider only fires on an explicit `provider: <id>` portals.yml entry —
 *   never via auto-detection (no surprise paid/keyed network during a scan).
 * - ingest:  pull postings from a service (email, a Notion board) → Job[]. The
 *   engine appends them to data/pipeline.md canonically.
 * - search:  Job[] for a query string → engine writes canonically to pipeline.
 * - export:  receives a frozen read-only snapshot of the user's tracker and
 *   pushes it to the user's OWN external store; returns {pushed}. No file handle.
 * - notify:  outbound, ephemeral notification of a payload.
 *
 * @typedef {object} PluginHooks
 * @property {{ id: string, detect?: (entry: object) => ({url: string}|null), fetch: (entry: object, ctx: PluginContext) => Promise<object[]> }} [provider]
 * @property {(ctx: PluginContext) => Promise<object[]>} [ingest]
 * @property {(query: string, ctx: PluginContext) => Promise<object[]>} [search]
 * @property {(snapshot: Readonly<object>, ctx: PluginContext) => Promise<{pushed: number}|void>} [export]
 * @property {(payload: Readonly<object>, ctx: PluginContext) => Promise<void>} [notify]
 */

export {};
