#!/usr/bin/env node
// Inventories and, only when lossless, imports legacy discovery records into SQLite.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { parseScanHistory } from './detect-reposts.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { openOpportunityStore } from './src/opportunities/store.mjs';
import { validateReviewedReport } from './scoring-report.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const urlFromPipeline = text => [...text.matchAll(/https?:\/\/[^\s|]+/g)].map(match => match[0]);
const machineSummary = text => yaml.load(text.match(/## Machine Summary\s*\n\s*```yaml\s*\n([\s\S]*?)\n```/)?.[1] ?? '');
const browserUrl = (summary, root) => {
  const source = summary?.sources?.find(item => item.id === 'browser');
  try { return JSON.parse(readFileSync(join(root, source.path), 'utf8')).url ?? null; } catch { return null; }
};

export function buildMigrationPlan(root = ROOT) {
  const scanPath = join(root, 'data/scan-history.tsv');
  const pipelinePath = join(root, 'data/pipeline.md');
  const applicationsPath = join(root, 'data/applications.md');
  const reportsPath = join(root, 'reports');
  const files = [scanPath, pipelinePath, applicationsPath].filter(existsSync);
  const scanRows = existsSync(scanPath) ? parseScanHistory(readFileSync(scanPath, 'utf8')) : [];
  const byUrl = new Map();
  for (const row of scanRows) {
    if (!row.company || !row.title) continue;
    const entries = byUrl.get(row.url) ?? [];
    entries.push(row);
    byUrl.set(row.url, entries);
  }
  const mappings = [];
  const collisions = [];
  const unmapped = [];
  for (const [url, rows] of byUrl) {
    const identities = new Set(rows.map(row => `${row.company}\u0000${row.title}`));
    if (identities.size !== 1) {
      collisions.push({ type: 'scan-url-conflict', url, identities: [...identities] });
      continue;
    }
    const [company, role] = [...identities][0].split('\u0000');
    mappings.push({ url, company, role, observations: rows.map(row => ({ observedOn: row.dateStr, source: row.portal || 'scan' })) });
  }
  for (const row of scanRows) if (!row.company || !row.title) unmapped.push({ type: 'scan-metadata', url: row.url, missing: [!row.company && 'company', !row.title && 'title'].filter(Boolean) });
  for (const url of existsSync(pipelinePath) ? urlFromPipeline(readFileSync(pipelinePath, 'utf8')) : []) if (!byUrl.has(url)) unmapped.push({ type: 'pipeline-url', url, missing: ['company', 'role'] });
  const artifacts = [];
  const invalidReports = [];
  for (const name of existsSync(reportsPath) ? readdirSync(reportsPath).filter(name => name.endsWith('.md')).sort() : []) {
    const path = join(reportsPath, name);
    files.push(path);
    const text = readFileSync(path, 'utf8');
    const summary = machineSummary(text);
    const url = browserUrl(summary, root);
    if (!url || !summary?.company || !summary?.role) {
      unmapped.push({ type: 'report', path: `reports/${name}`, missing: ['frozen browser URL'] });
      continue;
    }
    let target = mappings.find(row => row.url === url);
    if (!target) {
      target = { url, company: summary.company, role: summary.role, observations: [] };
      mappings.push(target);
    }
    const artifact = { url, path: `reports/${name}`, sha256: sha256(path) };
    artifacts.push(artifact);
    try {
      const review = JSON.parse(readFileSync(`${path}.review.json`, 'utf8'));
      const score = validateReviewedReport(text, review, { root });
      if (target.evaluation) invalidReports.push({ path: artifact.path, error: 'duplicate scored report for frozen URL' });
      else target.evaluation = { ...score, reportHash: artifact.sha256, gates: review.gates };
    } catch (error) { invalidReports.push({ path: artifact.path, error: error.message }); }
  }
  const groupedArtifacts = new Map();
  for (const artifact of artifacts) groupedArtifacts.set(artifact.url, [...(groupedArtifacts.get(artifact.url) ?? []), artifact]);
  const byIdentity = new Map();
  for (const row of mappings) {
    const key = `${row.company}\u0000${row.role}`;
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), row]);
  }
  const applicationLines = existsSync(applicationsPath) ? readFileSync(applicationsPath, 'utf8').split('\n') : [];
  const applications = applicationLines.map(line => parseTrackerRow(line, resolveColumns(applicationLines))).filter(Boolean);
  for (const application of applications) {
    const targets = byIdentity.get(`${application.company}\u0000${application.role}`) ?? [];
    if (targets.length === 0) unmapped.push({ type: 'application', record: application.num, missing: ['exact URL mapping'] });
    else if (targets.length > 1) collisions.push({ type: 'application-identity-conflict', record: application.num, urls: targets.map(target => target.url) });
    else targets[0].applications = [...(targets[0].applications ?? []), { record: application.num, status: application.status, report: application.report }];
  }
  return {
    version: 1,
    sources: files.sort().map(path => ({ path: path.slice(root.length + 1), sha256: sha256(path) })),
    mappings: mappings.map(row => ({ ...row, artifacts: groupedArtifacts.get(row.url) ?? [], applications: row.applications ?? [] })),
    collisions,
    unmapped,
    invalidReports,
    summary: { scanRecords: scanRows.length, applications: applications.length, mappings: mappings.length, collisions: collisions.length, unmapped: unmapped.length, reports: artifacts.length, scoredReports: artifacts.length - invalidReports.length, invalidReports: invalidReports.length },
  };
}

