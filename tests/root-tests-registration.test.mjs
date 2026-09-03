// tests/root-tests-registration.test.mjs — every root-level *-tests.mjs must be
// reachable by something that runs it.
//
// Two conventions put a suite at the repo root, and discovery reaches neither:
// test-all.mjs discovers tests/**/*.test.mjs (#1440) and stops there. #3388
// emptied the `*.test.mjs` half — all nine moved into tests/, the list naming
// them was deleted, and tests/no-root-suites.test.mjs now asserts the root
// stays empty of that pattern.
//
// The `*-tests.mjs` half was never in scope for that series. Eight such suites
// remain at the root, seven of them named one by one in the `scripts` list in
// test-all.mjs — the same hand-maintained list #3306 set out to remove, which
// survived because `scripts` also carries ~40 `--self-test` CLI invocations
// that have nothing to do with this. A list is a thing you can forget, and it
// was forgotten once already: jd-similarity.test.mjs shipped with 20 assertions
// in no runner at all and passed the whole time it was not running (#3303).
//
// Why this is a second guard and not a widening of no-root-suites.test.mjs:
// that file asks "is there a root suite at all?", and the answer for
// *-tests.mjs is a permanent yes. Three of the eight have concrete reasons to
// stay (a flag-driven CI harness, a suite that asserts on its own filename, and
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
//   - test-all.mjs: the name must appear QUOTED in non-comment code. Every real
//     registration is `{ name: 'x-tests.mjs', ... }`; no prose mention is
//     quoted. Both narrowings — comments stripped, quotes required — are the
//     deleted tests/root-suite-registration.test.mjs verbatim, and they come
//     from the CodeRabbit finding on #3303/#3305: a filename surviving in a
//     comment after its invocation is gone must not read as registered. That
//     is not hypothetical here. Reviewing #3735, a plain `grep -q` over each
//     filename reported eight of eight registered; the eighth was
//     test-all.mjs:6549, a comment.
//
//   - workflows: the name must appear as the argument of a `node` invocation.
//     In YAML it is a bare shell token (`run: node upgrade-tests.mjs
//     --pr-gate`), so the quoted rule would match nothing at all and every
//     workflow-run suite would read as unreachable. Requiring the `node` verb
//     is also TIGHTER than quoting rather than looser: a trailing
//     `# see upgrade-tests.mjs` cannot satisfy it, so the mention-vs-invocation
//     narrowing survives without quote-aware YAML comment stripping, which was
//     the cost the review flagged for this surface.
//
// Known limitation, stated rather than papered over: an INDIRECT invocation —
// an npm script, a composite action, a shell wrapper — matches neither rule and
// reports as unreachable. That is the safe direction. A false red is read and
// resolved by whoever added it; a false green is the bug this file prevents.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
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
    const code = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
      .replace(/^\s*\/\/.*$/gm, ' '); // whole-line comments

    const QUOTES = new Set(["'", '"', '`']);
    /** True when `name` appears quoted in executable code, optionally behind a path. */
    const registeredInHarness = (name) => {
      for (let i = code.indexOf(name); i !== -1; i = code.indexOf(name, i + 1)) {
        const before = code[i - 1];
        const after = code[i + name.length];
        if (QUOTES.has(after) && (QUOTES.has(before) || before === '/')) return true;
      }
      return false;
    };

    // ── Surface 2: node invocations in the workflows ─────────────────────────
    // .github/ ships to installs (SYSTEM_PATHS, update-system.mjs:432), so this
    // surface exists off CI too. Its absence is reported rather than silently
    // treated as "no invocations": that reading would fail a workflow-run suite
    // for the wrong reason and send the reader looking for a missing
    // registration that was never missing.
    const WORKFLOWS = join(ROOT, '.github', 'workflows');
    let workflowText = '';
    let workflowsRead = 0;
    let workflowErr = null;
    try {
      for (const entry of readdirSync(WORKFLOWS, { withFileTypes: true })) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        if (!/\.ya?ml$/.test(entry.name)) continue;
        workflowText += readFileSync(join(WORKFLOWS, entry.name), 'utf-8') + '\n';
        workflowsRead++;
      }
    } catch (err) {
      workflowErr = err.code || err.message;
    }

    if (workflowErr) {
      warnOrFailWorkflows(workflowErr);
    } else {
      pass(`${workflowsRead} workflow file(s) read as the second run surface`);
    }

    /** True when `name` is the target of a `node` invocation in any workflow. */
    const invokedByWorkflow = (name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`node\\s+(?:\\.[\\\\/])?${escaped}(?=\\s|$)`, 'm').test(workflowText);
    };

    const unreachable = suites.filter((n) => !registeredInHarness(n) && !invokedByWorkflow(n));
    if (unreachable.length === 0) {
      pass(`every root-level *-tests.mjs is reachable — quoted in test-all.mjs, or invoked by a workflow (${suites.length} checked)`);
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
