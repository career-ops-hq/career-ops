// A scheduled full sweep passes --resume-if-compatible when a checkpoint file
// is present. --resume refuses a different --ats list or a changed portals.yml
// and exits 1, which would repeat on every later run. The scheduled flag warns
// and starts a fresh sweep instead.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';

function childEnv(dir) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_PROFILE: '',
    CAREER_OPS_PORTALS: '',
    CAREER_OPS_PIPELINE: '',
    CAREER_OPS_SCAN_HISTORY: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0',
  };
}

function prepare(dir) {
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), JSON.stringify(['sandbox-co-0']), 'utf-8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n', 'utf-8');
  const fetched = join(dir, 'fetched.txt');
  writeFileSync(fetched, '', 'utf-8');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'greenhouse.mjs')).href)};
provider.fetchListing = undefined;
provider.fetch = async (entry) => {
  appendFileSync(${JSON.stringify(fetched)}, entry.name + '\\n');
  return [];
};
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`, 'utf-8');
  return { preload, fetched };
}

function writeCheckpoint(dir, body) {
  writeFileSync(join(dir, 'data', 'cache', 'ats-full-checkpoint.json'), JSON.stringify(body), 'utf-8');
}

function run(dir, preload, args) {
  return spawnSync(NODE, [
    '--import', pathToFileURL(preload).href,
    join(ROOT, 'scan-ats-full.mjs'),
    '--ats', 'greenhouse', '--limit', '1', '--since', '7', '--json',
    ...args,
  ], { cwd: dir, encoding: 'utf-8', timeout: 30_000, env: childEnv(dir) });
}

const baseCheckpoint = {
  version: 1,
  limit: 1,
  includeUndated: false,
  current: { name: 'greenhouse', resumeAt: 0, datasetLen: 1 },
};

function assertFresh(label, checkpoint, flag) {
  const dir = mkdtempSync(join(tmpdir(), 'ats-full-soft-resume-'));
  try {
    const { preload, fetched } = prepare(dir);
    writeCheckpoint(dir, checkpoint);
    const result = run(dir, preload, [flag]);
    const names = readFileSync(fetched, 'utf-8').split('\n').filter(Boolean);
    const warned = /Starting a fresh sweep/.test(result.stderr || '');
    const refused = /Error: checkpoint was written with different settings|changed since the checkpoint/.test(result.stderr || '');
    if (result.status === 0 && warned && !refused && names.includes('sandbox-co-0')) {
      pass(label);
    } else {
      fail(`${label}: status=${result.status} warned=${warned} refused=${refused} fetched=${names.join(',')}\n${(result.stderr || '').slice(-700)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

assertFresh(
  '--resume-if-compatible starts fresh when the checkpoint lists a different ATS',
  { ...baseCheckpoint, ats: ['lever'], current: { name: 'lever', resumeAt: 0, datasetLen: 1 } },
  '--resume-if-compatible',
);

assertFresh(
  '--resume-if-compatible starts fresh when portals.yml filters changed',
  { ...baseCheckpoint, ats: ['greenhouse'], filters: { title_filter: 'stale-fingerprint' } },
  '--resume-if-compatible',
);

assertFresh(
  '--resume-if-compatible starts fresh when the company list changed',
  {
    ...baseCheckpoint,
    ats: ['greenhouse'],
    current: { name: 'greenhouse', resumeAt: 0, datasetLen: 2, datasetHash: '0123456789abcdef' },
  },
  '--resume-if-compatible',
);

const matchDir = mkdtempSync(join(tmpdir(), 'ats-full-soft-match-'));
try {
  const { preload, fetched } = prepare(matchDir);
  writeCheckpoint(matchDir, {
    ...baseCheckpoint,
    ats: ['greenhouse'],
    current: { name: 'greenhouse', resumeAt: 1, datasetLen: 1 },
  });
  const matched = run(matchDir, preload, ['--resume-if-compatible']);
  const names = readFileSync(fetched, 'utf-8').split('\n').filter(Boolean);
  const resumed = /resuming at 1/.test(matched.stderr || '');
  const fresh = /Starting a fresh sweep/.test(matched.stderr || '');
  if (matched.status === 0 && resumed && !fresh && names.length === 0) {
    pass('--resume-if-compatible continues a checkpoint that matches this run');
  } else {
    fail(`matching checkpoint was not resumed: status=${matched.status} resumed=${resumed} fresh=${fresh} fetched=${names.join(',')}\n${(matched.stderr || '').slice(-700)}`);
  }
} finally {
  rmSync(matchDir, { recursive: true, force: true });
}

const datasetStrictDir = mkdtempSync(join(tmpdir(), 'ats-full-strict-dataset-'));
try {
  const { preload } = prepare(datasetStrictDir);
  writeCheckpoint(datasetStrictDir, {
    ...baseCheckpoint,
    ats: ['greenhouse'],
    current: { name: 'greenhouse', resumeAt: 0, datasetLen: 2, datasetHash: '0123456789abcdef' },
  });
  const refused = run(datasetStrictDir, preload, ['--resume']);
  if (refused.status === 1 && /company dataset changed since the checkpoint/.test(refused.stderr || '')) {
    pass('--resume still refuses a changed company list and exits 1');
  } else {
    fail(`--resume did not refuse a changed company list: status=${refused.status}\n${(refused.stderr || '').slice(-500)}`);
  }
} finally {
  rmSync(datasetStrictDir, { recursive: true, force: true });
}

const strictDir = mkdtempSync(join(tmpdir(), 'ats-full-strict-resume-'));
try {
  const { preload } = prepare(strictDir);
  writeCheckpoint(strictDir, { ...baseCheckpoint, ats: ['lever'], current: { name: 'lever', resumeAt: 0, datasetLen: 1 } });
  const refused = run(strictDir, preload, ['--resume']);
  if (refused.status === 1 && /different settings/.test(refused.stderr || '')) {
    pass('--resume still refuses a different ATS and exits 1');
  } else {
    fail(`--resume did not refuse: status=${refused.status}\n${(refused.stderr || '').slice(-500)}`);
  }
} finally {
  rmSync(strictDir, { recursive: true, force: true });
}
