#!/usr/bin/env node
// Inventories and, only when lossless, imports legacy discovery records into SQLite.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { parseScanHistory } from './detect-reposts.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { openOpportunityStore } from './src/opportunities/store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const urlFromPipeline = text => [...text.matchAll(/https?:\/\/[^\s|]+/g)].map(match => match[0]);

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
  const byIdentity = new Map();
  for (const row of mappings) {
    const key = `${row.company}\u0000${row.role}`;
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), row]);
  }
  const artifacts = [];
  for (const name of existsSync(reportsPath) ? readdirSync(reportsPath).filter(name => name.endsWith('.md')).sort() : []) {
    const path = join(reportsPath, name);
    files.push(path);
    const match = readFileSync(path, 'utf8').match(/## Machine Summary\s*\n\s*```yaml\s*\n([\s\S]*?)\n```/);
    const summary = match ? yaml.load(match[1]) : null;
    const key = summary?.company && summary?.role ? `${summary.company}\u0000${summary.role}` : null;
    const targets = key ? byIdentity.get(key) ?? [] : [];
    if (targets.length === 0) unmapped.push({ type: 'report', path: `reports/${name}`, missing: ['exact URL mapping'] });
    else if (targets.length > 1) collisions.push({ type: 'report-identity-conflict', path: `reports/${name}`, urls: targets.map(target => target.url) });
    else artifacts.push({ url: targets[0].url, path: `reports/${name}`, sha256: sha256(path) });
  }
  const groupedArtifacts = new Map();
  for (const artifact of artifacts) groupedArtifacts.set(artifact.url, [...(groupedArtifacts.get(artifact.url) ?? []), artifact]);
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
    summary: { scanRecords: scanRows.length, applications: applications.length, mappings: mappings.length, collisions: collisions.length, unmapped: unmapped.length, reports: artifacts.length },
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
    for (const row of plan.mappings) {
      const opportunity = store.ingest({ url: row.url, company: row.company, role: row.role, source: 'migration', payload: { migration: 'scan-history', artifacts: row.artifacts, applications: row.applications } });
      for (const observation of row.observations) store.recordScanObservation(opportunity.id, { url: row.url, company: row.company, title: row.role, observedOn: observation.observedOn });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dbIndex = args.indexOf('--db');
  const database = resolve(ROOT, dbIndex === -1 ? 'data/opportunities.db' : args[dbIndex + 1] || '');
  if (dbIndex !== -1 && !args[dbIndex + 1]) throw new Error('--db requires a path');
  const plan = buildMigrationPlan();
  if (!apply) console.log(JSON.stringify(plan, null, 2));
  else console.log(JSON.stringify(await applyMigration(plan, database), null, 2));
}
