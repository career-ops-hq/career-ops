// tests/intake.test.mjs — multi-source profile intake (#1723).
//
// Covers the deterministic half (intake.mjs): source classification, the
// PDF extraction ladder's degrade path, the idempotency delta, the CLI's
// scan/--commit round-trip on an isolated temp documents/ dir, and the
// three-place registration contract (DATA_CONTRACT / .gitignore /
// update-system manifest — same cross-check pattern as offer-prep).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, run, NODE, ROOT } from './helpers.mjs';

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

    run(NODE, ['intake.mjs', '--commit'], { env });
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

    const selfTest = run(NODE, ['intake.mjs', '--self-test'], { env });
    if (selfTest !== null && selfTest.includes('0 failed')) pass('intake.mjs --self-test passes');
    else fail('intake.mjs --self-test failed');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
}
