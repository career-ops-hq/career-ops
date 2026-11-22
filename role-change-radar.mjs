#!/usr/bin/env node
// Core entry point; the web layer passes application metadata resolved by its existing readers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { writeFileAtomic, pathIsInsideCanonical } from './tracker-utils.mjs';
import { acquireDirLock } from './lib/dir-lock.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { findCaptureForReport, captureSlug } from './jd-capture.mjs';
import { hasEmbeddedJdArchive, detectNonContentMarker } from './check-jd-archive.mjs';
import { JD_HEADING_RE, NEXT_REPORT_SECTION_RE } from './lib/jd-archive-section.mjs';
import { rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { jobIdToken } from './liveness-core.mjs';
import { MAX_TEXT, hashText, compareDescriptions, identityWarnings } from './lib/role-change-compare.mjs';
import { tokenize, jaccardSimilarity } from './jd-similarity.mjs';

export function validateCapture(capture) {
  if (!capture || typeof capture.text !== 'string' || !capture.text.trim()) throw new Error('Unable to check: empty extraction. Paste the complete description instead.');
  if (capture.error || capture.blocked || detectNonContentMarker(capture.text) || /(?:verify you are human|access denied|captcha|sign in to continue)/i.test(capture.text)) throw new Error('Unable to check: blocked or invalid posting. Paste publicly available text instead.');
  if (capture.partial || capture.truncated || capture.text.length >= MAX_TEXT || capture.text.trim().length < 100 || /(?:\[truncated\]|\.\.\.\s*read more|…\s*$)/i.test(capture.text)) throw new Error('Incomplete extraction: provide the complete description (100–59,999 characters).');
}
export async function fetchPosting(url) {
  const refusal = rejectPrivateOrInvalid(url);
  if (refusal) throw new Error(`Unable to check: ${refusal.reason}`);
  const script = fileURLToPath(new URL('./browser-extract.mjs', import.meta.url));
  return new Promise((resolve, reject) => execFile(process.execPath, [script, url, '--mode', 'jd', '--max-chars', String(MAX_TEXT), '--timeout', '15000'], { timeout: 25_000, maxBuffer: 512_000, windowsHide: true }, (err, stdout) => {
    if (err) return reject(new Error('Unable to check: public extraction failed or timed out. This does not establish that the job closed. Paste the description instead.'));
    try { const result = JSON.parse(stdout); validateCapture(result); resolve(result); } catch (error) { reject(error); }
  }));
}
function safe(root, file) {
  if (!pathIsInsideCanonical(file, root)) throw new Error('Unsafe Radar path outside the data root');
  return file;
}
function readText(root, file) {
  safe(root, file);
  if (fs.statSync(file).size > MAX_TEXT * 8) throw new Error('Archive is too large to inspect');
  return fs.readFileSync(file, 'utf8');
}
export function discoverBaseline(root, app) {
  const candidates = [];
  // Reports have no guaranteed capture timestamp. Never substitute evaluation date or mtime.
  if (app.reportFile) {
    const file = safe(root, path.resolve(root, app.reportFile));
    const report = readText(root, file);
    if (hasEmbeddedJdArchive(report)) {
      const match = JD_HEADING_RE.exec(report), rest = report.slice(match.index + match[0].length);
      const end = rest.search(NEXT_REPORT_SECTION_RE);
      const text = (end < 0 ? rest : rest.slice(0, end)).trim();
      candidates.push({ text, capturedAt: null, source: path.relative(root, file), basis: 'Earliest saved description' });
    }
  }
  if (app.reportNum) {
    const dir = safe(root, path.join(root, 'jds'));
    try { fs.readdirSync(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Reuse the existing report/company match for every candidate, rather than guessing from role slugs.
    const found = findCaptureForReport(dir, app.reportNum, { companySlug: captureSlug(app.company) });
    for (const name of found?.candidates || []) {
      if (!/\.(md|txt)$/i.test(name)) continue;
      const rest = name.replace(/^\d+-/, '').replace(/^\d{4}-\d{2}-\d{2}[_-]/, '');
      const slug = captureSlug(app.company);
      if (!slug || !rest.toLowerCase().startsWith(slug) || !/^[-_.]/.test(rest.slice(slug.length))) continue;
      const text = readText(root, path.join(dir, name));
      const date = /^\d+-(\d{4}-\d{2}-\d{2})[_-]/.exec(name)?.[1] || null;
      candidates.push({ text, capturedAt: date, source: `jds/${name}`, basis: 'Earliest saved description' });
    }
  }
  const usable = candidates.filter(c => { try { validateCapture(c); return true; } catch { return false; } });
  usable.sort((a, b) => (a.capturedAt || '9999').localeCompare(b.capturedAt || '9999'));
  const baseline = usable[0];
  return baseline ? { ...baseline, hash: hashText(baseline.text), chronologyUncertain: usable.some(c => !c.capturedAt) } : null;
}
function readStore(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.captures) || !Array.isArray(state.comparisons)) throw new Error('Invalid Radar store');
    for (const capture of [state.baseline, ...state.captures].filter(Boolean)) {
      if (typeof capture.text !== 'string' || hashText(capture.text) !== capture.hash) throw new Error('Invalid Radar capture or content hash');
    }
    for (const comparison of state.comparisons) {
      if (!Array.isArray(comparison.changes) || !Array.isArray(comparison.warnings) || !state.captures.some(c => c.hash === comparison.captureHash && c.source === comparison.source)) throw new Error('Invalid Radar comparison');
    }
    return state;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function radar(root, app, input, { extract = fetchPosting, now = () => new Date().toISOString() } = {}) {
  if (!app || !/^\d+$/.test(String(app.id)) || !app.company || !app.title) throw new Error('A tracked application with company and title is required');
  if (!['load', 'check', 'baseline', 'review'].includes(input.action)) throw new Error('Unknown Radar action');
  // Keep tracker identity stable when the application later gains a report.
  const identity = `tracker:${app.id}:${app.company}:${app.title}`;
  const directory = safe(root, path.join(root, 'data', 'role-change-radar'));
  fs.mkdirSync(directory, { recursive: true });
  const file = safe(root, path.join(directory, `${hashText(identity)}.json`));
  const lockPath = safe(root, `${file}.lock`);
  const lock = await acquireDirLock(lockPath, { timeoutMs: 1000, maxWaitMs: 1500, retryMs: 50, staleMs: 60_000 });
  try {
    let state = readStore(file) || { version: 1, identity, baseline: null, captures: [], comparisons: [], lastCheck: null };
    if (state.identity !== identity) throw new Error('Radar application identity does not match saved state');
    if (!state.baseline) state.baseline = discoverBaseline(root, app);
    if (input.action === 'review') {
      const comparison = state.comparisons.find(c => c.id === input.comparisonId);
      if (!comparison) throw new Error('Comparison not found');
      comparison.reviewedAt = now();
    } else if (input.action === 'check' || input.action === 'baseline') {
      try {
        if (!state.baseline && input.action !== 'baseline') throw new Error('No baseline: save the current description for future checks first.');
        if (state.baseline && input.action === 'baseline') throw new Error('The preserved baseline already exists.');
        const manual = input.source === 'paste';
        if (!manual && input.source !== 'public') throw new Error('Choose public extraction or pasted text');
        const raw = manual ? { text: input.text } : await extract(app.url);
        validateCapture(raw);
        if (!manual && rejectPrivateOrInvalid(raw.url || app.url)) throw new Error('Unsafe extraction destination');
        if (!manual && state.baseline && raw.text.length < state.baseline.text.length * 0.35) throw new Error('Incomplete extraction: substantially less text than the baseline. Verify the full posting and paste it to compare.');
        const capturedAt = now();
        const labeled = label => raw.text.match(new RegExp(`^\\s*(?:\\*\\*)?${label}\\s*:(?:\\*\\*)?\\s*(.+)$`, 'im'))?.[1]?.trim();
        const capture = { text: raw.text, title: labeled('(?:Job title|Title)') || raw.title || null, company: labeled('Company') || raw.company || null, capturedAt, source: manual ? 'User-provided paste (not independently verified)' : raw.url || app.url, hash: hashText(raw.text) };
        let warnings = identityWarnings({ title: app.title, company: app.company, text: state.baseline?.text }, capture);
        if (!manual) warnings.push(...identityWarnings({ title: app.title, company: app.company }, raw));
        if (state.baseline && jaccardSimilarity(tokenize(state.baseline.text), tokenize(capture.text)) < 0.12) warnings.push('The description has very little text in common with the baseline; verify that this is the same opening.');
        if (!manual && jobIdToken(app.url) && jobIdToken(capture.source) && jobIdToken(app.url) !== jobIdToken(capture.source)) warnings.push('The destination URL identifies a different posting.');
        if (!manual) {
          const requested = new URL(app.url), final = new URL(capture.source);
          if (requested.origin !== final.origin || requested.pathname.replace(/\/$/, '') !== final.pathname.replace(/\/$/, '')) warnings.push('The posting redirected to a different address; verify its identity before comparing.');
        }
        if (warnings.length) throw new Error(`Possible posting-identity mismatch: ${warnings.join(' ')} No comparison saved. Check the posting and paste the correct description.`);
        if (!state.baseline) {
          state.baseline = { ...capture, basis: 'Saved for future checks', chronologyUncertain: false };
          state.lastCheck = { at: capturedAt, status: 'baseline-saved' };
        } else {
          let stored = state.captures.find(c => c.hash === capture.hash && c.source === capture.source);
          if (!stored) { stored = capture; state.captures.push(stored); }
          const previous = state.comparisons.at(-1);
          let comparison = previous;
          // A return to an earlier revision is a new event and needs its own review.
          if (!previous || previous.captureHash !== capture.hash || previous.source !== capture.source) {
            comparison = { id: `${capturedAt}-${state.comparisons.length}`, captureHash: capture.hash, source: capture.source, checkedAt: capturedAt, reviewedAt: null, ...compareDescriptions(state.baseline.text, capture.text) };
            state.comparisons.push(comparison);
          }
          state.lastCheck = { at: capturedAt, status: 'success', comparisonId: comparison.id };
        }
      } catch (error) { state.lastCheck = { at: now(), status: 'failed', error: error.message }; }
    }
    writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  } finally { lock.release(); }
}
// A pipe can split a UTF-8 character across chunks. Bound the original bytes,
// then decode once so the archived text and its hash retain the user's input.
export async function readRadarRequest(stream) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 300_000) throw new Error('Request too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, ['--help', '-h'], `Usage: node role-change-radar.mjs [--help]
Read one JSON request from stdin: { "app": { "id", "company", "title", "reportNum", "reportFile", "url" }, "input": { "action", "source", "text", "comparisonId" } }.
Actions: load, check, baseline, review. Sources: public, paste.
Application metadata must come from the existing tracker/report readers.
Stores Radar history under the configured data root; does not modify the tracker or reports.`);
  try {
    if (args.length) throw new Error('Unexpected arguments; pass the request JSON on stdin or use --help');
    const { app, input } = await readRadarRequest(process.stdin);
    process.stdout.write(JSON.stringify(await radar(getCareerOpsRoot(), app, input)));
  } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
