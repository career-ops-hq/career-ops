/** Integration checks for Stage 0 persistence and scan's incomplete handoff. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runPrescreen } from '../prescreen.mjs';
import { persistScanPrescreens } from './fixtures/legacy-scan-helpers.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-prescreen-'));
const complete = {
  job: { url: 'https://example.com/jobs/pass' },
  complete_jd: true,
  assessment_complete: true,
  gates: { location: { status: 'pass' }, employment: { status: 'pass' }, compensation: { status: 'pass' }, company_size: { status: 'pass' } },
  years: { required: 3, verified: 3 },
  core_capabilities: [],
  credentials: [],
};

try {
  if (runPrescreen(complete, { cacheDir: root }).cache !== 'written') throw new Error('first complete result must write cache');
  if (runPrescreen(complete, { cacheDir: root }).cache !== 'reused') throw new Error('matching complete result must reuse cache');
  const [path] = persistScanPrescreens([{ url: 'https://example.com/jobs/listing', title: 'Engineer', company: 'Acme' }], { cacheRoot: root, candidateSourceHash: 'candidate' });
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.result.status !== 'incomplete' || record.input.complete_jd !== false) throw new Error('scan handoff must be explicitly incomplete');
  const inputPath = join(root, 'input.json');
  writeFileSync(inputPath, JSON.stringify(complete));
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../prescreen.mjs', import.meta.url)), '--input', inputPath, '--cache-dir', root], { encoding: 'utf8' });
  if (cli.status !== 0 || JSON.parse(cli.stdout).cache !== 'reused') throw new Error(`prescreen CLI failed: ${cli.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('prescreen-cache: ok');
