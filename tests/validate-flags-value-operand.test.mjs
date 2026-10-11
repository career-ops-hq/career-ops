// tests/validate-flags-value-operand.test.mjs — every value-taking caller
// handles the missing operand SOMEWHERE: either the shared guard
// (`requireOperand: true`) or its own richer validator, recorded in OWN_GUARD.
//
// The invariant is "handled somewhere", not "everyone opts in", and the
// difference is the whole design. `valueFlags` without `requireOperand` is not
// a defect on its own — it is three different situations that look identical at
// the call site:
//
//   1. the caller runs its OWN, richer validation (scan.mjs's requireValue()
//      separates no-value / zero / negative / non-finite / out-of-range; the
//      generic message would collapse five diagnostics into one line),
//   2. requireOperand would be WRONG for that flag (contacts.mjs's --vcf takes
//      an optional operand — `--vcf` alone means the default path), or
//   3. nothing validates it at all, and the script answers from a default.
//
// No text scan can tell those apart: the evidence for (1) is fifty lines away,
// and for (3) it is absent. So this file classifies what it can actually
// observe — `noSharedGuard`, meaning "declares valueFlags, does not use the
// shared option" — and OWN_GUARD is where a human records which of (1) or (2)
// applies. The failure message says exactly that, and never calls a caller
// unguarded on evidence it does not have.
//
// #3087 closed the hole in the four callers that had nothing catching it:
// a value-taking flag whose operand is MISSING (`--target --json`, `--window
// --summary`, a bare trailing `--dir`) was read as though the next flag were
// its value, or fell back to a default, and the script answered at exit 0 for
// inputs nobody asked for. `requireOperand` is deliberately opt-in — several
// callers already say more than a generic message can, and firing first would
// replace their diagnostics with one line (see lib/cli-flags.mjs).
//
// Opt-in is the right default and also the whole problem: it re-opens silently.
// A new script wires up validateFlags with `valueFlags`, forgets the option,
// and nothing fails — it just inherits the bug, exactly as before #3087. There
// is no signal at the call site that anything is missing. Two such callers were
// already in the tree when #3092 audited it (fix-slugs.mjs, upskill.mjs) and
// neither appeared in that audit's list.
//
// So the rule is enforced where it can go red rather than restated where it can
// be missed: a caller outside both sets fails CI with its file and line named.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK: where the call sits. Both shapes in the
// tree are correct and the difference is not stylistic. A script nothing imports
// validates at module top level (contacts.mjs, rejection-latency.mjs,
// batch-tailor.mjs; test-all.mjs spawns those as subprocesses). A module that IS
// imported in-process validates inside its main-module guard
// (`isMainModule(import.meta.url)`, lib/is-main-module.mjs) — followup-cadence.mjs
// (#3196) reads the argv of whatever process imported it otherwise, so a
// top-level validator would exit(1) on the TEST RUNNER's flags and take the
// suite down with it. Same for upskill.mjs and check-table-freshness.mjs; scan.mjs
// and archive-posting.mjs validate inside the function that parses argv.
//
// The invariant is "a declared value flag is validated", not "validated in one
// particular place", so the classifier below reads the call's ARGUMENTS and
// nothing about its position. A placement rule would fail correct code, and the
// fixtures at the bottom pin that: the same call classifies identically at top
// level, inside `if (isMain)`, and inside a function.
//
// SCOPE: tracked `.mjs` source, enumerated with `git ls-files` — the set that
// ships. A recursive walk would also read whatever untracked scratch the tree
// is carrying (a killed test-all.mjs run leaves a `.tmp-script-test-*` copy of
// the whole repo behind), and every stale copy in it would report as an
// offender. Test files are excluded: tests/cli-flags.test.mjs calls
// validateFlags WITHOUT requireOperand on purpose, to prove the option stays
// opt-in.
//
// ── IF YOU ARE CHANGING validateFlags, READ THIS ──────────────────────────
//
// This sweep reads SOURCE TEXT, not a parsed AST: it finds `validateFlags(`,
// slices the call's arguments, and inspects the 4th one. So it is coupled to
// the helper's SIGNATURE and to two property NAMES — `valueFlags` and
// `requireOperand`. Change either, and this test is part of your diff.
//
// Every entry below was measured, not assumed. The `→` is what the classifier
// returns for that shape.
//
// LOUD — the sweep fails and tells you. Safe: you cannot ship one of these by
// accident, you just have to update this file alongside your change.
//
//   options object moved to another argument position   → opaque    (fail)
//   collapsed to one options object (`validateFlags({…})`) → none ×N (floor +
//                                                            staleness fire)
//   `valueFlags` renamed                                → none ×N  (same)
//   `requireOperand` renamed                            → every caller becomes
//                                                         an offender, named
//   `validateFlags` itself renamed                      → no match  (floor +
//                                                         staleness)
//   `{ valueFlags: V, ...OPTS }` (spread may carry it)  → noSharedGuard
//   `requireOperand: CONST` (not the literal `true`)    → noSharedGuard
//   an OWN_GUARD file renamed or deleted                → staleness
//   `git` unavailable                                   → the suite contains
//                                                         it as one failure
//
// SILENT — the sweep stays green while covering less than it claims. These are
// the ones worth being careful about, because nothing tells you:
//
//   shorthand `{ valueFlags, requireOperand: true }`    → none  ← LIVE GAP: the
//       property regex requires a `:`, so shorthand reads as "no value flags".
//       Fix is to widen it to accept `:` `,` `}` and a quoted/computed key.
//   `{ ['valueFlags']: V }`                             → none  (same cause)
//   a WRAPPER helper (`validateCli()` calling this one) → no match. A partial
//       migration is the worst case: migrated callers leave the sweep while the
//       remaining ones keep the count above MIN_CALL_SITES, so the floor never
//       fires. There is no guard against this — inverting the sweep to scan for
//       value-flag DECLARATIONS instead of calls is the only real answer.
//   a new script not yet `git add`ed                    → not scanned at all
//   this file moved out of `tests/`                     → never runs; discovery
//                                                         is `tests/**/*.test.mjs`
//   a SECOND unguarded call in an OWN_GUARD file        → excused. Exemptions
//       are keyed by FILE, not by call site.
//
// PREMISE CHANGE — if `requireOperand` ever defaults to `true`, this test does
// not need patching, it needs deleting or inverting: every caller that then
// omits the key becomes a false offender, and OWN_GUARD turns into an opt-OUT
// list. The whole file assumes the option is opt-in.
//
// The backstops that make the LOUD column loud: MIN_CALL_SITES (a floor on how
// many call sites were matched at all) and the staleness check (six known files
// must still reach the noSharedGuard branch). Between them, a detector that
// quietly stopped matching cannot report a clean tree. They cannot catch the
// SILENT column, because in every one of those cases the call sites that DO
// still match are enough to satisfy both.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, relative, basename } from 'path';

