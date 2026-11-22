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
- `run-discovered-child.mjs` — not a suite. `test-all.mjs` starts it once per
  discovered suite when suites run in parallel (see "Parallel runs" below).
- `providers/{name}.test.mjs` — one file per scanner provider (see
  [providers/ADDING_A_PROVIDER.md](../providers/ADDING_A_PROVIDER.md) for the
  test pattern), plus shared cross-provider tests such as
  `ats-ssrf-hardening.test.mjs`.
  Underscore-prefixed files (e.g. `_html-entities.test.mjs`) test shared
  helper modules.
- Other `*.test.mjs` files at this level (e.g. `stats.test.mjs`) cover root
  scripts. Note: standalone `*.test.mjs` files in the repo root are not
  discovered and will not run — `tests/no-root-suites.test.mjs` fails the
  build if one shows up (see "Why the flat root" in ARCHITECTURE.md).
  A handful of `*-tests.mjs` suites do remain at the root (a flag-driven CI
  harness, a suite that asserts on its own filename, two needing a per-script
  timeout, and one added after the convention was written); those are registered in
  `test-all.mjs`'s `scripts` list or invoked by a workflow, and
  `root-tests-registration.test.mjs` asserts every one of them is reachable.

**Web tests do not live here.** `web/` runs its own `npm test` over
`web/tests/**/*.test.mjs` (see [../web/README.md](../web/README.md)); this
directory is for the core. Web suites use `node:test`. Suites here may use
either the `pass`/`fail` helpers or `node:test`, which ships with Node, so both
run on a bare clone: `test-all.mjs` imports a `pass`/`fail` suite and runs a
`node:test` suite in a child process under `node --test`, folding its exit code
into the totals (#2463). `tests/helpers.mjs` is for this directory only; web
suites do not import it.

The one exception to the split is a guard *about* web's layout —
`web-test-layout.test.mjs` lives here on purpose, because `web-ci.yml` is
informative by design and never blocks a merge, while `test-all.mjs` runs on
every PR as a required check.

## Running

```bash
node test-all.mjs                            # full suite — run before pushing
node test-all.mjs --quick                    # full suite, skip dashboard build
node test-all.mjs --only providers/themuse   # only matching tests/ files
node test-all.mjs --quick --jobs 4           # at most 4 suites at a time
```

Discovery walks `tests/` recursively, sorted lexicographically for a
deterministic cross-OS order. `--only` filters on the tests-relative path and
exits 1 when nothing matches (so a typo cannot turn CI green).

**`--only` is a dev convenience, not a PR gate:** it skips every inline core
section of `test-all.mjs`. A green `--only` run is not a green suite — always
run the full `node test-all.mjs` before pushing.

## Parallel runs

The files in this directory are most of a full run, so they run several at a
time, each in a process of its own. The inline sections of `test-all.mjs` run
at the same time, in one more process, which takes one of the slots until it
finishes. How many slots, in order of precedence:

| Setting | Scope |
|---------|-------|
| `--jobs N` | this run |
| `CAREER_OPS_TEST_JOBS=N` | this machine: a shell profile, a CI job |
| every available CPU | the default |

`--jobs 1` (or `CAREER_OPS_TEST_JOBS=1`) runs the inline sections and then
imports every suite, one after another, all in the runner's own process, which
is how the suite ran before `--jobs` existed. A value that is not a positive
integer is a usage error, not a fallback to the default.

**What does not change.** The output is printed in discovery order whatever
finished first: each suite's output is held until its turn comes, so two runs
of the same tree print the same log. The totals and the exit code are the same
as a serial run's. The inline sections of `test-all.mjs` still run one after
another and still print first: they stream as they run, and no suite's output
appears until the last of them has finished.

One thing a serial run does differently: a section that throws or exits ends a
serial run on the spot, with no summary. In a parallel run the suites have
already run, so it is reported as one failure and the run goes on to its
summary.

**What a suite must not rely on.** Running alone in a process is stricter than
running after 600 others in one:

- **Another suite's leftovers.** An environment variable, a module-level cache
  or a process-wide listener set by an earlier suite is not there. Set up what
  you need.
- **A fixed path.** Two suites writing the same file now do it at the same
  time. Use `mkdtempSync` for scratch space, never a constant name.
- **Having the checkout to itself.** The inline sections and the other suites
  read the repository while yours runs: section 1 checks every `.mjs` file it
  finds, section 2 copies the tree, and several suites walk it. Put fixtures
  under `tmpdir()`. One that has to sit inside the checkout (a script that
  must resolve `node_modules`, a directory git must not know) goes in the
  repository root under `SCRATCH_PREFIX` from `lib/scratch-dirs.mjs`: the
  shared walker (`lib/walk-tree.mjs`) skips that prefix and `.gitignore`
  covers it. `scratch-dirs.test.mjs` fails a `mkdtempSync(join(ROOT, …))`
  that does not carry it. A file the real scripts read, such as the
  `.career-ops-data` marker, is never a fixture: see "The suite's data root"
  below.
- **An open handle.** A server, watcher or timer you do not close keeps the
  process alive. The runner cuts the suite off a few seconds after it finishes
  and names it at the end of the run; close what you open.
- **Work you did not await.** Use top-level `await`. An error thrown from a
  timer after the suite has finished is reported as a failure of that suite.
- **A tight time limit.** With every core busy a suite takes noticeably longer
  than it does alone. A `node:test` suite gets four times its usual 30-second
  budget in a parallel run for that reason; a timeout inside a suite gets no
  such allowance.

**If a parallel run looks wrong**, rerun it with `--jobs 1`. A failure that
disappears there is one of the cases above, in the suite or section that failed
or in one it used to follow.

A suite that starts a `test-all.mjs` of its own gets a serial one unless it
passes `--jobs` itself: the runner sets `CAREER_OPS_TEST_JOBS=1` for everything
it starts, so N workers do not fan out N more each.

## One full run at a time

A full run already keeps every core busy, so two started together (from two
agent sessions in two worktrees, say) each get half the machine and overrun
their timeouts. A full run therefore waits for any other full run on the
machine to finish first, and says so:

```
  ⏳ another full test-all.mjs run holds the queue (pid 4242 in /path/to/worktree, for 3 min) — waiting for it to finish.
```

The queue is a `lib/dir-lock.mjs` lock in the OS temp directory, shared by
every clone and worktree. A run that is killed leaves a lock whose PID is dead,
and the next run takes it over. Waiting runs are not served strictly in the
order they arrived, but only one proceeds at a time. A waiter gives up after
an hour with the same holder, naming it.

`--only` runs do not queue: they are small, and they are what you run while a
full run is going. `CAREER_OPS_TEST_QUEUE=0` turns the queue off for a run; the
run holding the queue sets it for everything it starts, so a suite that starts
a `test-all.mjs` of its own does not wait for its parent. Fixture runners
(`tests/test-all-sandbox.mjs`) set it too. `CAREER_OPS_TEST_QUEUE_LOCK=<dir>`
puts the lock somewhere else.

## Adding a test

Add one `{name}.test.mjs` file here — it is auto-discovered, no registration
needed. Do not add a section to `test-all.mjs`. Import the helpers with a
path relative to the test file's location:

```js
import { pass, fail, ROOT } from './helpers.mjs';    // tests/*.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';   // tests/providers/*.test.mjs
```

See `CONTRIBUTING.md` for the full contribution flow.

## The suite's data root

The suite is run inside real workspaces, so it never reads or writes the
developer's data. When `helpers.mjs` loads it creates a scratch directory, pins
`CAREER_OPS_ROOT` to it (clearing `CAREER_OPS_DATA_DIR`, as it clears
`CAREER_OPS_TRACKER`), and removes it at exit. Every script a test spawns
inherits that, so the default for a new test is already safe.

- **A test that needs data** writes it under a `mkdtemp` directory and passes
  that directory to the child: `env: { ...process.env, CAREER_OPS_ROOT: dir,
  CAREER_OPS_DATA_DIR: '' }`. Never write a fixture over a file under `ROOT`
  and put the original back afterwards — an interrupted run does not reach the
  `finally`, and `data/` is not in git.
- **A test that copies scripts into a temp directory** and expects the copy to
  be its own data root spawns it with `env: ownRootEnv()`.
- **A test that must change the variable in-process** calls
  `pinSandboxDataRoot()` when it is done, rather than `delete`.
- `SANDBOX_DATA_ROOT` is the scratch root, for a fixture that has to sit under
  the data root's `output/` or `jds/`.

`data-root-guard.mjs` fingerprints the real user layer before the run and at
exit — including an exit by Ctrl-C — and fails the run, naming each path, if
anything differs. That includes the user files resolved from the checkout
rather than the data root (`plugins.local/`, `plugins.lock`, `opencode.json`,
`.claude/settings.json`, `.claude/hooks/`), which the scratch root does not
move: a test that touches them works in a fixture checkout of its own.
