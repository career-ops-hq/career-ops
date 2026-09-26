/**
 * tests/jd-archive-wiring.test.mjs — JD-archive validator wiring + read-only
 * boundary (#2789).
 *
 * check-jd-archive.mjs's own --self-test (invoked via test-all.mjs's CLI-check
 * table) covers the finding logic on synthetic fixtures. This suite pins the
 * wiring: the script ships, updates, is documented, the mode files state the
 * archival step as required (not conditional), and the checker stays strictly
 * read-only — it reports missing archives; it must never be able to "fix" one
 * itself by writing a report or a jds/ file.
 *
 * Moved out of test-all.mjs (was section 75) per this repo's own path
 * instructions (.coderabbit.yaml: new numbered sections belong in tests/
 * files, not the central harness) and its precedent (#3863 moved the
 * context-budget suite the same way) — #3935.
 *
 * Run: node test-all.mjs --only jd-archive-wiring
 */

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

function readFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

console.log('\nJD-archive validator wiring + read-only boundary (#2789)');

try {
  const jdArchiveSrc = readFile('check-jd-archive.mjs');

  const updaterSrc = readFile('update-system.mjs');
  const jdArchiveSysBlock = (updaterSrc.match(/SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1];
  if (jdArchiveSysBlock.includes("'check-jd-archive.mjs'")) {
    pass('check-jd-archive.mjs is in update-system.mjs SYSTEM_PATHS (shipped + updatable)');
  } else {
    fail('check-jd-archive.mjs is NOT in SYSTEM_PATHS — updates would never deliver it');
  }

  const pkg = JSON.parse(readFile('package.json'));
  if (pkg.scripts && pkg.scripts['jd-archive'] === 'node check-jd-archive.mjs') {
    pass('package.json exposes npm run jd-archive');
  } else {
    fail('package.json missing the jd-archive script entry');
  }

  const scriptsDoc = readFile('docs/SCRIPTS.md');
  if (scriptsDoc.includes('## check-jd-archive') && scriptsDoc.includes('missing-jd-archive')) {
    pass('docs/SCRIPTS.md documents check-jd-archive (section + finding type)');
  } else {
    fail('docs/SCRIPTS.md missing the check-jd-archive section');
  }

  const agentsDoc = readFile('AGENTS.md');
  if (agentsDoc.includes('`check-jd-archive.mjs`')) {
    pass('AGENTS.md Main Files table lists check-jd-archive.mjs');
  } else {
    fail('AGENTS.md Main Files table missing check-jd-archive.mjs');
  }
  if (/REQUIRED.*Job Description \(archived verbatim\)|Job Description \(archived verbatim\).*REQUIRED/.test(agentsDoc)) {
    pass('AGENTS.md states the JD-archive section as required, not conditional');
  } else {
    fail('AGENTS.md does not state the JD-archive section as required');
  }

  const ofertaDoc = readFile('modes/oferta.md');
  if (ofertaDoc.includes('## Job Description (archived verbatim)')) {
    pass('modes/oferta.md report template carries a Job Description (archived verbatim) section');
  } else {
    fail('modes/oferta.md report template missing the Job Description (archived verbatim) section');
  }
  if (/JD archival \(required, #2789\)/.test(ofertaDoc)) {
    pass('modes/oferta.md states JD archival as required (matches the Machine Summary "required" phrasing style)');
  } else {
    fail('modes/oferta.md does not state JD archival as a required step');
  }

  const pdfDoc = readFile('modes/pdf.md');
  if (!/write the JD to a scratch file[\s\S]{0,20}if it isn't already one/.test(pdfDoc)) {
    pass('modes/pdf.md no longer phrases JD archival as conditional ("if it isn\'t already one")');
  } else {
    fail('modes/pdf.md still phrases JD archival as conditional, not required');
  }
  if (pdfDoc.includes('JD archival (required, #2789)')) {
    pass('modes/pdf.md states JD archival as a required step');
  } else {
    fail('modes/pdf.md does not state JD archival as a required step');
  }

  // Read-only import boundary: the ONLY fs capabilities check-jd-archive.mjs
  // may hold for scanning reports/jds are readFileSync/readdirSync/existsSync.
  // It also imports mkdtempSync/mkdirSync/writeFileSync/rmSync — but ONLY for
  // building its own self-test fixtures in a temp dir, never for reports/ or
  // jds/. The boundary check below allows the self-test-fixture write APIs by
  // name but asserts they never appear outside the self-test function body.
  const SELF_TEST_ONLY_FS = new Set(['mkdtempSync', 'mkdirSync', 'writeFileSync', 'rmSync']);
  const READ_ONLY_FS = new Set(['readFileSync', 'readdirSync', 'existsSync']);
  const fsImportMatch = jdArchiveSrc.match(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/);
  const fsNames = fsImportMatch ? fsImportMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  const unexpected = fsNames.filter(n => !READ_ONLY_FS.has(n) && !SELF_TEST_ONLY_FS.has(n));
  if (fsNames.length > 0 && unexpected.length === 0) {
    pass('check-jd-archive.mjs fs imports are limited to read-only scanning APIs plus self-test-fixture builders');
  } else {
    fail(`check-jd-archive.mjs fs import boundary violated: ${unexpected.join(', ') || 'no fs import matched'}`);
  }

  // The self-test-only write APIs must never be called from checkJdArchive,
  // hasEmbeddedJdArchive, or parseReportFilename — only from runSelfTest.
  // Extracting that function's body needs brace-counting, not a greedy
  // regex: `[\s\S]*` backtracks to the LAST `\n}` in the whole file (e.g. the
  // CLI-invocation block at the end), so `.replace(selfTestBody, '')` could
  // strip out everything from runSelfTest onward — including real code after
  // it — and a stray write call there would never get scanned, silently
  // passing the very boundary check this is meant to enforce (CodeRabbit,
  // PR #2791). Walk brace depth from the opening `{` instead, so nested
  // blocks/arrow functions inside runSelfTest don't end the match early
  // either.
  const runSelfTestStart = jdArchiveSrc.indexOf('function runSelfTest()');
  let selfTestBody = '';
  if (runSelfTestStart !== -1) {
    const openBrace = jdArchiveSrc.indexOf('{', runSelfTestStart);
    let depth = 0;
    let i = openBrace;
    for (; i < jdArchiveSrc.length; i += 1) {
      if (jdArchiveSrc[i] === '{') depth += 1;
      else if (jdArchiveSrc[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    selfTestBody = jdArchiveSrc.slice(openBrace, i + 1);
  }
  const codeOutsideSelfTest = jdArchiveSrc.replace(selfTestBody, '');
  const outsideSelfTest = codeOutsideSelfTest
    .split('\n')
    .filter(line => [...SELF_TEST_ONLY_FS].some(fn => line.includes(`${fn}(`)) && !/^\s*import\b/.test(line));
  if (outsideSelfTest.length === 0) {
    pass('check-jd-archive.mjs never calls a write-capable fs API outside its own self-test fixtures');
  } else {
    fail(`check-jd-archive.mjs calls a write-capable fs API outside runSelfTest: ${outsideSelfTest.join(' | ')}`);
  }

  // The by-name call scan above is blind to a local re-binding — `const write
  // = writeFileSync; write(dest, data)` never contains the literal substring
  // `writeFileSync(`, so a write through the alias sits outside runSelfTest
  // invisibly (#3936). The import-list check already rejects an import-time
  // alias (`writeFileSync as wfs`, since that exact string isn't in either
  // allowed set), so the remaining gap is specifically a NEW binding created
  // in the file body. Flagging the alias's creation — not just a subsequent
  // call through it — closes the gap regardless of whether the alias is ever
  // invoked: holding the capability outside runSelfTest is the violation.
  //
  // \(*\s*NAME\s*\)* (not just \s*NAME\b): a parenthesized initializer —
  // `const write = (writeFileSync);` — is still a rebinding, and the bare
  // version below missed it entirely since `(writeFileSync)` never matches
  // `=\s*writeFileSync\b` (CodeRabbit, #4159 review).
  //
  // [$A-Za-z_][$\w]* (not just \w+) for the declared name itself: `\w+`
  // excludes `$`, so `const $write = writeFileSync;` rebound the capability
  // to a valid JS identifier the pattern couldn't see (CodeRabbit, #4159
  // review).
  //
  // (?![$\w]) (not \b) to close the captured API name: `\b` is a boundary
  // between a \w and a non-\w character, and `$` is NOT in \w — so
  // `writeFileSync\b` still matches at the boundary right before a `$`,
  // treating `const notReal = writeFileSync$helper;` as a rebinding of the
  // real writeFileSync even though `writeFileSync$helper` is a distinct,
  // unrelated identifier that merely starts with the same text (CodeRabbit,
  // #4159 review).
  //
  // \p{L}\p{N} (not just \w, and the 'u' flag to make \p{...} valid) for both
  // the declared name and the closing boundary: `\w` is ASCII-only, so
  // `const café = writeFileSync;` — a valid JS identifier alias — was
  // invisible to the declaration-name class, and by the same gap
  // `writeFileSyncö` would have slipped past `(?![$\w])` the same way
  // `writeFileSync$helper` did before that fix, since `ö` is neither `$` nor
  // `\w` either.
  //
  // \p{ID_Start}/\p{ID_Continue} (not \p{L}/\p{N}) plus an explicit `_`: the
  // first cut at this fix dropped `_` from the continuation class entirely
  // (`[$\p{L}\p{N}]*`, no `_`), so `const write_alias = writeFileSync;` (a
  // real, common alias shape) went undetected, and `writeFileSync_helper`
  // slipped past the closing boundary the same way `writeFileSync$helper`
  // did before the `$` fix — `_` was simply forgotten, not excluded on
  // purpose (CodeRabbit, #4159 review). `\p{ID_Start}`/`\p{ID_Continue}` are
  // the Unicode properties the ECMAScript identifier grammar is actually
  // defined against (JS additionally allows `$`, `_`, and <ZWNJ>/<ZWJ> in
  // continuation position, included explicitly below). This still isn't a
  // full parser — astral-plane code points beyond what `\p{...}` covers here
  // are out of scope for a two-line test guard — but it now matches the
  // grammar's own vocabulary instead of an ad hoc `\p{L}\p{N}` guess.
  const REBIND_RE = /\b(?:const|let|var)\s+[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*\s*=\s*\(*\s*(mkdtempSync|mkdirSync|writeFileSync|rmSync)(?![$_\u200C\u200D\p{ID_Continue}])\s*\)*/gu;
  const rebindings = [...codeOutsideSelfTest.matchAll(REBIND_RE)].map((m) => m[0].trim());
  if (rebindings.length === 0) {
    pass('check-jd-archive.mjs never locally re-binds a write-capable fs API outside its own self-test fixtures');
  } else {
    fail(`check-jd-archive.mjs re-binds a write-capable fs API outside runSelfTest: ${rebindings.join(' | ')}`);
  }

  // REBIND_RE itself, against literal fixtures — the real file has no
  // rebinding to exercise the positive case against, so this pins the
  // pattern's own behavior directly rather than only ever proving the
  // negative ("the real file is clean") (CodeRabbit, #4159 review: add a
  // regression case for the parenthesized-initializer alias form).
  const rebindFixtureCases = [
    ["const write = writeFileSync;", true, 'bare initializer'],
    ["const write = (writeFileSync);", true, 'single-parenthesized initializer'],
    ["const write = ((writeFileSync));", true, 'double-parenthesized initializer'],
    ["const write = ( writeFileSync );", true, 'parenthesized with inner spaces'],
    ["const $write = writeFileSync;", true, '$-prefixed alias'],
    ["const café = writeFileSync;", true, 'a valid Unicode (non-ASCII) JS identifier alias'],
    ["const write_alias = writeFileSync;", true, 'an underscore-containing alias, a common real-world shape'],
    ["const notReal = writeFileSyncButLonger;", false, 'a longer identifier merely prefixed by the name'],
    ["const notReal = writeFileSync$helper;", false, 'a $-suffixed identifier merely prefixed by the name'],
    ["const notReal = writeFileSyncö;", false, 'a Unicode-suffixed identifier merely prefixed by the name'],
    ["const notReal = writeFileSync_helper;", false, 'an underscore-suffixed identifier merely prefixed by the name'],
    ["someOtherThing(writeFileSync);", false, 'passed as a call argument, not assigned — a different code shape'],
  ];
  // REBIND_RE.flags (not a hardcoded 'g' or no flags at all): REBIND_RE now
  // carries 'u' so \p{L}/\p{N} are valid property escapes rather than a
  // SyntaxError or a literal "p". Reconstructing without it silently drops
  // Unicode-mode semantics and breaks every fixture case, not just the new
  // Unicode one — caught by this fix's own mutation test.
  const rebindFixtureFailures = rebindFixtureCases
    .filter(([src, expectMatch]) => (new RegExp(REBIND_RE.source, REBIND_RE.flags).test(src)) !== expectMatch)
    .map(([src, expectMatch, label]) => `${label} (expected match=${expectMatch}): ${src}`);
  if (rebindFixtureFailures.length === 0) {
    pass('REBIND_RE matches bare and parenthesized initializers alike, without false-positiving on a longer identifier or a call argument');
  } else {
    fail(`REBIND_RE fixture mismatch: ${rebindFixtureFailures.join(' | ')}`);
  }

  if (!/from\s*['"](?:node:)?fs\/promises['"]/.test(jdArchiveSrc)) {
    pass('check-jd-archive.mjs does not import fs/promises');
  } else {
    fail('check-jd-archive.mjs imports fs/promises — write-capable API surface');
  }
  if (!/\brequire\s*\(/.test(jdArchiveSrc)) {
    pass('check-jd-archive.mjs has no require() escape hatch');
  } else {
    fail('check-jd-archive.mjs uses require() — bypasses the import whitelist');
  }
} catch (e) {
  fail(`jd-archive wiring check: ${e.message}`);
}
