#!/usr/bin/env node

/**
 * sync-application-tracker.mjs — Bi-Directional Centralized Application Tracker Sync
 *
 * Syncs application statuses across ApplyPilot, remote-job-pipeline, and career-ops/data/tracker.tsv.
 *
 * Usage:
 *   node sync-application-tracker.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKER_TSV = resolve(__dirname, 'data', 'tracker.tsv');
const PIPELINE_AUDIT = resolve(__dirname, '..', 'remote-job-pipeline', 'data', 'latest_applications_audit.json');

export function syncApplicationStatus() {
  let trackerContent = '';
  if (existsSync(TRACKER_TSV)) {
    trackerContent = readFileSync(TRACKER_TSV, 'utf8');
  }

  let pipelineJobs = [];
  if (existsSync(PIPELINE_AUDIT)) {
    try {
      const data = JSON.parse(readFileSync(PIPELINE_AUDIT, 'utf8'));
      pipelineJobs = Array.isArray(data) ? data : (data.jobs || []);
    } catch (_) {}
  }

  const existingLines = trackerContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const header = '# company\trole\tstatus\tapplied_date\turl\tnotes';

  const rows = existingLines.map(line => {
    const parts = line.split('\t');
    return {
      company: parts[0] || '',
      role: parts[1] || '',
      status: parts[2] || 'SUBMITTED',
      applied_date: parts[3] || new Date().toISOString().split('T')[0],
      url: parts[4] || '',
      notes: parts[5] || ''
    };
  });

  let syncedCount = 0;
  for (const pJob of pipelineJobs) {
    const company = pJob.Company || pJob.company;
    const role = pJob.Role || pJob.role;
    if (!company) continue;

    const exists = rows.find(r => r.company.toLowerCase() === company.toLowerCase());
    if (!exists) {
      rows.push({
        company,
        role: role || 'Software Role',
        status: pJob.Status || 'SUBMITTED',
        applied_date: new Date().toISOString().split('T')[0],
        url: pJob['Apply URL'] || pJob.url || '',
        notes: 'Synced from remote-job-pipeline'
      });
      syncedCount++;
    }
  }

  const outLines = [header, ...rows.map(r => `${r.company}\t${r.role}\t${r.status}\t${r.applied_date}\t${r.url}\t${r.notes}`)];
  mkdirSync(dirname(TRACKER_TSV), { recursive: true });
  writeFileSync(TRACKER_TSV, outLines.join('\n'), 'utf8');

  return { totalRows: rows.length, syncedCount };
}

if (process.argv[1] && process.argv[1].endsWith('sync-application-tracker.mjs')) {
  const result = syncApplicationStatus();
  console.log(`✅ Centralized Application Tracker Sync completed.`);
  console.log(`📊 Synced ${result.syncedCount} new application(s) into data/tracker.tsv (Total: ${result.totalRows})`);
}
