// tests/root-tests-registration.test.mjs — every root-level *-tests.mjs must be
// reachable by something that runs it.
//
// Two conventions put a suite at the repo root, and discovery reaches neither:
// test-all.mjs discovers tests/**/*.test.mjs (#1440) and stops there. #3388
// emptied the `*.test.mjs` half — all nine moved into tests/, the list naming
// them was deleted, and tests/no-root-suites.test.mjs now asserts the root
// stays empty of that pattern.
//
// The `*-tests.mjs` half was never in scope for that series. Three such suites
// remain at the root (eight before #3765 moved five into tests/), two of them
// named one by one in the `scripts` list in
// test-all.mjs — the same hand-maintained list #3306 set out to remove, which
// survived because `scripts` also carries ~40 `--self-test` CLI invocations
// that have nothing to do with this. A list is a thing you can forget, and it
// was forgotten once already: jd-similarity.test.mjs shipped with 20 assertions
// in no runner at all and passed the whole time it was not running (#3303).
//
// Why this is a second guard and not a widening of no-root-suites.test.mjs:
// that file asks "is there a root suite at all?", and the answer for
// *-tests.mjs is a permanent yes. All three that remain have concrete reasons
// to stay (a flag-driven CI harness, a suite that asserts on its own filename, and
// one carrying a per-script timeout the discovery path cannot express), so a
// pattern widened to `-tests.mjs` would redden on files that are fine — the
// precise failure that file's own header rejects. The property here is not
// location but reachability.
//
// ── Reachability is checked against two surfaces, with no exemption list ─────
//
// The first draft of this guard (#3735 step 4) exempted upgrade-tests.mjs by
// name, because it is invoked by the workflow rather than by test-all.mjs.
// @artemtrofymenko's review is the reason it does not: an exemption list is a
// hand-maintained list of one, which is the shape this file exists to remove.
// The second file to earn a workflow-only invocation gets added to it or gets
// forgotten, and the guard is back to the thing it replaced. There are two
// surfaces that run things, so both are read:
//
//   test-all.mjs               the `scripts` list
//   .github/workflows/*.yml    `node <file>` invocations
//
// The MATCH RULE DIFFERS PER SURFACE, because the surfaces differ
// syntactically and a single rule would be wrong on one of them:
//
//   - test-all.mjs: the name must appear as a STRING LITERAL in the source.
//     Every real registration is `{ name: 'x-tests.mjs', ... }`; a prose
//     mention is not a literal. The question this answers is "is this name a
//     value in the code?", and a comment holds no values by construction.
//     The requirement comes from the CodeRabbit finding on #3303/#3305: a
//     filename surviving in a comment after its invocation is gone must not
//     read as registered. Not hypothetical — reviewing #3735, a plain
//     `grep -q` over each filename reported eight of eight registered; the
//     eighth was test-all.mjs:6549, a comment.
//
//   - workflows: the name must be the argument of a `node` invocation in a
//     `run:` script, AT A COMMAND POSITION. In YAML it is a bare shell token
//     (`run: node upgrade-tests.mjs --pr-gate`), so the literal rule would
//     match nothing and every workflow-run suite would read as unreachable.
//
// Both rules were LOOSER than this in the first version, and CodeRabbit caught
// both on #3765. The harness rule stripped whole-line and block comments with a
// regex and then required quotes, which still accepted a trailing
// `// registered 'foo-tests.mjs'`. The workflow rule scanned raw YAML text, so
// a commented-out `# node foo-tests.mjs` matched — and so did `echo node
// foo-tests.mjs`, which names the file without running it. Both are false-GREEN
// paths, the exact failure this file exists to prevent, so neither is a nit:
// the harness surface now collects string literals with a scanner that skips
// comments and regex literals, and the workflow surface parses the YAML and
// reads only `run:` values, matching `node` only at the start of a command.
//
// Known limitation, stated rather than papered over: an INDIRECT invocation —
// an npm script, a composite action, a shell wrapper — matches neither rule and
// reports as unreachable. That is the safe direction. A false red is read and
// resolved by whoever added it; a false green is the bug this file prevents.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs — root -tests.mjs suites are reachable');

// 1. Look in the right place first. Every assertion below reports an ABSENCE,
//    and a wrong or unreadable ROOT produces exactly that reading while
//    measuring nothing — a silent pass, the same shape as the bug this file
//    exists to prevent. Same sentinel as tests/no-root-suites.test.mjs:
//    test-all.mjs is the harness itself and cannot move without this check's
//    premise moving with it. statSync().isFile() rather than existsSync(), so a
//    directory of that name cannot satisfy the premise either.
let rootOk = false;
try {
  rootOk = statSync(join(ROOT, 'test-all.mjs')).isFile();
} catch {
  rootOk = false;
}

