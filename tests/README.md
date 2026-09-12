# tests/

Auto-discovered test files for the career-ops suite.

## Purpose

`test-all.mjs` (repo root) is the suite runner: it executes its inline core
checks (syntax, scripts, dashboard, data contract, personal data, paths) and
then auto-discovers every `*.test.mjs` file under this directory. There is no
test framework by design — the suite must run on a fresh clone with only
Node.js (`tests/helpers.mjs`).

## Layout

- `helpers.mjs` — shared assertion helpers and counters. Exports `pass`,
  `fail`, `warn`, plus `ROOT` (repo root), `QUICK` (`--quick` flag), and
  `NODE` (current Node binary).
- `providers/{name}.test.mjs` — one file per scanner provider (see
  [providers/ADDING_A_PROVIDER.md](../providers/ADDING_A_PROVIDER.md) for the
  test pattern), plus shared cross-provider tests such as
  `ats-ssrf-hardening.test.mjs`.
  Underscore-prefixed files (e.g. `_html-entities.test.mjs`) test shared
  helper modules.
- Other `*.test.mjs` files at this level (e.g. `stats.test.mjs`) cover root
  scripts. Note: standalone `*.test.mjs` files in the repo root are run by
  `test-all.mjs`'s inline script list, not by this directory's discovery.

**Web tests do not live here.** `web/` runs its own `npm test` over
`web/tests/**/*.test.mjs` (see [../web/README.md](../web/README.md)); this
directory is for the core. The two suites also differ in style on purpose: web
suites use `node:test`, while suites here use the `pass`/`fail` helpers because
this suite must run on a bare clone with no framework — "not even `node:test`"
(#1440). Don't carry either style across the boundary.

The one exception to the split is a guard *about* web's layout —
`web-test-layout.test.mjs` lives here on purpose, because `web-ci.yml` is
informative by design and never blocks a merge, while `test-all.mjs` runs on
every PR as a required check.

## Running

```bash
node test-all.mjs                            # full suite — run before pushing
node test-all.mjs --quick                    # full suite, skip dashboard build
node test-all.mjs --only providers/themuse   # only matching tests/ files
```

Discovery walks `tests/` recursively, sorted lexicographically for a
deterministic cross-OS order. `--only` filters on the tests-relative path and
exits 1 when nothing matches (so a typo cannot turn CI green).

**`--only` is a dev convenience, not a PR gate:** it skips every inline core
section of `test-all.mjs`. A green `--only` run is not a green suite — always
run the full `node test-all.mjs` before pushing.

## Adding a test

Add one `{name}.test.mjs` file here — it is auto-discovered, no registration
needed. Do not add a section to `test-all.mjs`. Import the helpers with a
path relative to the test file's location:

```js
import { pass, fail, ROOT } from './helpers.mjs';    // tests/*.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';   // tests/providers/*.test.mjs
```

See `CONTRIBUTING.md` for the full contribution flow.