console.log('\nvalidateFlags — every value-taking caller handles a missing operand, somewhere');

// ── The exemption list: a SHRINKING allowlist ─────────────────────────────
// Same shape as EXEMPT in tests/main-guard-convention.test.mjs, and for the same
// reason. Three properties make an allowlist trustworthy, and this list has all
// three:
//
//   1. Every entry carries a REASON naming the validator it runs instead, so
//      the next reader can check the claim rather than trust the list. Nothing
//      here can verify the guard itself — adding a line is a claim you are
//      making, and `requireOperand: true` is the answer whenever it is not true.
//   2. No dead entries: an entry whose caller has since opted in (or been
//      deleted) fails below, so the list sheds members as the tree improves.
//   3. It may not GROW without a deliberate edit. The failure message tells you
//      to either opt in OR add a line here — and without a cap, the second is
//      always the cheaper way out of a red build. MAX_OWN_GUARD makes that
//      route cost a second edit that shows up in the diff and gets questioned
//      in review, which is the point: an exemption should be approved, not
//      merely typed.
//
// Together those make the number monotonic downward. It may go down; it may not
// go up without someone saying so out loud.
const OWN_GUARD = new Map([
  ['scan.mjs',
    'requireValue() (scan.mjs) + the shared parseSinceDays(): distinguishes a missing value from a zero, ' +
    'a negative, a non-finite, an out-of-range cutoff and a repeated flag — five diagnostics one generic line would replace.'],
  ['rejection-latency.mjs',
    'argValue() rejects missing, empty AND `--`-prefixed values, and exits 2 (not 1) — its documented exit code for a usage error.'],
  ['scan-ats-full.mjs',
    'valueOf() only accepts a next token that is not `--`-prefixed, and parseSinceDays()/the seed-source check reject the malformed rest.'],
  ['check-table-freshness.mjs',
    'parseDate()/parsePositiveInt() validate the operand SHAPE, naming the expected format ("expected YYYY-MM-DD", "a positive integer").'],
  ['contacts.mjs',
    '--vcf takes an OPTIONAL operand — `node contacts.mjs --vcf` means the default output/contacts.vcf. requireOperand would break that call.'],
  // Not in #3092's audit, found by this sweep: a guard that predates it.
  ['fix-slugs.mjs',
    'a hand-rolled --file check BEFORE validateFlags, covering more than requireOperand does: `--file=` (empty) and `--file -h` (single-dash next token) are rejected too.'],
]);