if (rootOk) {
  pass('ROOT is the repo root — test-all.mjs is a file there, so an empty result means empty');
} else {
  fail(`ROOT does not hold test-all.mjs as a file (${ROOT}) — this guard is looking in the wrong place and would otherwise pass on any tree`);
}

if (rootOk) {
  // isFile() OR isSymbolicLink(): readdirSync does not follow links, so a
  // symlinked entry reports isFile() === false — the same fact #3140 records
  // for isDirectory() and #3364 for a Windows clone with core.symlinks=false.
  let suites = null;
  try {
    suites = readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('-tests.mjs'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    fail(`ROOT is unreadable (${ROOT}): ${err.code || err.message} — the scan did not run, so this is not a clean tree`);
  }

  // 2. A degenerate list would satisfy assertion 3 forever while guarding
  //    nothing. This fails loudly the moment the convention is fully retired,
  //    so whoever empties the root is told to delete this file rather than
  //    inheriting a green check that protects nothing — the pattern
  //    @artemtrofymenko argued for on #3306, and the instruction they asked to
  //    have waiting for the mover.
  if (suites && suites.length > 0) {
    pass(`${suites.length} root-level *-tests.mjs found to check`);
  } else if (suites) {
    fail(
      'no root-level *-tests.mjs remains — this guard can no longer detect an unregistered suite.\n' +
        '  If the convention was retired deliberately, DELETE this file; do not repoint it at another pattern.',
    );
  }

  if (suites && suites.length > 0) {
    // ── Surface 1: the scripts list in test-all.mjs ──────────────────────────
    // Deliberately NOT a parse of the `scripts` array. A suite reached by any
    // mechanism in this file — that list, an inline run(), a future glob —
    // names the file, and the question is "does anything run this", not "which
    // section does".
    const literals = stringLiterals(readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8'));

    // `'x-tests.mjs'`, `'./x-tests.mjs'`, and `'x-tests.mjs --flag'` all count;
    // the scripts list splits its own entries on whitespace.
    const registeredInHarness = (name) =>
      literals.some((v) => v === name || v.startsWith(`${name} `) || v.endsWith(`/${name}`));

    // ── Surface 2: node invocations in the workflows ─────────────────────────
    // .github/ ships to installs (SYSTEM_PATHS, update-system.mjs:432), so this
    // surface exists off CI too. Its absence is reported rather than silently
    // treated as "no invocations": that reading would fail a workflow-run suite
    // for the wrong reason and send the reader looking for a missing
    // registration that was never missing.
    const WORKFLOWS = join(ROOT, '.github', 'workflows');
    const runScripts = [];
    let workflowsRead = 0;
    let workflowErr = null;
    try {
      for (const entry of readdirSync(WORKFLOWS, { withFileTypes: true })) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        if (!/\.ya?ml$/.test(entry.name)) continue;
        const text = readFileSync(join(WORKFLOWS, entry.name), 'utf-8');
        // Parsed, not string-scanned: the parser drops `#` comments for free,
        // and `run:` is the only key that actually executes anything.
        try {
          runScripts.push(...runCommands(yaml.load(text)));
        } catch (err) {
          workflowErr = `${entry.name}: ${err.message}`;
          break;
        }
        workflowsRead++;
      }
    } catch (err) {
      workflowErr = err.code || err.message;
    }

    if (workflowErr) {
      warnOrFailWorkflows(workflowErr);
    } else {
      pass(`${workflowsRead} workflow file(s) read as the second run surface (${runScripts.length} run: scripts)`);
    }

    const invokedByWorkflow = (name) => invokesNode(runScripts, name);

    const unreachable = suites.filter((n) => !registeredInHarness(n) && !invokedByWorkflow(n));
    if (unreachable.length === 0) {
      pass(`every root-level *-tests.mjs is reachable — a string literal in test-all.mjs, or a node invocation in a workflow (${suites.length} checked)`);
    } else {
      fail(
        `${unreachable.length} root-level suite(s) are never run — nothing in test-all.mjs or .github/workflows names them:\n` +
          unreachable.map((n) => `    ${n}`).join('\n') +
          "\n  Add an entry to the `scripts` list: { name: '<file>', expectExit: 0 }" +
          '\n  — or, if it is a flag-driven harness with no bare-invocation mode, a workflow step: run: node <file> --<flag>',
      );
    }
  }
}

/** The workflows dir is a premise, not a finding: say so where it breaks. */
function warnOrFailWorkflows(code) {
  fail(
    `.github/workflows is unreadable (${code}) — the second run surface was not checked, so a workflow-run suite ` +
      'would be reported unreachable for the wrong reason',
  );
}

/**
 * String literals in `src`, in source order.
 *
 * A scanner, not a regex strip. The first version removed whole-line and block
 * comments and then required quote characters around the name, which still
 * accepted a TRAILING `// registered 'foo-tests.mjs'` (CodeRabbit, #3765).
 * Regex literals are skipped explicitly: test-all.mjs contains
 * `/from ['"]node:test['"]/`, and treating that `'` as a string opener would
 * swallow real code and change the answer.
 */
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  // A `/` starts a regex only where a value cannot already have ended; after
  // an identifier, literal or `)`/`]` it is division.
  let prev = '';
  const regexPos = () => prev === '' || '([{,;:=!&|?+-*%~^<>'.includes(prev);
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && regexPos()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; break; }
        i++;
      }
      prev = 'x';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      let buf = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        buf += src[i];
        i++;
      }
      i++;
      out.push(buf);
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Every `run:` script in a parsed workflow document, at any nesting depth. */
export function runCommands(doc) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'run' && typeof v === 'string') out.push(v);
        else walk(v);
      }
    }
  };
  walk(doc);
  return out;
}

