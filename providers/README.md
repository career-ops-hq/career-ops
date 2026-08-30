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

Underscore-prefixed files are shared helpers, never loaded as providers:
`_types.js` (contract typedefs), `_registry.mjs` (loader/router),
`_http.mjs` (HTTP transport), `_html-entities.mjs`, `_html-to-text.mjs`
(description HTML → plain text), `_config-utils.mjs`, `_trust-validator.mjs`.
