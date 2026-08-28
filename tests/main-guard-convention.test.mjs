// tests/main-guard-convention.test.mjs — every entrypoint answers "was I run?"
// through lib/is-main-module.mjs, and answers it correctly through a symlink
// (#3170).
//
// The defect: `import.meta.url === pathToFileURL(process.argv[1]).href` compares
// a realpath-resolved URL (Node resolves the ESM entry through realpath) against
// whatever spelling the caller typed. Reached through a symlink the two never
// match, the CLI tail is skipped, and the process exits 0 having produced
// nothing — `node /tmp/co/generate-pdf.mjs` reported success and wrote no PDF.
//
// Two halves, and both are needed:
//
//   1. BEHAVIOUR — a real entrypoint, invoked through a real symlink, still runs.
//      Without this the convention check below only pins a spelling.
//   2. CONVENTION — no file references the process entry path at all, outside
//      the helper and a short justified exemption list. Sixty files hand-rolled
//      the comparison in six spellings and all but one were wrong; a reviewer
//      cannot be expected to catch the sixty-first, and a comparison-shaped
//      detector is defeated by one intermediate variable — so the rule bans the
//      raw ingredient (process.argv[1]), not the recipe.
//
// Run:  node --test tests/main-guard-convention.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Link `ROOT` into a fresh temp dir, or report that this machine cannot.
 *
 * Directory symlinks are not universally available: on Windows they need
 * SeCreateSymbolicLinkPrivilege unless Developer Mode is on (the privilege whose
 * absence aborted a whole suite in #2828), junctions refuse network and some
 * mounted volumes, and a container can be stricter still. 'junction' is ignored
 * off Windows and is the one type Windows grants unprivileged, so it is the best
 * first try — but a machine that still cannot link must SKIP these assertions,
 * not redden a suite over a platform capability. tests/helpers.mjs's
 * linkRepoPackage() takes the same position (it falls back to a copy); a copy is
 * no substitute here, because the symlink IS the thing under test.
 *
 * @param {string} prefix - mkdtemp prefix for the containing directory.
 * @returns {{link: string, cleanup: () => void} | null} Null when unsupported.
 */
function linkedRoot(prefix) {
  const linkRoot = mkdtempSync(join(tmpdir(), prefix));
  const link = join(linkRoot, 'repo');
  const cleanup = () => rmSync(linkRoot, { recursive: true, force: true });
  try {
    symlinkSync(ROOT, link, 'junction');
  } catch (err) {
    cleanup();
    console.log(`  SKIP: symlink unsupported here (${err.code || err.message})`);
    return null;
  }
  return { link, cleanup };
}

// ── 1. Behaviour ────────────────────────────────────────────────────────────

test('a CLI reached through a symlinked directory still runs', (t) => {
  // generate-pdf.mjs is the probe on purpose: it is the file #3170 was filed
  // about, the one that reported success while writing no PDF. It is also a
  // good probe mechanically — --help is zero-network, exits in ~0.4s, and
  // prints deterministic usage. Any silent-no-op regression shows up as empty
  // stdout, which is exactly the shape the bug had.
  const linked = linkedRoot('main-guard-');
  if (!linked) return t.skip('directory symlinks unavailable on this machine');
  const { link, cleanup } = linked;
  try {
    const direct = spawnSync(process.execPath, [join(ROOT, 'generate-pdf.mjs'), '--help'], {
      encoding: 'utf-8', timeout: 30_000,
    });
    const viaLink = spawnSync(process.execPath, [join(link, 'generate-pdf.mjs'), '--help'], {
      encoding: 'utf-8', timeout: 30_000,
    });
    // BOTH streams: generate-pdf.mjs writes its usage to stderr, and a probe that
    // watched only stdout would see "" from a working CLI and "" from a silently
    // suppressed one — the two outcomes this test exists to tell apart.
    const output = (r) => `${r.stdout}${r.stderr}`;
    assert.ok(output(direct).trim().length > 0, 'the direct invocation printed nothing — bad probe');
    assert.ok(
      output(viaLink).trim().length > 0,
      'invoked through a symlink the CLI printed nothing and exited ' +
        `${viaLink.status} — the main-guard silently suppressed it (#3170)`,
    );
    assert.equal(output(viaLink), output(direct), 'the symlinked invocation behaved differently');
    assert.equal(viaLink.status, direct.status);
  } finally {
    cleanup();
  }
});

test('isMainModule is false for a module that is not the entry', () => {
  // The whole point of the guard: importing a module must not fire its CLI.
  // Under `node --test` THIS file is the entry, so the negative case has to be
  // asked about a different file — any real entrypoint will do.
  const other = pathToFileURL(join(ROOT, 'check-table-freshness.mjs')).href;
  assert.equal(isMainModule(other), false);
  // A non-file scheme is a legitimate "not the entry", not a bad call.
  assert.equal(isMainModule('data:text/javascript,export default 1'), false);
});

test('isMainModule refuses a filesystem path instead of quietly returning false', () => {
  // The footgun that would reintroduce #3170 one call site at a time:
  // isMainModule(import.meta.filename) resolves, compares false, and suppresses
  // the CLI in silence. It must crash and name the mistake instead.
  assert.throws(() => isMainModule(join(ROOT, 'check-table-freshness.mjs')), /filesystem path/,
    'a path must throw, not return false');
  assert.throws(() => isMainModule('C:\\repo\\pdf.mjs'), /filesystem path/, 'a Windows path must throw too');
  // Drive-RELATIVE, no separator: still a path, and it parses as a one-letter
  // URL scheme, so it reached the "not a file: URL" branch and returned false.
  assert.throws(() => isMainModule('C:repo\\pdf.mjs'), /filesystem path/,
    'a drive-relative Windows path must throw, not return false');
  assert.throws(() => isMainModule(''), TypeError);
  assert.throws(() => isMainModule(undefined), TypeError);
});

test('isMainModule is true for the file node was pointed at, symlinked or not', (t) => {
  const linked = linkedRoot('main-guard-self-');
  if (!linked) return t.skip('directory symlinks unavailable on this machine');
  const { link, cleanup } = linked;
  try {
    const probe = "import { isMainModule } from './lib/is-main-module.mjs';" +
      'process.stdout.write(String(isMainModule(import.meta.url)));';
    for (const base of [ROOT, link]) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: base, encoding: 'utf-8', timeout: 30_000,
      });
      // `node -e` has no argv[1] at all, so this pins the other half of the
      // contract: nothing was "run", so nothing is main.
      assert.equal(r.stdout, 'false', `node -e reported main from ${base}`);
    }
  } finally {
    cleanup();
  }
});