/**
 * True when `name` is the target of a `node` invocation at a COMMAND POSITION
 * in any of `scripts` — line start, or after a `;`/`&&`/`||`/pipe.
 *
 * The position requirement is what separates running a file from naming one:
 * `echo node foo-tests.mjs` matched the first version of this rule (#3765).
 */
export function invokesNode(scripts, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(String.raw`(?:^|[;&|])\s*node\s+(?:\.[\\/])?${esc}(?=\s|$)`, 'm');
  return scripts.some((sc) => re.test(sc));
}

// ── Fixtures for the two match rules ────────────────────────────────────────
// The rules are the guard. A rule that silently loosens turns this whole file
// into the false green it exists to prevent, so both are pinned against the
// shapes that fooled the first version.
const HARNESS_CASES = [
  ["{ name: 'x-tests.mjs', expectExit: 0 },", true, 'a real registration'],
  ["run(NODE, ['./x-tests.mjs']);", true, 'a path-qualified invocation'],
  ["{ name: 'x-tests.mjs --pr-gate' },", true, 'a registration carrying flags'],
  ['// see x-tests.mjs for the sandbox pattern', false, 'a whole-line comment'],
  ["const a = 1; // replaced by 'x-tests.mjs'", false, 'a TRAILING comment (#3765)'],
  ['/* x-tests.mjs used to live here */', false, 'a block comment'],
  ['fail(`x-tests.mjs is gone`);', true, 'a template literal is still a literal'],
];
const WORKFLOW_CASES = [
  ['node x-tests.mjs --pr-gate', true, 'a bare invocation'],
  ['  node x-tests.mjs', true, 'an indented invocation'],
  ['npm ci && node x-tests.mjs', true, 'after a shell separator'],
  ['# node x-tests.mjs', false, 'a YAML comment (#3765)'],
  ['echo node x-tests.mjs', false, 'an echo argument (#3765)'],
  ['echo "see x-tests.mjs"', false, 'a bare mention'],
];

let ruleFailures = [];
for (const [src, want, label] of HARNESS_CASES) {
  const lits = stringLiterals(src);
  const got = lits.some((v) => v === 'x-tests.mjs' || v.startsWith('x-tests.mjs ') || v.endsWith('/x-tests.mjs'));
  if (got !== want) ruleFailures.push(`harness rule: ${label} → ${got}, want ${want}`);
}
for (const [src, want, label] of WORKFLOW_CASES) {
  const got = invokesNode([src], 'x-tests.mjs');
  if (got !== want) ruleFailures.push(`workflow rule: ${label} → ${got}, want ${want}`);
}
// A regex literal containing quotes must not derail the scanner — test-all.mjs
// has exactly this shape and it decides every harness answer below it.
if (stringLiterals(`const re = /from ['"]node:test['"]/; const n = 'x-tests.mjs';`).includes('x-tests.mjs') !== true) {
  ruleFailures.push('harness rule: a regex literal containing quotes swallowed the code after it');
}

if (ruleFailures.length === 0) {
  pass(`both match rules hold against ${HARNESS_CASES.length + WORKFLOW_CASES.length + 1} fixtures (comments and echo args do NOT count as reachable)`);
} else {
  fail(`${ruleFailures.length} match-rule fixture(s) failed:\n` + ruleFailures.map((f) => `    ${f}`).join('\n'));
}
