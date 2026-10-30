// tests/web-test-layout.test.mjs — freezes web/'s test DISCOVERY contract (#2360).
//
// web/ used to carry two conventions at once: suites under web/tests/ plus two
// hand-enumerated at the web root, listed by name in web/package.json's `test`
// script. A suite missing from that list never ran and `npm test` still exited
// 0. #1440, the parent issue, named that failure mode directly — "the runner
// should also fail hard if the glob matches zero files, so a path typo can't
// silently turn CI green" — and removed it from the root suite. web/ kept it,
// and it nearly cost two suites for real during #2182, where either side of a
// package.json conflict would have dropped them with CI green.
//
// This guard lives in the ROOT suite, not web/tests/, deliberately:
//   1. .github/workflows/test.yml runs test-all.mjs on every PR with no paths
//      filter and is a required check. web-ci.yml is informative by design —
//      "a red here never blocks a core merge" — so it cannot be the enforcer.
//   2. A guard inside web/tests/ would be discovered by the very glob it
//      validates: if the glob breaks, the guard silently stops running too.
// Same reach-into-web/ pattern as test-all.mjs's 55.3c/55.3d freezes (#2369).
//
// ONE responsibility: web/'s suites must be reachable by what `npm test`
// actually runs. Every assertion below is a facet of that — including the
// engines floor, which is checked because a glob operand is unrunnable below
// Node 22, not as general Node policy.
//
// It asserts PROPERTIES, not a frozen script string, so a legitimate
// restructure is not blocked.
import { pass, fail, ROOT, walkFiles } from './helpers.mjs';
import { join, relative, sep } from 'path';
import { readFileSync, existsSync } from 'fs';

console.log('\nweb/ test discovery contract (#2360)');

const WEB = join(ROOT, 'web');
const WEB_PKG = join(WEB, 'package.json');

// `node --test` only expands CLI globs from Node 22 on: 18.19.1 and 20.11.1
// both print "Could not find '<pattern>'", run 0 tests and exit 1 (measured).
// So a glob-discovered suite is only actually runnable at >= 22 — this is the
// binding constraint on web/'s engines floor. next@16.2's own >=20.9.0 is a
// separate, lower one and does NOT satisfy discovery.
const GLOB_FLOOR = [22, 0, 0];

/**
 * Run one scenario in isolation.
 *
 * Each case gets its own try/catch so a throw in one cannot collapse the rest
 * into a single unexplained failure (PIT — every case stands alone, in any
 * order). A guard that cannot inspect the tree must be loud, never a silent
 * pass — the same stance as test-all.mjs's SYSTEM_PATHS coverage probe.
 *
 * @param {string} label - What this scenario checks, used in the error path.
 * @param {() => void} body - The When/Then; calls pass() or fail() itself.
 * @returns {void}
 */
function scenario(label, body) {
  try {
    body();
  } catch (err) {
    fail(`could not verify ${label} (#2360): ${err.message}`);
  }
}

/**
 * Translate a `node --test` glob operand into an anchored matcher.
 *
 * Supports exactly the two constructs `node --test` expands — `**` spanning
 * separators (and matching zero segments, so `tests/**\/*.test.mjs` reaches
 * `tests/x.test.mjs`) and `*` within one segment. Anything else in a pattern
 * is out of contract: it is treated literally, which fails closed by reporting
 * suites as unreachable rather than waving them through.
 *
 * @param {string} pattern - A glob operand from the `test` script.
 * @returns {RegExp} Matcher for web-relative, `/`-separated paths.
 */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c !== '*') {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    } else if (pattern[i + 1] === '*') {
      out += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else {
      out += '[^/]*';
    }
  }
  return new RegExp(`^${out}$`);
}

