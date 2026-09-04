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
// *-tests.mjs is a permanent yes. Three of them have concrete reasons to stay
// (a flag-driven CI harness, a suite that asserts on its own filename, and
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
//   - workflows: the name must be the FIRST COMMAND of a `run:` script. In
//     YAML it is a bare shell token (`run: node upgrade-tests.mjs --pr-gate`),
//     so the literal rule would match nothing and every workflow-run suite
//     would read as unreachable.
//
// The workflow rule was once "a `node` command anywhere at a command
// position", which required knowing which text in a `run:` script was DATA.
// Five consecutive review rounds each found a shell construct it got wrong
// (#3765) — quoted spans, heredoc bodies, comments after control operators,
// `<<\\EOF`, `<<1`, and `<<EOF-1` recorded as `EOF` so masking stopped at a
// bare `EOF` line inside the body. Every one was a false GREEN, the exact bug
// this file exists to prevent. The masking apparatus is gone: the first
// command line is the one position that cannot be shell data, because a
// heredoc body needs an earlier `<<` and a quoted span needs an earlier quote.
// A rule that cannot be wrong about shell quoting beats one that is accurate
// only once someone has finished writing a shell lexer inside a test.
//
// Known limitations, stated rather than papered over. An INDIRECT invocation —
// an npm script, a composite action, a shell wrapper — matches neither rule and
// reports as unreachable, and so does a `node` call that is not the first
// command of its step (`npm ci && node x-tests.mjs`, or a second line of a
// block scalar). Both are the safe direction: a false red is read and resolved
// by whoever wrote the workflow, and the remedy is a step of its own. A false
// green is the bug this file prevents.
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

    // harnessMatches is defined once, below, and used by BOTH the live check
    // and the fixtures — see the note there for why a second copy is worse
    // than useless.
    const registeredInHarness = (name) => harnessMatches(literals, name);

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

/**
 * The `run:` scripts of a parsed workflow: `jobs.<id>.steps[].run`, and only
 * that.
 *
 * The first version walked the whole document for any key named `run`, which
 * also collected `steps[].with.run` — an action INPUT that happens to be named
 * `run` and executes nothing (CodeRabbit, #3765). Treating one as a command is
 * a false green: the suite reads as reachable while nothing runs it.
 * `defaults.run` escaped only because it is a mapping rather than a string,
 * which is luck, not a rule. This walks the one path that executes.
 */
export function runCommands(doc) {
  const out = [];
  const jobs = doc && typeof doc === 'object' ? doc.jobs : null;
  if (!jobs || typeof jobs !== 'object') return out;
  for (const job of Object.values(jobs)) {
    const steps = job && typeof job === 'object' ? job.steps : null;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (step && typeof step === 'object' && typeof step.run === 'string') out.push(step.run);
    }
  }
  return out;
}

/**
 * The first COMMAND line of a shell script: the first line that is neither
 * blank nor a whole-line comment.
 *
 * Line 1 is the one position in a script that cannot be shell data. A heredoc
 * body needs a `<<` on an earlier line; a multi-line quoted span needs an
 * earlier opening quote. So reading only the first command needs no shell
 * lexing at all, and the whole class of bugs that comes with approximating one
 * disappears with it.
 */
export function firstCommandLine(script) {
  for (const line of String(script).split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    return line;
  }
  return null;
}

/**
 * True when `name` is the first command of any of `scripts`.
 *
 * DELIBERATELY STRICTER THAN THE SHELL. `npm ci && node x-tests.mjs` and a
 * `node` call on the second line of a block scalar are real invocations that
 * this reports as unreachable.
 *
 * That trade is the point. The previous version matched a `node` command
 * anywhere at a command position, which meant it had to know which text in a
 * `run:` script was data — and five consecutive review rounds each found a
 * shell construct it got wrong (#3765): quoted spans, heredoc bodies, comments
 * after control operators, `<<\\EOF`, `<<1`, and `<<EOF-1` recorded as `EOF`,
 * which stopped masking at a bare `EOF` line inside the body and exposed
 * everything after it. Every one of those was a false GREEN — a suite reading
 * as reachable while nothing ran it, which is the exact bug this file exists to
 * prevent. A rule that cannot be wrong about shell quoting beats a rule that is
 * accurate once someone has finished writing a shell lexer in a test.
 *
 * The cost is false REDS, and this file already takes that direction for
 * indirect invocations: a false red is read and resolved by whoever wrote the
 * workflow, and the fix is to put the invocation in its own step. All three
 * upgrade-tests.mjs steps are already `run: node upgrade-tests.mjs --<flag>`.
 */
export function invokesNode(scripts, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(String.raw`^\s*node\s+(?:\.[\\/])?${esc}(?=[\s;)&|]|$)`);
  return scripts.some((sc) => {
    const first = firstCommandLine(sc);
    return first !== null && re.test(first);
  });
}

