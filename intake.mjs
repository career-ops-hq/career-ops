#!/usr/bin/env node
// intake.mjs — deterministic half of the `intake` mode (#1723).
//
// Scans the documents/ intake folder (master CV, LinkedIn export, diplomas,
// reference letters), extracts text from each source locally, and
// fingerprints every source so re-runs surface only genuinely new material.
//
// Division of labor (mirrors modes/add.md + add-entry.mjs):
//   - this script: enumeration, text extraction, idempotency bookkeeping —
//     everything deterministic. It NEVER writes cv.md / config/profile.yml /
//     modes/_profile.md; per repo convention those are agent-edited only,
//     after explicit user confirmation (see modes/intake.md).
//   - modes/intake.md: semantic mapping (CV → experience/skills, LinkedIn →
//     certifications, …), conflict display, the confirm gate, and the
//     source-annotated writes.
//
// PDF extraction ladder (zero new package.json deps, mirrors the
// generate-latex.mjs engine ladder): born-digital PDFs — the dominant case
// for CVs / LinkedIn "Save to PDF" exports / transcripts — carry a text
// layer that `pdftotext -layout` (Poppler) extracts directly. No extractor
// on PATH degrades to an install hint, never a crash. Scanned/image-only
// PDFs and .docx are out of scope for v1 (the summary tells the user to
// convert them).
//
// Usage:
//   node intake.mjs                 # scan + extract, JSON to stdout
//   node intake.mjs --summary       # human-readable table instead of JSON
//   node intake.mjs --text <path>   # full extracted text of one source
//   node intake.mjs --commit [path …]
//                                   # record sources as ingested — pass the
//                                   # confirmed paths when the user approved
//                                   # only some of them; no paths = all
//                                   # (run only after the user confirmed)
//   node intake.mjs --self-test     # pure-function self-test, no filesystem

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from 'fs';
import { dirname, extname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = process.env.CAREER_OPS_DOCUMENTS_DIR || join(ROOT, 'documents');
const STATE_FILE = process.env.CAREER_OPS_INTAKE_STATE || join(ROOT, 'data', 'intake-state.json');

// The four intake folders from the issue spec. Files directly under
// documents/ are picked up too — the folders are guidance, not a gate.
export const INTAKE_FOLDERS = ['cv', 'linkedin', 'diplomas', 'references'];

// Extraction ladder for PDFs, in preference order. v1 has a single rung;
// an OCR rung for scanned PDFs is an explicit later opt-in (see #1723
// thread), NOT a silent fallback — OCR output is too lossy to mix in
// unannounced.
const PDF_EXTRACTORS = [
  {
    name: 'pdftotext',
    probeArgs: ['-v'],
    // -layout preserves column layout, which keeps two-column CVs from
    // bleeding into scrambled text. `-` sends the text to stdout.
    extract: (path) => execFileSync(
      'pdftotext', ['-layout', path, '-'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    ).toString('utf-8'),
  },
];

const PDF_INSTALL_HINT =
  'No PDF text extractor found. Optional: install poppler for PDF intake '
  + '(brew install poppler / apt install poppler-utils) — .md/.txt/.tex '
  + 'sources work without it.';

/** Classify a source file by extension. Pure. */
export function classifySource(relPath) {
  const ext = extname(relPath).toLowerCase();
  if (['.md', '.txt', '.tex'].includes(ext)) return { kind: 'direct' };
  if (ext === '.pdf') return { kind: 'pdf' };
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tiff'].includes(ext)) {
    return { kind: 'unsupported', reason: 'image — convert to a text-layer PDF or .md/.txt first' };
  }
  if (['.docx', '.doc', '.odt', '.rtf'].includes(ext)) {
    return { kind: 'unsupported', reason: `${ext} — export to PDF or .md/.txt first` };
  }
  return { kind: 'unsupported', reason: `unrecognized extension ${ext || '(none)'}` };
}

/**
 * Walk the ladder and return the first extractor whose binary answers a
 * version probe, or null. `probe` is injectable for tests.
 */
export function detectPdfExtractor(probe = defaultProbe) {
  for (const candidate of PDF_EXTRACTORS) {
    if (probe(candidate)) return candidate;
  }
  return null;
}

function defaultProbe(candidate) {
  try {
    // Bounded like extract() below: a wedged binary must not hang every run.
    execFileSync(candidate.name, candidate.probeArgs, { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Annotate extracted sources against the recorded intake state. Pure.
 * A source is `new` (never ingested), `changed` (ingested before but the
 * extracted text differs), or `ingested` (hash matches the record — the
 * agent must not re-propose it; that is what makes re-runs idempotent).
 */
export function computeDelta(state, sources) {
  const recorded = new Map(Object.entries(state.ingested || {}));
  return sources.map((s) => {
    if (!s.hash) return { ...s, status: s.status || 'error' };
    const prev = recorded.get(s.path);
    if (!prev) return { ...s, status: 'new' };
    if (prev.hash !== s.hash) return { ...s, status: 'changed' };
    return { ...s, status: 'ingested' };
  });
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { ingested: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) || { ingested: {} };
  } catch {
    return { ingested: {} };
  }
}

function listSourceFiles() {
  if (!existsSync(DOCS_DIR)) return [];
  const out = [];
  // Directories already walked, by real path. Symlinks are followed (see
  // below), so without this a link back up the tree — documents/cv/loop ->
  // documents/ — re-enters it until the path length gives out, reporting
  // one CV a dozen times over. Two links to the same folder collapse too.
  const walked = new Set();
  const walk = (dir) => {
    let real;
    try { real = realpathSync(dir); } catch { return; }
    if (walked.has(real)) return;
    walked.add(real);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'README.md' && dir === DOCS_DIR) continue;
      const abs = join(dir, entry.name);
      // Follow symlinks (a symlinked master CV is a natural setup) —
      // Dirent.isFile()/isDirectory() are both false for them, which would
      // silently drop the source. Broken links are skipped.
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(abs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch { continue; }
      }
      if (isDir) walk(abs);
      else if (isFile) out.push(abs);
    }
  };
  walk(DOCS_DIR);
  return out.sort();
}

function extractAll() {
  const extractor = detectPdfExtractor();
  const sources = listSourceFiles().map((abs) => {
    const path = relative(DOCS_DIR, abs);
    const cls = classifySource(path);
    const base = { path, folder: path.includes('/') ? path.split('/')[0] : '(root)' };
    if (cls.kind === 'unsupported') {
      return { ...base, status: 'skipped', reason: cls.reason };
    }
    try {
      let text;
      if (cls.kind === 'direct') {
        text = readFileSync(abs, 'utf-8');
        base.extractor = 'direct';
      } else {
        if (!extractor) return { ...base, status: 'skipped', reason: PDF_INSTALL_HINT };
        text = extractor.extract(abs);
        base.extractor = extractor.name;
      }
      if (!text.trim()) {
        return {
          ...base,
          status: 'skipped',
          reason: 'no text extracted — likely a scanned/image-only PDF; convert or re-export with a text layer',
        };
      }
      return { ...base, chars: text.length, hash: sha256(text), preview: text.slice(0, 400) };
    } catch (err) {
      return { ...base, status: 'error', reason: String(err.message || err).split('\n')[0] };
    }
  });
  return {
    documentsDir: DOCS_DIR,
    pdfExtractor: extractor ? extractor.name : null,
    ...(extractor ? {} : { pdfHint: PDF_INSTALL_HINT }),
    sources: computeDelta(loadState(), sources),
  };
}

function ensureScaffold() {
  for (const folder of INTAKE_FOLDERS) mkdirSync(join(DOCS_DIR, folder), { recursive: true });
}

// Record sources as ingested. `only` restricts the commit to the sources the
// user actually confirmed for merge — a blanket commit after a per-item
// confirmation would mark declined sources as ingested and silently bury
// them on every future run.
function commitState(result, only = []) {
  const state = loadState();
  state.ingested = state.ingested || {};
  const now = new Date().toISOString();
  let count = 0;
  for (const s of result.sources) {
    if (!s.hash || s.status === 'ingested') continue;
    if (only.length && !only.includes(s.path)) continue;
    state.ingested[s.path] = { hash: s.hash, ingestedAt: now };
    count += 1;
  }
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return count;
}

function printSummary(result) {
  console.log(`documents/: ${result.documentsDir}`);
  console.log(`PDF extractor: ${result.pdfExtractor || 'none — ' + PDF_INSTALL_HINT}`);
  if (!result.sources.length) {
    console.log('No sources found. Drop files into documents/cv, linkedin/, diplomas/, references/.');
    return;
  }
  const w = Math.max(...result.sources.map((s) => s.path.length), 6);
  console.log(`\n${'source'.padEnd(w)}  status    detail`);
  for (const s of result.sources) {
    const detail = s.status === 'skipped' || s.status === 'error'
      ? s.reason
      : `${s.chars} chars via ${s.extractor}`;
    console.log(`${s.path.padEnd(w)}  ${s.status.padEnd(8)}  ${detail}`);
  }
  const actionable = result.sources.filter((s) => s.status === 'new' || s.status === 'changed').length;
  console.log(`\n${actionable} source(s) with new material.`);
}

function runSelfTest() {
  let passed = 0;
  let failed = 0;
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { passed += 1; return; }
    failed += 1;
    console.log(`  FAIL: ${label}\n    actual:   ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
  };

  eq('md is direct', classifySource('cv/master.md'), { kind: 'direct' });
  eq('tex is direct', classifySource('cv/master.tex'), { kind: 'direct' });
  eq('pdf is pdf', classifySource('linkedin/Profile.PDF'), { kind: 'pdf' });
  eq('docx unsupported', classifySource('cv/old.docx').kind, 'unsupported');
  eq('image unsupported', classifySource('diplomas/scan.jpg').kind, 'unsupported');

  eq('ladder picks first probing rung',
    detectPdfExtractor(() => true)?.name, 'pdftotext');
  eq('ladder degrades to null', detectPdfExtractor(() => false), null);

  const state = { ingested: { 'cv/master.md': { hash: sha256('old') } } };
  const delta = computeDelta(state, [
    { path: 'cv/master.md', hash: sha256('old') },
    { path: 'cv/master2.md', hash: sha256('x') },
    { path: 'linkedin/p.pdf', hash: sha256('new') },
    { path: 'diplomas/scan.jpg', status: 'skipped' },
  ]);
  eq('unchanged source is ingested', delta[0].status, 'ingested');
  eq('never-seen source is new', delta[1].status, 'new');
  eq('never-seen pdf is new', delta[2].status, 'new');
  eq('skipped source keeps its status', delta[3].status, 'skipped');
  const delta2 = computeDelta(state, [{ path: 'cv/master.md', hash: sha256('edited') }]);
  eq('re-extracted source with different text is changed', delta2[0].status, 'changed');

  console.log(`\nself-test: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) runSelfTest();

  ensureScaffold();
  const textIdx = args.indexOf('--text');
  if (textIdx !== -1) {
    const target = args[textIdx + 1];
    if (!target) { console.error('Usage: node intake.mjs --text <path relative to documents/>'); process.exit(1); }
    const abs = resolve(DOCS_DIR, target);
    // Scan output only ever emits paths inside documents/ — refuse anything
    // that resolves outside it.
    if (!abs.startsWith(resolve(DOCS_DIR) + sep)) {
      console.error(`Path escapes documents/: ${target}`);
      process.exit(1);
    }
    if (!existsSync(abs)) { console.error(`Not found: ${target}`); process.exit(1); }
    const cls = classifySource(target);
    let text;
    if (cls.kind === 'direct') text = readFileSync(abs, 'utf-8');
    else if (cls.kind === 'pdf') {
      const extractor = detectPdfExtractor();
      if (!extractor) { console.error(PDF_INSTALL_HINT); process.exit(1); }
      text = extractor.extract(abs);
    } else { console.error(`Unsupported source: ${cls.reason}`); process.exit(1); }
    if (!text.trim()) {
      console.error('No text extracted — likely a scanned/image-only PDF; convert or re-export with a text layer.');
      process.exit(1);
    }
    process.stdout.write(text);
    process.exit(0);
  }

  const result = extractAll();
  const commitIdx = args.indexOf('--commit');
  if (commitIdx !== -1) {
    const only = args.slice(commitIdx + 1).filter((a) => !a.startsWith('--'));
    const count = commitState(result, only);
    console.log(`Recorded ${count} source(s) as ingested → ${STATE_FILE}`);
    process.exit(0);
  }
  if (args.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
}