const order = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/**
 * Parse an `engines` range into alternatives, each a half-open interval
 * `{ lower, uppers }`: admitted versions are `>= lower` and `< every upper`.
 *
 * Validates the WHOLE range against one deliberately narrow grammar:
 * alternatives separated by `||`, each a whitespace-separated set of
 * comparators — `>=`, `<=`, `<` or `^` followed by a 1-to-3 component version —
 * with exactly one lower bound (`>=` or `^`). Partial versions read the way npm
 * reads them: `<=22` is `<23.0.0`, `<=22.5` is `<22.6.0`, `^22.13` is
 * `>=22.13.0 <23.0.0`. Every upper bound must leave its lower bound
 * satisfiable, so `>=22 <25` and `>=22 <=22` are accepted while
 * `>=22.0.0 <20.0.0` and `>=22.0.0 <22.0.0` are not.
 *
 * Anything outside the grammar returns null and is reported as unverifiable
 * rather than guessed at, because guessing silently blesses a Node that cannot
 * run the suite. Refused, with the reason: `<=23.0.0` and `>=22 || <=20` (an
 * alternative with no lower bound), `>=22 ||` (npm reads an empty alternative
 * as "any version"), `>=22.0.0 garbage` (trailing junk), `^0.5.0` (caret on
 * major 0 has different semantics), `~22.13` / `22.x` / `>22` (operators this
 * guard does not parse).
 *
 * Evaluating the full npm range grammar properly needs a semver evaluator.
 * `semver` is not a dependency of this repo and is not installed, Node ships no
 * built-in equivalent, and `tests/` must stay dependency-free — it ships to end
 * users via SYSTEM_PATHS and #1440 requires the suite to run on a bare clone.
 * So the burden is inverted: prove the floor or refuse the range.
 *
 * @param {string} range - An `engines.node` value.
 * @returns {{lower: number[], uppers: number[][]}[]|null} Alternatives, or null if not provable.
 */
