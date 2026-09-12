// tests/intake.test.mjs — multi-source profile intake (#1723).
//
// Covers the deterministic half (intake.mjs): source classification, the
// PDF extraction ladder's degrade path, the idempotency delta, the CLI's
// scan/--commit round-trip on an isolated temp documents/ dir, and the
// three-place registration contract (DATA_CONTRACT / .gitignore /
// update-system manifest — same cross-check pattern as offer-prep).
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, warn, run, lastRunFailure, NODE, ROOT } from './helpers.mjs';

console.log('\nintake.mjs — multi-source profile intake (#1723)');

const intake = await import(pathToFileURL(join(ROOT, 'intake.mjs')).href);

// ── classification ──────────────────────────────────────────────────────
{
  const cases = [
    ['cv/master.md', 'direct'], ['cv/master.tex', 'direct'], ['notes.txt', 'direct'],
    ['linkedin/Profile.PDF', 'pdf'],
    ['cv/old.docx', 'unsupported'], ['diplomas/scan.jpg', 'unsupported'],
  ];
  const bad = cases.filter(([p, kind]) => intake.classifySource(p).kind !== kind);
  if (bad.length === 0) pass('classifySource maps md/txt/tex→direct, pdf→pdf, docx/images→unsupported');
  else fail(`classifySource misclassified: ${bad.map(([p]) => p).join(', ')}`);

  const docx = intake.classifySource('cv/old.docx');
  if (docx.reason && docx.reason.includes('export')) pass('unsupported sources carry a convert-first reason');
  else fail(`unsupported reason missing/unhelpful: ${JSON.stringify(docx)}`);
}

// ── extraction ladder degrade ────────────────────────────────────────────
{
  const found = intake.detectPdfExtractor(() => true);
  const none = intake.detectPdfExtractor(() => false);
  if (found && found.name === 'pdftotext' && none === null) {
    pass('PDF ladder picks pdftotext when probed, degrades to null (install hint) when absent');
  } else {
    fail(`PDF ladder wrong: found=${found && found.name}, none=${none}`);
  }
}

// ── idempotency delta ────────────────────────────────────────────────────
{
  const state = { ingested: { 'cv/master.md': { hash: intake.sha256('v1') } } };
  const delta = intake.computeDelta(state, [
    { path: 'cv/master.md', hash: intake.sha256('v1') },
    { path: 'cv/master.md.bak', hash: intake.sha256('v1') },
    { path: 'references/letter.pdf', hash: intake.sha256('quote') },
    { path: 'diplomas/scan.jpg', status: 'skipped' },
  ]);
  const statuses = delta.map((d) => d.status);
  if (JSON.stringify(statuses) === JSON.stringify(['ingested', 'new', 'new', 'skipped'])) {
    pass('computeDelta: unchanged→ingested, unseen→new (per-path, not per-content), skipped preserved');
  } else {
    fail(`computeDelta statuses wrong: ${JSON.stringify(statuses)}`);
  }
  const changed = intake.computeDelta(state, [{ path: 'cv/master.md', hash: intake.sha256('v2') }]);
  if (changed[0].status === 'changed') pass('computeDelta: re-extracted source with new text → changed');
  else fail(`expected changed, got ${changed[0].status}`);
}