/**
 * Whether `name` is registered among `literals` — the string literals of
 * test-all.mjs. `'x-tests.mjs'`, `'./x-tests.mjs'` and `'x-tests.mjs --flag'`
 * all count; the scripts list splits its own entries on whitespace.
 *
 * ONE definition, used by the live check and by the fixtures below. A second
 * copy in the fixture loop is worse than no fixtures at all: it keeps passing
 * while the rule it claims to pin drifts away from it. Measured on this branch
 * by @artemtrofymenko — dropping the `endsWith` clause from the live rule left
 * all 24 fixtures green, including the path-qualified case that exists to
 * cover exactly that clause, because nothing registered today is
 * path-qualified. The fixtures were reporting on a rule that had stopped being
 * the rule.
 */
// A hoisted `function`, deliberately, not `const`: the live check above runs
// at module top level BEFORE this line is reached, and a const would be in the
// temporal dead zone there (ReferenceError, contained as a suite failure).
export function harnessMatches(literals, name) {
  return literals.some((v) => v === name || v.startsWith(`${name} `) || v.endsWith(`/${name}`));
}

// ── Fixtures for the two match rules ────────────────────────────────────────
// The rules ARE the guard: one that silently loosens turns this file into the
// false green it exists to prevent. Both directions are pinned — the shapes
// that must NOT count, and the accepted false reds, so that narrowing the
// workflow rule to the first command stays a deliberate choice on the record
// rather than something a later edit quietly undoes.
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
  ['node x-tests.mjs --pr-gate', true, 'the first command'],
  ['  node x-tests.mjs', true, 'indented'],
  ['node ./x-tests.mjs', true, 'path-qualified'],
  ['node x-tests.mjs; echo ok', true, 'a trailing separator is a word terminator'],
  ['\n\nnode x-tests.mjs', true, 'leading blank lines are skipped'],
  ['# set the gate\nnode x-tests.mjs', true, 'a leading comment line is skipped'],
  ['echo node x-tests.mjs', false, 'an echo argument is not a command'],
  ['# node x-tests.mjs', false, 'a commented-out invocation'],
  ['node xx-tests.mjs', false, 'a longer sibling name'],
  ['cat <<EOF\nnode x-tests.mjs\nEOF', false, 'a heredoc body cannot be the first line'],
  ['cat <<1\nnode x-tests.mjs\n1', false, 'nor can a numeric-delimiter heredoc body'],
  // The sharpest case the masking version got wrong: it recorded `EOF` as the
  // delimiter of `<<EOF-1`, stopped at the bare `EOF` INSIDE the body, and
  // exposed everything after it. Kept as a fixture because it is the one that
  // would bite hardest if the matching strategy ever widens again.
  ['cat <<EOF-1\nEOF\nnode x-tests.mjs\nEOF-1', false, 'a partial delimiter match cannot expose a body line'],
  ['MSG="note\nnode x-tests.mjs --flag"', false, 'nor a quoted span opened earlier'],
  // Accepted false REDS. Each is a real invocation the strict rule declines to
  // see; the remedy is a step of its own, and the alternative is a shell lexer.
  ['npm ci && node x-tests.mjs', false, 'chained after another command (accepted false red)'],
  ['npm ci\nnode x-tests.mjs', false, 'on a later line (accepted false red)'],
];
// runCommands must read only the one path that executes. `with.run` is an
// action input; `defaults.run` is a mapping of shell settings.
const WORKFLOW_DOC = {
  defaults: { run: { shell: 'bash' } },
  jobs: {
    build: {
      steps: [
        { run: 'node x-tests.mjs --pr-gate' },
        { uses: 'actions/setup-node@v4', with: { run: 'node y-tests.mjs' } },
      ],
    },
  },
};

let ruleFailures = [];
for (const [src, want, label] of HARNESS_CASES) {
  const got = harnessMatches(stringLiterals(src), 'x-tests.mjs');
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

const collected = runCommands(WORKFLOW_DOC);
if (collected.length !== 1 || collected[0] !== 'node x-tests.mjs --pr-gate') {
  ruleFailures.push(`runCommands read ${JSON.stringify(collected)} — expected only the steps[].run command (with.run and defaults.run are not commands)`);
}

if (ruleFailures.length === 0) {
  pass(`both match rules hold against ${HARNESS_CASES.length + WORKFLOW_CASES.length + 2} fixtures (comments, echo args, heredoc bodies and with.run do NOT count as reachable)`);
} else {
  fail(`${ruleFailures.length} match-rule fixture(s) failed:\n` + ruleFailures.map((f) => `    ${f}`).join('\n'));
}
