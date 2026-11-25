// tests/scan-ats-full-resume-no-duplicates.test.mjs — resuming a sweep the
// resolver breaker stopped does not save its matches a second time.
//
// When the DNS circuit breaker trips, scan-ats-full checkpoints the matches
// found so far (`offers: newOffers`) and keeps the checkpoint so --resume can
// finish the unfinished source (#2283). The run then still reaches its persist
// step and appends those same matches to pipeline.md and scan-history.tsv. A
// resumed run seeded newOffers straight from checkpoint.offers, so at its own
// persist step it appended every one of them again: each match the stopped
// run had found sat twice in Pending, with two `added` history rows.
//
// Driven end to end: the greenhouse provider is stubbed so the first five
// boards each return a matching posting and every other board fails with a
// resolver error (EAI_AGAIN behind `fetch failed`, as Node reports it), which
// trips the breaker with five matches in hand. The resume run's boards return
// nothing new. No network is involved; a real request fails the run.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const COMPANIES = 120; // above the 50-failure breaker, below the 500-board periodic checkpoint
const MATCHING = 5;

const dir = mkdtempSync(join(tmpdir(), 'ats-full-resume-dup-'));
try {
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'),
    JSON.stringify(Array.from({ length: COMPANIES }, (_, i) => `sandbox-co-${i}`)), 'utf-8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n', 'utf-8');

  // A --import preload, so scan-ats-full.mjs runs as the entry point itself and
  // its main-module guard needs no argv[1] rewrite (main-guard-convention).
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, `
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'greenhouse.mjs')).href)};
provider.fetchListing = undefined;
provider.fetch = async (entry) => {
  const n = Number(String(entry.name).replace('sandbox-co-', ''));
  if (process.env.STUB_MODE === 'outage') {
    if (n < ${MATCHING}) {
      return [{ title: 'Director of Engineering', url: 'https://job-boards.greenhouse.io/' + entry.name + '/jobs/' + (1000 + n),
        company: entry.name, location: 'Remote', postedAt: Date.now(), description: '' }];
    }
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('getaddrinfo EAI_AGAIN boards-api.greenhouse.io'), { code: 'EAI_AGAIN' });
    throw err;
  }
  return [];
};
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`, 'utf-8');

  const sweep = (mode, extra = []) => spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan-ats-full.mjs'), '--ats', 'greenhouse', '--json', ...extra], {
    cwd: dir, encoding: 'utf-8', timeout: 120_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', STUB_MODE: mode, CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' },
  });
  const pending = () => readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8')
    .split('\n').filter((l) => /^- \[ \] https:\/\/job-boards\.greenhouse\.io\//.test(l));
  const addedRows = () => {
    const p = join(dir, 'data', 'scan-history.tsv');
    return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter((l) => l.split('\t')[5] === 'added') : [];
  };

  console.log('\nscan-ats-full — resuming an outage stop saves each match once');

  const stopped = sweep('outage');
  const checkpoint = join(dir, 'data', 'cache', 'ats-full-checkpoint.json');
  if (existsSync(checkpoint) && pending().length === MATCHING && addedRows().length === MATCHING) {
    pass(`premise: the breaker stopped the sweep with ${MATCHING} matches saved and its checkpoint kept`);
  } else {
    fail(`premise: checkpoint=${existsSync(checkpoint)} pending=${pending().length} added=${addedRows().length} (status ${stopped.status})\n${stopped.stderr.slice(-800)}`);
  }

  const resumed = sweep('clean', ['--resume']);
  const lines = pending();
  const unique = new Set(lines);
  if (resumed.status === 0 && lines.length === MATCHING && unique.size === MATCHING && addedRows().length === MATCHING) {
    pass('--resume after an outage stop leaves each match once in pipeline.md and scan-history');
  } else {
    fail(`after --resume: status=${resumed.status} pending=${lines.length} (unique ${unique.size}) added=${addedRows().length}, want ${MATCHING} each\n${resumed.stderr.slice(-800)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