// The ratchet. Raising this is a review conversation, not a formality: it means
// a caller runs a validator better than the shared one, and the entry above has
// to say what that validator is. Lowering it is free — it follows a caller
// opting in.
const MAX_OWN_GUARD = 6;

// The sweep must never go green by finding nothing. A floor set below today's
// count (6 own-guard + 14 opted into requireOperand = 20, and the opted-in half
// grows with every new CLI) leaves room for a script to be deleted without a
// spurious failure, while a scanner that silently stopped matching call sites
// still trips it.
const MIN_CALL_SITES = 12;

/** @returns {string[]} absolute paths of tracked, non-test `.mjs` source. */
function sourceFiles() {
  // -z: NUL-separated, so a path containing a newline or quote cannot split a
  // record and silently drop a file from the sweep.
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((p) => p && p.endsWith('.mjs'))
    // lib/cli-flags.mjs DEFINES validateFlags; tests exercise it directly,
    // including the deliberately unguarded form.
    .filter((p) => p !== 'lib/cli-flags.mjs')
    .filter((p) => !p.startsWith('tests/') && !basename(p).endsWith('.test.mjs') && p !== 'test-all.mjs')
    .map((p) => join(ROOT, p));
}

/**
 * Index of the closing quote of the string literal starting at `start`.
 *
 * KNOWN LIMIT: a template literal containing a nested backtick inside `${…}`
 * ends the scan early. No call site does that, and the failure is loud — the
 * mis-slice reports as unterminated or as an offender, never as a clean call.
 *
 * @returns {number} closing-quote index, or -1 when unterminated.
 */
function endOfString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === quote) return i;
    if (quote !== '`' && c === '\n') return -1;
  }
  return -1;
}

/**
 * Top-level arguments of the call whose opening paren is at `openIdx`.
 *
 * Balanced-bracket scan that skips string literals and STRIPS comments, so
 * neither a paren inside a flag name (`'--b(x'`) nor a commented-out
 * `requireOperand: true` can change the reading.
 *
 * @returns {string[]|null} one string per argument, or null when unterminated.
 */
function callArgs(text, openIdx) {
  const args = [];
  let buf = '';
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return null;
      i = nl;
      buf += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 1;
      buf += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(text, i);
      if (end === -1) return null;
      buf += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth > 1) buf += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(buf); return args; }
      buf += c;
      continue;
    }
    if (c === ',' && depth === 1) { args.push(buf); buf = ''; continue; }
    buf += c;
  }
  return null;
}

/**
 * Whether the match at `idx` sits inside a comment rather than in code.
 *
 * Nine files mention `validateFlags()` in prose ("Handled via …
 * validateFlags() (#2775)"); a prose mention has no arguments and would read
 * as a call with none — harmless until one of them quotes a full call.
 *
 * Line-local on purpose. The alternative, walking the whole file to track
 * code/string/comment state, has to reason about regex literals: one `/["']/`
 * misread as a division leaves a dangling quote, and the scan then swallows
 * whatever follows — including a real call site, silently. This heuristic can
 * only misfire on a line that has `//` inside a string BEFORE the call, which
 * no call site looks like, and the floor and staleness checks above would
 * catch it if one ever did.
 */