// ── 2. Convention ───────────────────────────────────────────────────────────
//
// The rule is stronger than "don't compare import.meta.url against argv[1]":
// NO file may reference the process entry path at all, outside the helper and
// the justified exemptions below. A comparison-shaped detector is defeated by
// one intermediate variable —
//
//   const entry = process.argv[1];
//   if (entry && pathToFileURL(entry).href === import.meta.url) { ... }
//
// — and the only legitimate consumer of argv[1] in this codebase IS the
// main-guard question, which isMainModule() answers. So the reference itself is
// the violation. This also removes the need to strip block comments (a naive
// stripper is derailed by /* and */ inside the glob strings and regex literals
// this repo is full of): only whole-line comments are excused, and a reference
// inside a string fails CLOSED — add an exemption with a reason, or rewrite.

const ENTRY_REF = /process\.argv\[1\]|process\.argv\.at\(\s*1\s*\)/;

// A STATIC relative import/export in update-system.mjs, in any spelling.
//
// #1706 requires that file to be self-loading: a pre-#1245 client checks out
// that single file and re-execs it, so a static relative import crashes the
// old→new jump with ERR_MODULE_NOT_FOUND. Dynamic `await import('./x.mjs')` is
// the sanctioned form and must NOT match — that is the shape #1706 moved to.
//
// Two alternatives, because one regex cannot do both:
//   1. side-effect     `import './x.mjs';`         — no `from` at all
//   2. everything else `import … from './x.mjs';`  — possibly spanning lines
//
// The second consumes anything but a statement terminator (quoted runs matched
// whole, so a `;` inside a string does not end it early), which is what lets it
// see a multiline specifier list without running past the end of the statement.
// A same-line-only `[^\n]*?` — the shape test-all.mjs:6255 and the first draft
// of this test both used — misses both cases.
//
// GAP is whitespace and/or block comments: a comment is legal wherever
// whitespace is, so `import /* note */ './x.mjs';` and `import x from/* c
// */'./x.mjs';` are both real static imports that a bare `\s*` walks straight
// past. (The `from` form's leading gap needs no help — `[^;'"]` already
// swallows it.)
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/)*`;

const STATIC_RELATIVE_IMPORT = new RegExp(
  [
    String.raw`^[ \t]*import` + GAP + String.raw`['"]\.{1,2}\/`,
    String.raw`^[ \t]*(?:import|export)\b(?:[^;'"]|'[^']*'|"[^"]*")*?\bfrom` + GAP + String.raw`['"]\.{1,2}\/`,
  ].join('|'),
  'm',
);