function parseRange(range) {
  const alternatives = [];
  for (const alt of range.split('||')) {
    const terms = alt.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;   // empty alternative — npm reads it as `*`
    const lowers = [];
    const uppers = [];
    for (const term of terms) {
      const m = term.match(/^(>=|<=|<|\^)(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/);
      if (!m) return null;   // unknown operator, x-range, leading zero, single `|`, or junk
      const [, op, major, minor, patch] = m;
      const version = [Number(major), Number(minor ?? 0), Number(patch ?? 0)];
      // Past 2^53 - 1, Number() rounds, so the range evaluated would not be the one declared.
      if (!version.every(Number.isSafeInteger)) return null;
      if (op === '>=') {
        lowers.push(version);
      } else if (op === '<') {
        uppers.push(version);
      } else if (op === '<=') {
        // Inclusive bound as the next exclusive one, bumping the last component given.
        uppers.push(patch !== undefined ? [version[0], version[1], version[2] + 1]
          : minor !== undefined ? [version[0], version[1] + 1, 0]
            : [version[0] + 1, 0, 0]);
      } else {
        if (version[0] === 0) return null;   // ^0.x bounds on the minor, not parsed here
        lowers.push(version);
        uppers.push([version[0] + 1, 0, 0]);
      }
    }
    if (lowers.length !== 1) return null;
    // `<=` and `^` derive their bound by adding 1, which can step past 2^53 - 1 too.
    if (!uppers.flat().every(Number.isSafeInteger)) return null;
    const lower = lowers[0];
    // An upper bound at or below the floor makes the alternative unsatisfiable.
    if (uppers.some((u) => order(u, lower) <= 0)) return null;
    alternatives.push({ lower, uppers });
  }
  return alternatives;
}

/**
 * Lowest Node version an `engines` range provably admits, as [major, minor, patch].
 *
 * The minimum over every `||` alternative, so a union is judged by its lowest
 * term, not its first: `^22.0.0 || >=20.0.0` has floor 20.0.0.
 *
 * @param {string} range - An `engines.node` value.
 * @returns {number[]|null} [major, minor, patch], or null if not provable.
 */
function floorOf(range) {
  const alternatives = parseRange(range);
  if (!alternatives) return null;
  return alternatives.map((a) => a.lower).sort(order)[0];
}

/**
 * Whether an `engines` range admits a Node version.
 *
 * @param {string} range - An `engines.node` value.
 * @param {string} version - A full `major.minor.patch` version.
 * @returns {boolean|null} The verdict, or null if the range is not provable.
 */
function admits(range, version) {
  const alternatives = parseRange(range);
  if (!alternatives) return null;
  const v = version.split('.').map(Number);
  return alternatives.some(({ lower, uppers }) =>
    order(v, lower) >= 0 && uppers.every((u) => order(v, u) < 0));
}

// web/ is NOT in update-system.mjs's SYSTEM_PATHS but tests/ is, so this file
// ships to end users whose checkout has no web/ at all. The invariant is
// conditional ("if web/ exists, its suites are reachable") and vacuously true
// there — but say so out loud rather than skipping in silence.
if (!existsSync(WEB_PKG)) {
  pass('web/ is not present in this checkout — discovery contract not applicable');
} else {
  // ── Given: what is on disk, and what web/package.json claims to run ──

  // Anything a contributor would reasonably expect to be run: the sanctioned
  // {module}.test.{ext} and the legacy test-{module}.{ext}. Non-.mjs
  // extensions are caught on purpose — `node --test` cannot run a .ts suite
  // without a loader, so one would sit in the tree looking like coverage and
  // never execute.
  const TEST_FILE = /(?:\.test\.(?:mjs|js|ts|tsx)|^test-.*\.(?:mjs|js|ts|tsx))$/;
  // Scoped to what web/ TRACKS (#3890): walkFiles enumerates the index now, so
  // `node_modules`, `.next`, `out`, `dist` and `coverage` drop out because git
  // does not track them, not because this file remembered to list them. That
  // list was also the narrowing hazard — an unlisted generated directory put a
  // built copy of every suite under the contract, and a suite added under a
  // listed one silently left it. node_modules mattered for speed too: a
  // populated web/node_modules is ~400 MB (see test-all.mjs's copy-exclusion
  // note), and the index never walks into it at all.
  const found = walkFiles(WEB, TEST_FILE)
    .map((p) => relative(WEB, p).split(sep).join('/'));

  const pkg = JSON.parse(readFileSync(WEB_PKG, 'utf8'));
  const script = pkg.scripts?.test ?? '';
  // Tokenize respecting quotes, then keep only path-shaped operands. Shape, not
  // position, decides what counts — so a flag value like `--test-reporter spec`
  // and any command prefix are both excluded without hardcoding an argv index.
  const operands = (script.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((t) => t.replace(/^["']|["']$/g, ''))
    .filter((t) => !t.startsWith('-'))
    .filter((t) => /\.(mjs|js|ts|tsx)$/.test(t) || t.includes('*'));
  const patterns = operands.filter((t) => t.includes('*'));
  const enumerated = operands.filter((t) => !t.includes('*'));

  const misplaced = found.filter((p) => !p.startsWith('tests/') || !p.endsWith('.test.mjs'));

  // ── Every suite sits where the glob can see it, under the right name ──
  scenario('where web suites live', () => {
    if (misplaced.length === 0) {
      pass(`all ${found.length} web suites live under web/tests/ as {module}.test.mjs`);
    } else {
      fail(`web suites outside the discovered layout (#2360): ${misplaced.join(', ')}`
        + ' — web tests live at web/tests/{dir}/{module}.test.mjs mirroring web/src/,'
        + " and must end in .test.mjs for `npm test`'s glob to run them");
    }
  });

  // ── The script discovers by pattern; it never lists suites by name ──
  scenario('that the test script names no suites', () => {
    if (enumerated.length === 0) {
      pass('web/package.json test script enumerates no suites by name');
    } else {
      fail(`web/package.json test script names suites explicitly (#2360): ${enumerated.join(', ')}`
        + ' — a suite missing from a hand-maintained list never runs and `npm test` still exits 0;'
        + ' rely on the tests/**/*.test.mjs glob instead');
    }
  });

  scenario('that the test script declares a pattern', () => {
    if (patterns.length > 0) {
      pass(`web test script discovers by pattern (${patterns.join(', ')})`);
    } else {
      fail('web/package.json test script declares no glob pattern (#2360)'
        + ' — expected something like: node --test "tests/**/*.test.mjs"');
    }
  });

  // ── A pattern that matches nothing exits 0 (#1440's zero-match rule) ──
  // Verified on Node 22: `node --test "zzz/**/*.test.mjs"` exits 0 with zero
  // tests run. A missing literal path exits 1, so THIS is the silent case.
  scenario('that web discovery is non-empty', () => {
    if (found.length > 0) {
      pass(`web test discovery is non-empty (${found.length} suites on disk)`);
    } else {
      fail('no web test suites found under web/ (#2360, #1440) — an empty glob exits 0,'
        + ' so zero web coverage would look identical to a green run');
    }
  });

  // ── ...and the declared pattern actually reaches each one ──
  scenario('that the declared glob reaches every suite', () => {
    const patternMatchers = patterns.map(globToRegExp);
    const unreachable = found.filter(
      (p) => !misplaced.includes(p) && !patternMatchers.some((re) => re.test(p)));
    if (unreachable.length === 0) {
      pass('every web suite on disk is matched by the declared glob');
    } else {
      fail(`web suites the declared glob cannot reach (#2360): ${unreachable.join(', ')}`
        + ` — pattern(s) ${patterns.join(', ')} run, but these files do not match,`
        + ' so they are dead weight that looks like coverage');
    }
  });

  // ── The floor parser itself, so a subtle range can't slip past ──
  // Regression table for the #2468 review: every entry here once passed, or
  // could plausibly be written by hand, and each would bless a Node that
  // cannot run the suite if its floor were misread. A union is judged by its
  // LOWEST alternative (#5929), so `^24 || ^20` is provable — at 20, which the
  // glob check below then rejects.
  scenario('that floorOf only accepts provable floors', () => {
    const PROVABLE = {
      '>=22': '22.0.0',
      '>=22.0': '22.0.0',
      '>=22.0.0': '22.0.0',
      '>=22 <25': '22.0.0',
      '>=22 <=22': '22.0.0',
      '^22.0.0': '22.0.0',
      '^22.13.0 || >=23.4.0': '22.13.0',   // NODE_ENGINES (lib/node-floor.mjs)
      '>=23.4.0 || ^22.13.0': '22.13.0',   // order-independent
      '^22.13.0||>=23.4.0': '22.13.0',     // npm needs no spaces around ||
      '^22.0.0 || >=20.0.0': '20.0.0',     // union — the second term is lower
      '^24 || ^20': '20.0.0',              // union — the second term is lower
    };
    const REFUSED = [
      '<=23.0.0',             // no lower bound at all
      '>=22 || <=20',         // an alternative with no lower bound
      '>=22 ||',              // empty alternative — npm reads it as any version
      '|| >=22',              // empty alternative
      '>=22.0.0 <20.0.0',     // unsatisfiable
      '>=22.0.0 <22.0.0',     // unsatisfiable
      '>=22.0.0 <=21',        // unsatisfiable (<=21 is <22.0.0)
      '^22.13.0 || >=23.4.0 <23.4.0',   // one alternative unsatisfiable
      '>=22.0.0 garbage',     // trailing junk
      '^22.13.0 || garbage',  // junk in one alternative
      '>=022.13.0',           // leading zero — not a valid npm version
      '^22.013.0',            // leading zero in the minor
      '>=22.13.9007199254740993',   // past Number.MAX_SAFE_INTEGER — would round
      '^9007199254740991',          // derived upper bound past MAX_SAFE_INTEGER
      '>=22 <=22.9007199254740991', // derived upper bound past MAX_SAFE_INTEGER
      '>=22 | >=23',          // single pipe
      '>=22 >=24',            // two lower bounds — ambiguous
      '^22 >=22.5',           // two lower bounds — ambiguous
      '^0.5.0',               // caret on major 0 bounds the minor, not parsed here
      '~22.13.0',             // tilde semantics, not parsed here
      '>22',                  // exclusive lower bound, not parsed here
      '22.x',                 // x-range semantics, not parsed here
      '',                     // absent
    ];
    const wrong = [
      ...Object.entries(PROVABLE)
        .filter(([r, want]) => floorOf(r)?.join('.') !== want)
        .map(([r, want]) => `${JSON.stringify(r)} should have floor ${want} (got ${floorOf(r)?.join('.') ?? 'null'})`),
      ...REFUSED.filter((r) => floorOf(r) !== null).map((r) => `${JSON.stringify(r)} should be refused`),
    ];
    if (wrong.length === 0) {
      pass(`floorOf accepts ${Object.keys(PROVABLE).length} provable floors, refuses ${REFUSED.length} unprovable ranges`);
    } else {
      fail(`floorOf misjudged engines ranges (#2360): ${wrong.join('; ')}`);
    }
  });

  // ── ...and reads web's declared range at its edges (#5929) ──
  // node:sqlite needs no flag from 22.13 on the 22.x line but only from 23.4 on
  // the 23.x line, so 23.0–23.3 sit numerically above the floor yet outside
  // the range. A parser that only took the minimum would admit them. The range
  // is read from web/package.json, so a coordinated change to it and to
  // NODE_ENGINES that moves these edges fails here too.
  scenario("that web's engines range admits exactly the supported Node versions", () => {
    const RANGE = pkg.engines?.node ?? '';
    const ADMITTED = ['22.13.0', '22.13.1', '22.20.0', '22.99.99', '23.4.0', '23.11.1', '24.0.0', '26.10.0'];
    const EXCLUDED = ['20.19.0', '21.7.3', '22.0.0', '22.12.0', '22.12.9', '23.0.0', '23.3.0', '23.3.9'];
    const wrong = [
      ...ADMITTED.filter((v) => admits(RANGE, v) !== true).map((v) => `${v} should be admitted`),
      ...EXCLUDED.filter((v) => admits(RANGE, v) !== false).map((v) => `${v} should be excluded`),
    ];
    if (wrong.length === 0) {
      pass(`${RANGE} admits ${ADMITTED.length} supported versions and excludes ${EXCLUDED.length} unsupported ones`);
    } else {
      fail(`web engines.node ${JSON.stringify(RANGE)} does not admit exactly the supported Node versions (#5929):`
        + ` ${wrong.join('; ')} — it should state NODE_ENGINES from lib/node-floor.mjs`);
    }
  });

  // ── The declared glob must be runnable on the declared engines floor ──
  scenario("that web's engines floor can run a glob", () => {
    const engines = pkg.engines?.node ?? '';
    const declaredFloor = floorOf(engines);
    const required = GLOB_FLOOR.join('.');
    if (!declaredFloor) {
      fail(`web/package.json declares no verifiable engines.node floor (#2360, got ${JSON.stringify(engines)})`
        + ` — its test script discovers by glob, which needs >=${required}. State it with \`>=\` or`
        + ' `^` lower bounds, optionally joined by `||` (`<`/`<=` upper bounds may follow each);'
        + ' tilde, x-ranges and `^0.x` are refused because this guard cannot prove their floor');
      return;
    }
    if (order(declaredFloor, GLOB_FLOOR) >= 0) {
      pass(`web engines.node ${engines} can run the declared glob (>= ${required})`);
    } else {
      fail(`web engines.node ${engines} is below >=${required} (#2360) — \`node --test\``
        + ' does not expand CLI globs there, so `npm test` would find 0 suites and exit 1');
    }
  });
}