function inComment(text, idx) {
  const lineStart = text.lastIndexOf('\n', idx) + 1;
  if (text.slice(lineStart, idx).includes('//')) return true;
  const open = text.lastIndexOf('/*', idx);
  return open !== -1 && open > text.lastIndexOf('*/', idx);
}

/**
 * Classify every validateFlags() call in a source text.
 *
 * @returns {{index:number, kind:'none'|'guarded'|'noSharedGuard'|'opaque'|'unterminated'}[]}
 *   `none` — no valueFlags, so this rule does not apply.
 *   `guarded` — valueFlags + `requireOperand: true`.
 *   `noSharedGuard` — valueFlags without it. An observation, NOT a verdict: the
 *     caller may run a richer validator of its own, which is what OWN_GUARD
 *     records. Only a caller that is in neither set is a finding.
 *   `opaque` — options passed as a variable, so the sweep cannot read them.
 *   `unterminated` — the call could not be sliced.
 */
function scanCalls(text) {
  const calls = [];
  const re = /\bvalidateFlags\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    if (inComment(text, idx)) continue;
    // The declaration in lib/cli-flags.mjs is out of scope by path, but a
    // re-export or a local wrapper must not read as a call either.
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, idx - 24), idx))) continue;
    const args = callArgs(text, idx + m[0].length - 1);
    if (args === null) { calls.push({ index: idx, kind: 'unterminated' }); continue; }
    const opts = args[3];
    if (opts === undefined) { calls.push({ index: idx, kind: 'none' }); continue; }
    // Fail closed on `validateFlags(args, K, U, OPTS)`: the sweep cannot see
    // whether OPTS carries valueFlags, and "cannot see" must not read as
    // "no valueFlags". Inline the object — every caller does today.
    if (!/^\s*\{/.test(opts)) { calls.push({ index: idx, kind: 'opaque' }); continue; }
    if (!/\bvalueFlags\s*:/.test(opts)) { calls.push({ index: idx, kind: 'none' }); continue; }
    const guarded = /\brequireOperand\s*:\s*true\b/.test(opts);
    calls.push({ index: idx, kind: guarded ? 'guarded' : 'noSharedGuard' });
  }
  return calls;
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// ── The sweep ─────────────────────────────────────────────────────────────
const scanned = sourceFiles();
const offenders = [];      // valueFlags, no shared guard, and no OWN_GUARD entry
const broken = [];         // opaque or unterminated — the sweep cannot judge
const unreadable = [];
const exemptSeen = new Set();
let valueFlagCallSites = 0;

for (const file of scanned) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    unreadable.push(`${rel} (${err.code || err.message})`);
    continue;
  }
  if (!text.includes('validateFlags')) continue;
  for (const { index, kind } of scanCalls(text)) {
    const at = `${rel}:${lineOf(text, index)}`;
    if (kind === 'none') continue;
    if (kind === 'opaque') {
      broken.push(`${at} (options passed as a variable — inline the object so valueFlags is visible)`);
      continue;
    }
    if (kind === 'unterminated') {
      broken.push(`${at} (call could not be parsed — the sweep cannot confirm it is guarded)`);
      continue;
    }
    valueFlagCallSites++;
    if (kind === 'guarded') continue;
    if (OWN_GUARD.has(rel)) { exemptSeen.add(rel); continue; }
    offenders.push(at);
  }
}