export async function applyMigration(plan, databasePath) {
  if (plan.collisions.length || plan.unmapped.length) throw new Error('Migration has unresolved collisions or unmapped fields; resolve them before --apply');
  mkdirSync(dirname(databasePath), { recursive: true });
  const temporary = `${databasePath}.migration-${process.pid}.tmp`;
  if (existsSync(databasePath)) copyFileSync(databasePath, temporary);
  else rmSync(temporary, { force: true });
  const store = await openOpportunityStore(temporary);
  try {
    for (const row of [...plan.mappings].sort((a, b) => Number(Boolean(b.evaluation)) - Number(Boolean(a.evaluation)))) {
      const opportunity = store.ingest({ url: row.url, company: row.company, role: row.role, source: 'migration', payload: { migration: 'scan-history', artifacts: row.artifacts, applications: row.applications } });
      for (const observation of row.observations) store.recordScanObservation(opportunity.id, { url: row.url, company: row.company, title: row.role, observedOn: observation.observedOn });
      if (row.evaluation) {
        if (store.evaluation(opportunity.id)) continue;
        if (!store.claim(opportunity.id, 'migration')) throw new Error(`Cannot import scored report for ${row.url}`);
        store.recordEligibility(opportunity.id, { status: 'unknown', evidence: { migration: 'historical-review', gates: row.evaluation.gates } });
        store.recordEvaluation(opportunity.id, row.evaluation);
        for (const artifact of row.artifacts) store.recordArtifact(opportunity.id, { kind: 'report', path: artifact.path, sha256: artifact.sha256 });
      }
    }
  } finally { store.close(); }
  const backup = existsSync(databasePath) ? `${databasePath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}` : null;
  if (backup) {
    copyFileSync(databasePath, backup);
    if (sha256(databasePath) !== sha256(backup)) throw new Error('Migration backup verification failed');
  }
  renameSync(temporary, databasePath);
  return { database: databasePath, backup, imported: plan.mappings.length };
}

export function discardUnmapped(root, plan) {
  const scanUrls = new Set(plan.unmapped.filter(row => row.type === 'scan-metadata').map(row => row.url));
  const pipelineUrls = new Set(plan.unmapped.filter(row => row.type === 'pipeline-url').map(row => row.url));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const discard = (relativePath, urls) => {
    if (!urls.size) return null;
    const path = join(root, relativePath);
    const original = readFileSync(path, 'utf8');
    const backup = `${path}.cutover-${stamp}.bak`;
    copyFileSync(path, backup);
    if (sha256(path) !== sha256(backup)) throw new Error(`Backup verification failed: ${relativePath}`);
    const retained = original.split('\n').filter(line => !urls.has(line.split('\t')[0]) && ![...urls].some(url => line.includes(url))).join('\n');
    writeFileSync(path, retained);
    return { path: relativePath, backup: backup.slice(root.length + 1), removed: original.split('\n').length - retained.split('\n').length };
  };
  return [discard('data/scan-history.tsv', scanUrls), discard('data/pipeline.md', pipelineUrls)].filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const discard = args.includes('--discard-unmapped');
  const dbIndex = args.indexOf('--db');
  const database = resolve(ROOT, dbIndex === -1 ? 'data/opportunities.db' : args[dbIndex + 1] || '');
  if (dbIndex !== -1 && !args[dbIndex + 1]) throw new Error('--db requires a path');
  const plan = buildMigrationPlan();
  if (!apply) console.log(JSON.stringify(plan, null, 2));
  else {
    if (plan.unmapped.length && !discard) throw new Error('Migration has unmapped fields; rerun with --discard-unmapped only after review');
    const result = await applyMigration({ ...plan, unmapped: discard ? [] : plan.unmapped }, database);
    if (discard) result.discarded = discardUnmapped(ROOT, plan);
    console.log(JSON.stringify(result, null, 2));
  }
}