// ── CLI round-trip on an isolated temp documents/ ────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), 'intake-test-'));
  const docsDir = join(tmp, 'documents');
  const stateFile = join(tmp, 'intake-state.json');
  mkdirSync(join(docsDir, 'cv'), { recursive: true });
  writeFileSync(join(docsDir, 'cv', 'master.md'), '# CV\n\n- Built things\n');
  writeFileSync(join(docsDir, 'unknown.docx'), 'binaryish');
  const env = {
    ...process.env,
    CAREER_OPS_DOCUMENTS_DIR: docsDir,
    CAREER_OPS_INTAKE_STATE: stateFile,
  };

  try {
    const scan1 = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const md = scan1 && scan1.sources.find((s) => s.path === 'cv/master.md');
    const docx = scan1 && scan1.sources.find((s) => s.path === 'unknown.docx');
    if (md && md.status === 'new' && md.extractor === 'direct' && md.hash) {
      pass('scan: fresh .md source is new, extracted directly, fingerprinted');
    } else {
      fail(`scan: unexpected md entry ${JSON.stringify(md)}`);
    }
    if (docx && docx.status === 'skipped') pass('scan: .docx source is skipped with a reason, not an error');
    else fail(`scan: unexpected docx entry ${JSON.stringify(docx)}`);

    // A bare `--commit` must not mean "record everything": main() filters flags
    // out of the path list, so `--commit --summary` reached commitState() with an
    // empty `only` and fell through to the blanket branch, burying sources the
    // user never confirmed (#1843 review follow-up).
    //
    // Asserting the state file is untouched, not just the exit code: the fix has
    // to refuse *before* writing, and an exit-code-only check would pass against
    // code that committed and then errored.
    const refused = run(NODE, ['intake.mjs', '--commit', '--summary'], { env });
    const refusedErr = (lastRunFailure() || {}).stderr || '';
    const afterRefusal = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const stillNew = afterRefusal && afterRefusal.sources.find((s) => s.path === 'cv/master.md');
    if (refused === null && refusedErr.includes('--all') && stillNew && stillNew.status === 'new') {
      pass('--commit with no confirmed paths refuses instead of blanket-committing');
    } else {
      fail(`--commit with only flags should refuse: exit=${JSON.stringify(refused)}, status=${stillNew && stillNew.status}, stderr=${JSON.stringify(refusedErr.slice(0, 200))}`);
    }

    run(NODE, ['intake.mjs', '--commit', '--all'], { env });
    const scan2 = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const md2 = scan2 && scan2.sources.find((s) => s.path === 'cv/master.md');
    if (md2 && md2.status === 'ingested') pass('--commit makes the re-run report the source as ingested (idempotent)');
    else fail(`re-run after --commit: expected ingested, got ${JSON.stringify(md2)}`);

    writeFileSync(join(docsDir, 'cv', 'master.md'), '# CV\n\n- Built things\n- Shipped more\n');
    const scan3 = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const md3 = scan3 && scan3.sources.find((s) => s.path === 'cv/master.md');
    if (md3 && md3.status === 'changed') pass('edited source after commit is reported as changed');
    else fail(`edited source: expected changed, got ${JSON.stringify(md3)}`);

    const text = run(NODE, ['intake.mjs', '--text', 'cv/master.md'], { env });
    if (text && text.includes('Shipped more')) pass('--text prints the full extracted source text');
    else fail(`--text output wrong: ${JSON.stringify(text)}`);

    // Selective --commit: a declined source must stay proposable (#1843
    // review finding — blanket commit after per-item confirm would bury it).
    writeFileSync(join(docsDir, 'cv', 'declined.md'), '# Second CV\n');
    run(NODE, ['intake.mjs', '--commit', 'cv/master.md'], { env });
    const scan4 = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const merged = scan4 && scan4.sources.find((s) => s.path === 'cv/master.md');
    const declined = scan4 && scan4.sources.find((s) => s.path === 'cv/declined.md');
    if (merged && merged.status === 'ingested' && declined && declined.status === 'new') {
      pass('--commit <path> records only the confirmed source; declined stays new');
    } else {
      fail(`selective commit wrong: merged=${merged && merged.status}, declined=${declined && declined.status}`);
    }

    // --text must not escape documents/ (path containment).
    const escaped = run(NODE, ['intake.mjs', '--text', '../intake-state.json'], { env });
    if (escaped === null) pass('--text refuses paths that resolve outside documents/');
    else fail('--text followed a path outside documents/');

    // existsSync() passes for a directory, so an unreadable/non-regular target
    // reaches readFileSync and used to throw EISDIR as an uncaught stack trace.
    // It must fail the controlled way instead (#1843 review finding).
    //
    // Asserting on stderr, not just the exit code: an uncaught exception also
    // exits nonzero, so `run() === null` alone cannot tell a stack trace from a
    // handled error and would pass against the unfixed code.
    mkdirSync(join(docsDir, 'cv', 'notes.md'));
    const unreadable = run(NODE, ['intake.mjs', '--text', 'cv/notes.md'], { env });
    const errOut = (lastRunFailure() || {}).stderr || '';
    if (unreadable === null && errOut.includes('Could not read cv/notes.md') && !/^\s+at /m.test(errOut)) {
      pass('--text reports an unreadable/non-regular source as a handled error, not a stack trace');
    } else {
      fail(`--text on a directory should fail controllably, got exit=${JSON.stringify(unreadable)} stderr=${JSON.stringify(errOut.slice(0, 200))}`);
    }

    const selfTest = run(NODE, ['intake.mjs', '--self-test'], { env });
    if (selfTest !== null && selfTest.includes('0 failed')) pass('intake.mjs --self-test passes');
    else fail('intake.mjs --self-test failed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── symlink handling ─────────────────────────────────────────────────────
// Symlinks are followed on purpose (a symlinked master CV is a natural
// setup), which makes two behaviours worth pinning: a link cycle must not
// multiply the walk, and a link out of documents/ must keep working.
//
// Creating one needs a privilege that Windows does not grant by default:
// SeCreateSymbolicLinkPrivilege, held by Administrators or by everyone once
// Developer Mode is on. An ordinary non-elevated shell gets EPERM. These
// assertions therefore degrade to a warning rather than throwing, the same way
// the plugin-manifest traversal checks in test-all.mjs already do — CI runs
// elevated and still exercises every one of them, so nothing is lost there.
{
  const tmp = mkdtempSync(join(tmpdir(), 'intake-symlink-'));
  const docsDir = join(tmp, 'documents');
  const outsideDir = join(tmp, 'outside');
  mkdirSync(join(docsDir, 'cv'), { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const env = {
    ...process.env,
    CAREER_OPS_DOCUMENTS_DIR: docsDir,
    CAREER_OPS_INTAKE_STATE: join(tmp, 'intake-state.json'),
  };

  try {
    writeFileSync(join(docsDir, 'cv', 'master.md'), '# CV\n');
    // documents/cv/loop -> documents/ : walking it naively re-enters the
    // tree until the path length gives out, reporting one file many times.
    symlinkSync(docsDir, join(docsDir, 'cv', 'loop'));

    const scan = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const cvHits = scan && scan.sources.filter((s) => s.path.endsWith('master.md'));
    if (cvHits && cvHits.length === 1 && cvHits[0].path === 'cv/master.md') {
      pass('symlink cycle is walked once: the source is reported a single time');
    } else {
      fail(`symlink cycle multiplied the walk: ${JSON.stringify((cvHits || []).map((s) => s.path))}`);
    }

    // A master CV living outside the repo, linked in — the documented setup.
    writeFileSync(join(outsideDir, 'real-cv.md'), '# Linked CV\n');
    symlinkSync(join(outsideDir, 'real-cv.md'), join(docsDir, 'cv', 'linked.md'));
    const scan2 = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const linked = scan2 && scan2.sources.find((s) => s.path === 'cv/linked.md');
    const text = run(NODE, ['intake.mjs', '--text', 'cv/linked.md'], { env });
    if (linked && linked.hash && text && text.includes('Linked CV')) {
      pass('a source symlinked out of documents/ is still scanned and readable');
    } else {
      fail(`symlinked-out source broken: entry=${JSON.stringify(linked)}, text=${JSON.stringify(text)}`);
    }

    // Two aliases onto one folder: the walk keeps whichever it reaches first,
    // and that path is the key in intake-state.json. readdirSync order is
    // filesystem-dependent, so the alias could differ between machines and an
    // ingested source would resurface as new (#1843 review finding).
    //
    // `current` sorts before `cv`, so this also pins the half that sorting
    // alone gets wrong: the real directory must win over the link, not merely
    // win consistently.
    symlinkSync(join(docsDir, 'cv'), join(docsDir, 'current'));
    const aliased = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const aliasHits = aliased && aliased.sources.filter((s) => s.path.endsWith('master.md'));
    if (aliasHits && aliasHits.length === 1 && aliasHits[0].path === 'cv/master.md') {
      pass('a folder reachable by both a real path and a symlink is reported under the real one');
    } else {
      fail(`aliased folder resolved to the wrong/unstable path: ${JSON.stringify((aliasHits || []).map((s) => s.path))}`);
    }

    // Same rule, one level down — the case a per-directory sort cannot fix.
    // The walk enters real `a/` before it ever reaches `z/`, so a link inside
    // `a` claims z's real path first and z is skipped on arrival (#1843 review
    // follow-up). Deleting the link would then report z's unchanged source as
    // new, because the state key was `a/link/...`.
    mkdirSync(join(docsDir, 'a'));
    mkdirSync(join(docsDir, 'z'));
    writeFileSync(join(docsDir, 'z', 'deep.md'), '# Deep CV\n');
    symlinkSync(join(docsDir, 'z'), join(docsDir, 'a', 'link'));
    const nested = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const deepHits = nested && nested.sources.filter((s) => s.path.endsWith('deep.md'));
    if (deepHits && deepHits.length === 1 && deepHits[0].path === 'z/deep.md') {
      pass('a link nested under an earlier directory still yields to the real path');
    } else {
      fail(`nested alias won over the real path: ${JSON.stringify((deepHits || []).map((s) => s.path))}`);
    }
  } catch (e) {
    // Only the missing privilege is tolerated, and only from symlink() itself.
    // Anything else — including an EPERM from some other syscall — is a real
    // failure and must still surface, or this becomes a blanket catch that
    // quietly turns broken symlink handling into a skipped line.
    if (e?.code === 'EPERM' && e?.syscall === 'symlink') {
      warn(`intake symlink tests skipped: no symlink privilege (${e.code}) — enable Developer Mode or run elevated to exercise them`);
    } else {
      throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── unreadable directory in the real-dir pre-pass ────────────────────────
// realpathSync in claimRealDirs() is guarded, but its readdirSync was not, so
// one unreadable directory under documents/ — easily reached through the
// symlink-into-a-shared-tree setup the mode documents — aborted the whole scan
// instead of skipping that directory (#1843 review follow-up).
if (process.platform !== 'win32' && process.getuid?.() !== 0) {
  const tmp = mkdtempSync(join(tmpdir(), 'intake-unreadable-'));
  const docsDir = join(tmp, 'documents');
  const locked = join(docsDir, 'diplomas', 'locked');
  mkdirSync(join(docsDir, 'cv'), { recursive: true });
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(docsDir, 'cv', 'master.md'), '# CV\n');
  const env = {
    ...process.env,
    CAREER_OPS_DOCUMENTS_DIR: docsDir,
    CAREER_OPS_INTAKE_STATE: join(tmp, 'intake-state.json'),
  };

  try {
    chmodSync(locked, 0o000);
    const scan = JSON.parse(run(NODE, ['intake.mjs'], { env }) || 'null');
    const md = scan && scan.sources.find((s) => s.path === 'cv/master.md');
    if (md && md.status === 'new') {
      pass('an unreadable directory under documents/ is skipped, the rest of the scan still reports');
    } else {
      fail(`unreadable directory aborted the scan: ${JSON.stringify((lastRunFailure() || {}).stderr || '').slice(0, 200)}`);
    }
  } finally {
    try { chmodSync(locked, 0o755); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── mode instructions cover the whole delta ──────────────────────────────
// Step 1 says `new` and `changed` both carry new material; Step 2's heading
// said "each new source", so an agent following the heading never read an
// edited document (#1843 review follow-up).
{
  const modeDoc = readFileSync(join(ROOT, 'modes', 'intake.md'), 'utf-8');
  const step2 = modeDoc.split(/\r?\n/).find((l) => l.startsWith('## Step 2'));
  if (step2 && /changed/.test(step2)) pass('modes/intake.md Step 2 tells the agent to read changed sources too');
  else fail(`Step 2 heading skips changed sources: ${JSON.stringify(step2)}`);

  const commitBlock = modeDoc.includes('--commit --all');
  if (commitBlock) pass('modes/intake.md documents the explicit --commit --all form');
  else fail('modes/intake.md still shows a bare `--commit` as the record-everything form');
}

// ── three-place registration contract (offer-prep pattern) ───────────────
{
  const dataContractDoc = readFileSync(join(ROOT, 'DATA_CONTRACT.md'), 'utf-8');
  const gitignoreDoc = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
  const updaterSrc = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const agentsDoc = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
  if (
    dataContractDoc.includes('documents/*')
    && dataContractDoc.includes('data/intake-state.json')
    && gitignoreDoc.includes('documents/*')
    && gitignoreDoc.includes('!documents/.gitkeep')
    && gitignoreDoc.includes('!documents/README.md')
    && gitignoreDoc.includes('data/intake-state.json')
    && updaterSrc.includes("'documents/'")
    && updaterSrc.includes("'modes/intake.md'")
    && updaterSrc.includes("'intake.mjs'")
    && agentsDoc.includes('`intake`')
  ) {
    pass('intake registered in data contract, gitignore, updater manifest, and AGENTS.md routing');
  } else {
    fail('intake missing from data contract / gitignore / update-system paths / AGENTS.md');
  }

  // documents/ holds the master CV, diplomas and reference letters — the
  // highest-PII folder in the product. tests/user-layer-gitignored.test.mjs
  // derives its git check-ignore guard from exactly this line, so being absent
  // from it means no behavioural guard at all (#1843 review follow-up).
  const userLayerLine = agentsDoc.split(/\r?\n/).find((l) => l.includes('**User Layer'));
  if (userLayerLine && userLayerLine.includes('`documents/*`')) {
    pass('documents/ is declared on the AGENTS.md User Layer line (feeds the gitignore guard)');
  } else {
    fail('AGENTS.md User Layer line omits `documents/*` — the gitignore regression guard skips it');
  }
}
