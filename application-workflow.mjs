#!/usr/bin/env node
// Runs the SQLite-backed application handoff without ever submitting a form.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openOpportunityStore } from './src/opportunities/store.mjs';
import { applicationArtifactPaths, ensureApplicationArtifactDirs } from './application-artifacts.mjs';
import { renderReactiveResume } from './reactive-resume.mjs';

export function assertSafeField(field) {
  if (!field?.selector || !['text', 'textarea', 'select', 'file'].includes(field.type)) throw new Error('Only text, textarea, select, and file fields may be filled');
  if (/submit|apply|send|button/i.test(field.selector)) throw new Error('Submission controls cannot be filled');
}

export async function fillSafeFields(page, fields) {
  for (const field of fields) {
    assertSafeField(field);
    if (field.type === 'file') await page.locator(field.selector).setInputFiles(field.value);
    else if (field.type === 'select') await page.locator(field.selector).selectOption(String(field.value));
    else await page.locator(field.selector).fill(String(field.value));
  }
}

export function verifyApplicationPdf(pdfPath, expectedText = [], { visualConfirmed = false, run = execFileSync } = {}) {
  const path = resolve(pdfPath);
  if (!existsSync(path)) throw new Error(`PDF not found: ${pdfPath}`);
  if (!expectedText.filter(Boolean).length) throw new Error('PDF verification requires expected text or section names');
  const extracted = String(run('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' })).trim();
  if (!extracted) throw new Error('PDF has no selectable text');
  for (const text of expectedText.filter(Boolean)) if (!extracted.includes(text)) throw new Error(`PDF is missing expected text: ${text}`);
  const rasterDir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-smoke-'));
  try {
    run('pdfinfo', [path], { encoding: 'utf8' });
    run('pdftoppm', ['-f', '1', '-singlefile', '-png', path, join(rasterDir, 'page')], { encoding: 'utf8' });
    const image = join(rasterDir, 'page.png');
    if (!existsSync(image) || statSync(image).size < 1024) throw new Error('PDF visual smoke render failed');
    const header = readFileSync(image);
    if (header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PDF visual smoke render is not a PNG');
    if (header.readUInt32BE(16) < 100 || header.readUInt32BE(20) < 100) throw new Error('PDF visual smoke render is too small');
  } finally { rmSync(rasterDir, { recursive: true, force: true }); }
  if (!visualConfirmed) throw new Error('PDF visual review requires explicit confirmation');
  return { text: extracted, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

export async function renderApplicationResume({ store, id, reportNum, payloadPath, config, version = 1, root = 'output', fetchImpl }) {
  const opportunity = store.opportunity(id);
  if (!opportunity || opportunity.applicationState !== 'preparing') throw new Error(`Opportunity ${id} must be in application preparation`);
  const paths = ensureApplicationArtifactDirs(applicationArtifactPaths({ reportNum, company: opportunity.company, role: opportunity.role, version, root }));
  const payload = JSON.parse(await readFile(resolve(payloadPath), 'utf8'));
  await writeFile(paths.cv.tailored.json, `${JSON.stringify(payload, null, 2)}\n`);
  const result = await renderReactiveResume({
    payload, inputPath: paths.cv.tailored.json, outputPath: paths.cv.tailored.pdf, metadataPath: paths.cv.reactiveResume,
    reportNum, company: opportunity.company, role: opportunity.role, version,
    baseResumeId: config.base_resume_id, apiBaseUrl: config.api_base_url, apiKey: config.api_key, fetchImpl, recordManifest: false,
  });
  store.recordApplicationArtifact(id, { kind: 'tailored-cv-json', path: paths.cv.tailored.json, sha256: createHash('sha256').update(readFileSync(paths.cv.tailored.json)).digest('hex') });
  store.recordApplicationArtifact(id, { kind: 'application-pdf', path: result.outputPath, sha256: createHash('sha256').update(readFileSync(result.outputPath)).digest('hex') });
  return { paths, result };
}

function value(args, flag) { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; }

async function main(args = process.argv.slice(2)) {
  const [command, idText] = args;
  const id = Number(idText);
  const databasePath = value(args, '--db') || process.env.CAREER_OPS_OPPORTUNITY_DB;
  if (!Number.isInteger(id) || id < 1 || !databasePath) throw new Error('Usage: node application-workflow.mjs <start|render-resume|verify-pdf|fill|confirm-submitted> <opportunity-id> --db <path>');
  const store = await openOpportunityStore(databasePath);
  try {
    if (command === 'start') {
      const report = value(args, '--report');
      if (!report) throw new Error('start requires --report <number>');
      const selected = store.opportunity(id);
      if (!selected) throw new Error(`Opportunity ${id} not found`);
      const paths = applicationArtifactPaths({ reportNum: report, company: selected.company, role: selected.role });
      const opportunity = store.startApplication(id);
      ensureApplicationArtifactDirs(paths);
      console.log(JSON.stringify({ opportunity, paths }, null, 2));
    } else if (command === 'render-resume') {
      const reportNum = value(args, '--report');
      const payloadPath = value(args, '--payload');
      const profilePath = value(args, '--profile') || 'config/profile.yml';
      if (!reportNum || !payloadPath) throw new Error('render-resume requires --report <number> and --payload <cv.json>');
      const profile = (await import('js-yaml')).load(await readFile(profilePath, 'utf8')) || {};
      const config = { ...profile.cv?.reactive_resume, api_key: process.env.REACTIVE_RESUME_API_KEY };
      const rendered = await renderApplicationResume({ store, id, reportNum, payloadPath, config, version: Number(value(args, '--version') || 1) });
      console.log(JSON.stringify({ pdf: rendered.result.outputPath, verified: false }, null, 2));
    } else if (command === 'verify-pdf') {
      const pdf = value(args, '--pdf');
      if (!pdf) throw new Error('verify-pdf requires --pdf <path>');
      const verified = verifyApplicationPdf(pdf, args.filter(arg => arg.startsWith('--expect=')).map(arg => arg.slice(9)), { visualConfirmed: args.includes('--visual-confirmed') });
      store.recordVerifiedApplicationPdf(id, { path: resolve(pdf), sha256: verified.sha256 });
      console.log(JSON.stringify({ verified: true, sha256: verified.sha256 }, null, 2));
    } else if (command === 'fill') {
      const opportunity = store.opportunity(id);
      const url = value(args, '--url');
      const fieldsPath = value(args, '--fields');
      if (opportunity?.applicationState !== 'preparing') throw new Error(`Opportunity ${id} must be in application preparation`);
      if (!url || new URL(url).protocol !== 'https:' || !fieldsPath) throw new Error('fill requires an HTTPS --url and --fields <json>');
      const fields = JSON.parse(await readFile(fieldsPath, 'utf8'));
      if (!Array.isArray(fields)) throw new Error('--fields must contain an array');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await fillSafeFields(page, fields);
        console.log('Fields filled. Review the visible form and submit it yourself; this command never clicks Submit.');
        await new Promise(resolve => process.stdin.once('data', resolve));
      } finally { await browser.close(); }
    } else if (command === 'confirm-submitted') {
      const opportunity = store.confirmSubmitted(id, value(args, '--confirm'));
      console.log(JSON.stringify(opportunity, null, 2));
    } else throw new Error('Command must be start, verify-pdf, or confirm-submitted');
  } finally { store.close(); }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) main().catch(error => { console.error(`application-workflow: ${error.message}`); process.exitCode = 1; });