if (scanned.length < 50) {
  fail(`git ls-files produced ${scanned.length} source files — the validateFlags sweep scanned almost nothing`);
} else if (unreadable.length > 0) {
  fail(`could not read ${unreadable.length} tracked source file(s), so the sweep is incomplete: ${unreadable.join(', ')}`);
} else if (broken.length > 0) {
  fail(`validateFlags call(s) the sweep cannot judge: ${broken.join(', ')}`);
} else if (offenders.length > 0) {
  fail(
    `validateFlags caller(s) declaring valueFlags without requireOperand, and not documented as running their own `
    + `validator: ${offenders.join(', ')} — pass \`requireOperand: true\` (lib/cli-flags.mjs, #3087) if nothing else `
    + 'checks the operand there. If something does, add the file to OWN_GUARD in '
    + 'tests/validate-flags-value-operand.test.mjs naming that validator, and raise MAX_OWN_GUARD in the same diff',
  );
} else {
  pass(`every value-taking validateFlags caller in ${scanned.length} tracked source files handles a missing operand — shared guard or documented own validator`);
}

// A floor on what the sweep matched. Without it a scanner that quietly stopped
// recognising call sites would report a clean tree forever — the same
// absence-of-evidence failure the rule itself exists to prevent.
if (valueFlagCallSites >= MIN_CALL_SITES) {
  pass(`the sweep matched ${valueFlagCallSites} valueFlags call sites (floor ${MIN_CALL_SITES})`);
} else {
  fail(`only ${valueFlagCallSites} valueFlags call sites matched, below the floor of ${MIN_CALL_SITES} — the scanner is under-reading the tree, not the tree that shrank`);
}

// Ratchet (property 3). A new caller must not be able to skip both guards by
// quietly appending itself here — the cheapest exit from a red build has to be
// the correct one. Raising the cap is allowed; doing it silently is not.
if (OWN_GUARD.size <= MAX_OWN_GUARD) {
  pass(`the exemption list holds ${OWN_GUARD.size} caller(s), within the ratchet of ${MAX_OWN_GUARD}`);
} else {
  fail(`OWN_GUARD has grown to ${OWN_GUARD.size}, above the ratchet of ${MAX_OWN_GUARD} — an exemption was added without raising MAX_OWN_GUARD. If the new entry genuinely runs a richer validator, raise the cap in the same diff so the exemption is reviewed; otherwise pass requireOperand: true instead`);
}

// Staleness (property 2), both directions. An entry whose caller has since
// opted into requireOperand (or been deleted) is a claim nobody is checking any
// more, and it is what lets the ratchet travel down. It doubles as the
// scanner's own canary: these six files are known to reach the noSharedGuard
// branch, so a detector that broke stops resolving them here.
const stale = [...OWN_GUARD.keys()].filter((rel) => !exemptSeen.has(rel));
if (stale.length === 0) {
  pass(`all ${OWN_GUARD.size} documented own-validator callers still declare valueFlags without requireOperand`);
} else {
  fail(`stale OWN_GUARD entr${stale.length === 1 ? 'y' : 'ies'} in tests/validate-flags-value-operand.test.mjs: ${stale.join(', ')} — the file is gone, no longer declares valueFlags, or now passes requireOperand itself; drop the line and lower MAX_OWN_GUARD to match`);
}

// ── Guard the guard ───────────────────────────────────────────────────────
// A classifier that stopped classifying would report a clean tree regardless of
// what is in it. Each fixture is a shape that exists, or plausibly will.
const FIXTURES = [
  ['validateFlags(args, K, U);', 'none'],
  ['validateFlags(args, K, U, { valueFlags: V });', 'noSharedGuard'],
  ['validateFlags(args, K, U, { valueFlags: V, requireOperand: true });', 'guarded'],
  ['validateFlags(args, K, U, {\n  valueFlags: V,\n  requireOperand: true,\n});', 'guarded'],
  ['validateFlags(args, K, U, { requireOperand: true, valueFlags: V });', 'guarded'],
  // requireOperand without valueFlags is a no-op — nothing for it to guard.
  ['validateFlags(args, K, U, { requireOperand: true });', 'none'],
  // Explicitly opted OUT is the same hole as never opting in.
  ['validateFlags(args, K, U, { valueFlags: V, requireOperand: false });', 'noSharedGuard'],
  // A comment cannot supply the guard...
  ['validateFlags(args, K, U, { valueFlags: V /* requireOperand: true */ });', 'noSharedGuard'],
  ['validateFlags(args, K, U, { valueFlags: V, // requireOperand: true\n});', 'noSharedGuard'],
  // ...nor can it hide one.
  ['validateFlags(args, K, U, /* opts */ { valueFlags: V, requireOperand: true });', 'guarded'],
  // Brackets and commas inside literals must not end the argument list early.
  ["validateFlags(args, ['--a(x', '--b'], U, { valueFlags: ['--a(x'] });", 'noSharedGuard'],
  ['validateFlags(args, K, `Usage: (see --help), or don\'t`, { valueFlags: V });', 'noSharedGuard'],
  ['validateFlags(args, K, U, OPTS);', 'opaque'],
  ['validateFlags(args, K, U, { valueFlags: V }', 'unterminated'],
];
const misread = FIXTURES
  .map(([src, want]) => [src, want, scanCalls(src)[0]?.kind ?? 'nothing-matched'])
  .filter(([, want, got]) => want !== got);
