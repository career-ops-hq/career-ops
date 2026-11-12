# providers/

Job-source provider modules for the zero-token portal scanner (`scan.mjs`).

## Purpose

Each non-helper `*.mjs` file in this directory maps one public, no-auth job
source (ATS API, RSS/XML feed, or server-rendered HTML page) to the scanner's
normalized `Job` shape. Providers are zero-token by design: they hit public
endpoints directly, with no LLM calls and no login. The user-facing catalog of
supported sources lives in
[docs/SUPPORTED_JOB_BOARDS.md](../docs/SUPPORTED_JOB_BOARDS.md).

## Adding a provider

[**ADDING_A_PROVIDER.md**](ADDING_A_PROVIDER.md) is the full guide — the
module contract, the mandatory guards (SSRF hardening, defensive parsing, the
shared HTML-entity decoder, the absolute page ceiling), the test
requirements, and the pre-PR checklist. Start there. The authoritative type
catalog is [`_types.js`](_types.js).

Core providers must be zero-auth against public endpoints; auth-gated or
login-required sources belong in the plugin layer instead (see
[ARCHITECTURE.md](../ARCHITECTURE.md) and `CONTRIBUTING.md`).

## Loading and routing

There is no index file — discovery is filesystem-convention-based
(`_registry.mjs`):

1. Every `providers/*.mjs` file NOT starting with `_` is dynamically
   imported, in alphabetical order (so `detect()` priority is deterministic).
2. For each `portals.yml` entry, routing precedence is: explicit
   `provider: <id>` field first (bypasses detect), then the configured
   `local-parser`, then each provider's `detect()` in load order — first
   non-null hit wins.

Files whose names start with `_` are shared helpers, and `_registry.mjs`
never loads them as providers. Three of them matter when you write a
provider: `_types.js` (the contract typedefs), `_registry.mjs` (the loader
and router described above) and `_http.mjs` (the HTTP transport, with
retry). The rest cover HTML decoding, URL and network safety, caching, and
parsing country, salary and id fields; each one states its purpose in its
header comment. Before you write a parser of your own, run
`ls providers/_*` to see what already exists.
[ADDING_A_PROVIDER.md](ADDING_A_PROVIDER.md) covers the HTTP and retry
helpers in detail.