// A line that is nothing but comment. Block-comment BODIES are covered by the
// leading `*` of this repo's JSDoc style; a reference sharing a line with code
// is treated as code, which can only over-report, never under-report.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

const SKIP_DIRS = new Set([
  'node_modules', '.git',
  // User-layer / generated trees (gitignored, may hold arbitrary user files).
  // batch/ is deliberately NOT here: its tracked scripts (aggregate-tokens.mjs)
  // are entrypoints like any other and stay under enforcement.
  'output', 'data', 'reports', 'jds', 'documents', 'interview-prep',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // .tmp-* probe dirs; no tracked dotdir ships .mjs
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

// Every exemption carries its reason; an unexplained entry is a review smell.
const EXEMPT = new Map([
  // The helper is the one place allowed to read the entry path.
  ['lib/is-main-module.mjs', 'is the comparison'],
  // #1706 requires update-system.mjs to be self-loading (a pre-#1245 client
  // checks out this single file and re-execs it), so it inlines the guard
  // instead of importing it. The exemption covers the source scan ONLY; the
  // behaviour test at the bottom of this file pins its semantics.
  ['update-system.mjs', 'self-loading per #1706; behaviour-pinned below'],
  // This file quotes the pattern in its detector self-test and error messages.
  ['tests/main-guard-convention.test.mjs', 'quotes the pattern to test the detector'],
  // Assigns argv[1] inside a spawned child's preamble so the copied script's
  // main-guard fires under `node -e` — the child's entry path, not a guard.
  ['tests/scan-ats-full-outage-checkpoint.test.mjs', 'sets a child process\u2019s argv[1] in a spawn preamble'],
  // Asserts that a bash-embedded node snippet reads its input file via ITS OWN
  // argv[1] (injection safety, not a main-guard); the literal lives in strings.
  ['tests/batch-runner-jd-prefetch.test.mjs', 'asserts another script\u2019s argv[1] usage in strings'],
]);

function entryRefViolations(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (COMMENT_LINE.test(lines[i])) continue;
    if (ENTRY_REF.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

test('no file outside the helper reads the process entry path', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (EXEMPT.has(rel)) continue;
    const hits = entryRefViolations(readFileSync(file, 'utf-8'));
    if (hits.length) offenders.push(`${rel}:${hits.join(',')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'these files reference process.argv[1] directly. Sixty entrypoints hand-rolled the ' +
      '"am I main?" comparison from it, in six spellings, and all but one silently no-opped ' +
      "through a symlinked checkout (#3170). Use lib/is-main-module.mjs's " +
      'isMainModule(import.meta.url) instead — and if you genuinely need the entry path for ' +
      'something else, add an exemption WITH A REASON to EXEMPT in this test:\n  ' +
      offenders.join('\n  '),
  );
});

test('the exemption list carries no dead entries', () => {
  // An exemption that outlives its reference is a hole waiting for a new one.
  for (const [rel] of EXEMPT) {
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    assert.ok(ENTRY_REF.test(src), `${rel} no longer references the entry path — remove its exemption`);
  }
});

test('the convention check can actually see a violation', () => {
  // A detector that matches nothing passes forever. Feed it the exact line
  // #3170 was filed about, the one-variable-of-indirection evasion, and the
  // fix, and require the right answer for each.
  const oldSpelling = 'const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);';
  assert.deepEqual(entryRefViolations(oldSpelling), [1], 'the detector no longer matches the original defect');
  const laundered = 'const entry = process.argv.at(1);\nif (entry) run();';
  assert.deepEqual(entryRefViolations(laundered), [1], 'the detector misses the variable-indirection evasion');
  assert.deepEqual(entryRefViolations('const isMain = isMainModule(import.meta.url);'), [], 'the detector flags the fix');
  assert.deepEqual(entryRefViolations('// process.argv[1] is explained here\n * and here (JSDoc body)'), [], 'comment lines must be excused');
});

test('the #1706 static-import detector sees every spelling', () => {
  // The first draft of this check only matched `from '...'` on ONE line, so a
  // side-effect import and a multiline specifier list both sailed past it while
  // it looked like it was guarding. Each form is asserted rather than assumed.
  const caught = [
    "import './helper.mjs';",                       // side-effect, no `from`
    'import x from "./helper.mjs";',
    "import { a } from './helper.mjs';",
    "import {\n  a,\n  b,\n} from './helper.mjs';", // multiline specifier list
    "export { a } from './helper.mjs';",
    "export * from '../helper.mjs';",
    "  import './helper.mjs';",                     // indented
    "import /* note */ './helper.mjs';",            // comment before specifier
    "import x from/* c */'./helper.mjs';",          // comment after `from`
    "import /* c */ x from './helper.mjs';",
  ];
  for (const form of caught) {
    assert.ok(STATIC_RELATIVE_IMPORT.test(form), `missed a static relative import:\n${form}`);
  }

  const allowed = [
    "import * as yaml from 'js-yaml';",             // bare specifier
    "const m = await import('./lazy.mjs');",        // DYNAMIC — the #1706 fix itself
    "  const m = await import('./lazy.mjs');",
    "// import './helper.mjs';",                    // comment
    " * import { a } from './helper.mjs';",         // JSDoc body
  ];
  for (const form of allowed) {
    assert.ok(!STATIC_RELATIVE_IMPORT.test(form), `false positive on:\n${form}`);
  }
});

test("update-system.mjs's inlined guard realpaths both sides", (t) => {
  // The #1706 self-loading rule buys it an exemption from the import, not from
  // being correct. Asserted on BEHAVIOUR, not on source text: a source-shape
  // check passes on a rewrite that keeps the words and loses the realpath.
  const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  assert.ok(
    !STATIC_RELATIVE_IMPORT.test(src),
    'update-system.mjs grew a static relative import — that breaks the old→new re-exec (#1706)',
  );

  const linked = linkedRoot('main-guard-updater-');
  if (!linked) return t.skip('directory symlinks unavailable on this machine');
  const { link, cleanup } = linked;
  try {
    // An unrecognized subcommand is the only branch that proves the tail ran
    // and writes NOTHING: `check` hits the network, and every other command
    // (`dismiss` included) touches the real repo through the symlink.
    const viaLink = spawnSync(process.execPath, [join(link, 'update-system.mjs'), '--probe-not-a-command'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000,
    });
    assert.match(
      viaLink.stdout,
      /Usage: node update-system\.mjs/,
      `the updater printed no usage through a symlink (exit ${viaLink.status}) — its inlined ` +
        'guard stopped realpathing both sides, and every update silently no-ops (#3170)',
    );
    assert.equal(viaLink.status, 1, 'the usage branch must still exit non-zero');
  } finally {
    cleanup();
  }
});