if (misread.length === 0) {
  pass(`the classifier reads all ${FIXTURES.length} call shapes correctly, comments and bracketed literals included`);
} else {
  fail(`classifier broken — it would report a clean tree regardless: ${misread.map(([src, want, got]) => `${JSON.stringify(src)} => ${got}, want ${want}`).join('; ')}`);
}

// Placement is not part of the rule. The five shapes below are the ones in the
// tree — and choosing between them is a correctness decision about whether the
// module gets imported in-process, not a style one (see the header). A future
// edit that started reading position would fail followup-cadence.mjs and
// upskill.mjs, which validate inside `isMain` because they must.
//
// Each fixture is the SHAPE THAT HAS CONSEQUENCES (noSharedGuard), not the
// harmless one: a position-sensitive scanner would degrade a wrapped call to
// `none` or match nothing at all — i.e. it would exempt those files silently
// while still printing green.
const PLACEMENTS = [
  ['top level', 'validateFlags(args, K, U, { valueFlags: V });'],
  ['isMain guard', 'if (isMain) {\n  const args = process.argv.slice(2);\n  validateFlags(args, K, U, { valueFlags: V });\n}'],
  // The two real spellings of the same guard: a named `isMain` const
  // (upskill.mjs) and the call inline (followup-cadence.mjs,
  // check-table-freshness.mjs). Both go through lib/is-main-module.mjs — the
  // older hand-rolled `process.argv[1]` comparison is banned repo-wide by
  // tests/main-guard-convention.test.mjs (#3170), including inside a string
  // literal like this one, so quoting it here would fail that test.
  ['inline main-module guard', 'if (isMainModule(import.meta.url)) {\n  validateFlags(args, K, U, { valueFlags: V });\n}'],
  ['inside a function', 'function parseCliArgs(args) {\n  validateFlags(args, K, U, { valueFlags: V });\n}'],
  ['inside async main', 'async function main() {\n  const args = process.argv.slice(2);\n  validateFlags(args, K, U, { valueFlags: V });\n}'],
];
const misplaced = PLACEMENTS.filter(([, src]) => scanCalls(src)[0]?.kind !== 'noSharedGuard');
if (misplaced.length === 0) {
  pass(`the same call reads the same way in all ${PLACEMENTS.length} placements — the rule is about arguments, not position`);
} else {
  fail(`the sweep became placement-sensitive (${misplaced.map(([name]) => name).join(', ')}) — it would now fail correct code that validates inside an isMain guard`);
}

// Prose mentions are not call sites: nine files carry one in a comment, and
// reading those as argument-less calls is harmless only until one of them
// quotes a full call.
const PROSE = [
  '// Handled via lib/cli-flags.mjs\'s validateFlags() (#2775), which also rejects unknown flags.',
  '/*\n * validateFlags(args, K, U, { valueFlags: V }) is the shape to copy.\n */',
  '/**\n * The unrecognized-flag check inside\n * validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS })\n * runs before --help.\n */',
];
if (PROSE.every((src) => scanCalls(src).length === 0)) {
  pass('a validateFlags() mention inside a comment is not treated as a call site');
} else {
  fail('the sweep reads commented-out or quoted validateFlags() text as a real call site — it would fail on prose');
}
