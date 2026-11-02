// tests/admission-gate.test.mjs — one admission decision for every
// data/pipeline.md writer that is not scan.mjs (#5478).
//
// scan-hn, scan-interamt, openrouter-runner and plugin ingest each built their
// own subset of scan.mjs's gate: none read data/blacklist.md, scan-interamt kept
// a substring title matcher, scan-hn's AI mode checked no keyword at all, and
// openrouter and plugins compared raw URLs or the pipeline alone. These tests
// pin the shared gate's verdicts, that each writer uses it, and openrouter's
// pipeline row marking.
//
// Run:  node --test tests/admission-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAdmissionGate, formatSkipCounts } from '../lib/admission-gate.mjs';
import { parseBlacklist, collectSeenUrls } from '../scan.mjs';
import { admitPluginJobs } from '../plugins.mjs';
import { validateManifest } from '../plugins/_engine.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const BLACKLIST = parseBlacklist([
  '| Company | Since | Scope | Reason |',
  '|---|---|---|---|',
  '| Initech | 2026-01-01 | | bad interview |',
  '| hooli.example | 2026-01-01 | domain | |',
].join('\n'));

// The title_filter shapes the template and German users actually carry.
const CONFIG = {
  title_filter: {
    positive: ['KI', 'AI', 'Softwareentwickler', 'director + engineering'],
    negative: ['word:Intern', 'iOS'],
  },
  location_filter: { allow: ['Berlin'], block_hard: ['Brazil'] },
};

function gate(extra = {}) {
  return createAdmissionGate({ config: CONFIG, blacklist: BLACKLIST, seen: new Set(), ...extra });
}

let nextId = 0;
const offer = (title, extra = {}) => ({ url: `https://jobs.example/${++nextId}`, company: 'Acme', title, location: 'Berlin', ...extra });

test('the title filter is the shared compiled matcher, not a substring test', () => {
  const g = gate();
  // Each of these went the other way under scan-interamt's private includes() matcher.
  assert.equal(g.check(offer('Erzieher (m/w/d) Kita')), 'title', '"KI" must not match inside "Kita"');
  assert.equal(g.check(offer('Sachbearbeiter Bauamt Mainz')), 'title', '"AI" must not match inside "Mainz"');
  assert.equal(g.check(offer('Softwareentwickler Intern')), 'title', 'word:Intern is a word match, not literal text');
  assert.equal(g.check(offer('Director of Engineering')), null, 'an AND group matches');
  assert.equal(g.check(offer('KI-Referent Biosamples')), null, '"iOS" must not match inside "Biosamples"');
});

test('the blacklist applies by company name and by domain', () => {
  const g = gate();
  assert.equal(g.check(offer('AI Engineer', { company: 'Initech' })), 'blacklisted');
  assert.equal(g.check(offer('AI Engineer', { company: 'Somebody', url: 'https://careers.hooli.example/1' })), 'blacklisted');
  assert.equal(g.check(offer('AI Engineer', { company: 'Initrode' })), null);
});

test('the location filter is the shared one, block_hard included', () => {
  const g = gate();
  assert.equal(g.check(offer('AI Engineer', { location: 'Munich' })), 'location');
  assert.equal(g.check(offer('AI Engineer', { location: 'Berlin, Brazil' })), 'location', 'block_hard beats allow');
  assert.equal(g.check(offer('AI Lead', { location: '' })), null, 'a missing location is not penalized');
});

test('the seen set compares normalized URLs and covers the tracker', () => {
  const { seen } = collectSeenUrls({
    applicationsText: '| # | Company | Role | URL |\n|---|---|---|---|\n| 1 | Acme | AI Engineer | https://jobs.example/acme/42 |\n',
  });
  const g = gate({ seen });
  assert.equal(g.check(offer('AI Engineer', { url: 'https://jobs.example/Acme/42/?utm_source=alert' })), 'seen');
  const first = offer('AI Researcher', { url: 'https://jobs.example/acme/77' });
  assert.equal(g.check(first), null);
  assert.equal(g.check({ ...first }), 'seen', 'a second copy in the same run is a duplicate');
});

test('partition and counts report every reason', () => {
  const g = gate();
  const kept = offer('AI Engineer');
  const { admitted, skipped } = g.partition([
    kept,
    offer('AI Engineer', { company: 'Initech' }),
    offer('Gardener'),
    offer('AI Engineer', { location: 'Munich' }),
    { ...kept },
  ]);
  assert.equal(admitted.length, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length])), { seen: 1, blacklisted: 1, title: 1, location: 1 });
  assert.deepEqual(g.counts, { admitted: 1, seen: 1, blacklisted: 1, title: 1, location: 1 });
  assert.equal(formatSkipCounts(g.counts), '1 already seen, 1 blacklisted, 1 title filter, 1 location filter');
});

test('titleText lets a caller judge a different string than the stored title', () => {
  const g = gate();
  assert.equal(g.check(offer('Backend Engineer'), { titleText: 'Acme | AI Engineer | Berlin' }), null);
});

// Plugin ingest returns more than job postings: google-calendar and
// outlook-interviews return interview events titled "Interview with Acme".
// Only a plugin that declares jobPostings gets the discovery filters; every
// plugin gets the tracker/pipeline/scan-history dedup.
test('plugin results get the discovery filters only when the manifest declares jobPostings', () => {
  const tracked = collectSeenUrls({
    applicationsText: '| # | Company | Role | URL |\n|---|---|---|---|\n| 1 | Acme | AI Engineer | https://jobs.example/acme/42 |\n',
  }).seen;
  const found = [
    { title: 'Interview with Initech', url: 'https://meet.example/abc', company: 'Initech' },
    { title: 'Gardener', url: 'https://jobs.example/garden/1', company: 'Acme', location: 'Munich' },
    { title: 'AI Engineer', url: 'https://jobs.example/acme/42?utm_source=alert', company: 'Acme' },
  ];
  const run = (jobPostings) => admitPluginJobs(found.map(j => ({ ...j })), {
    id: 'demo', jobPostings, config: CONFIG,
    // The blacklist is injected only where it applies, so the user's own file is never read.
    gateOptions: jobPostings ? { blacklist: BLACKLIST, seen: new Set(tracked) } : { seen: new Set(tracked) },
  });

  const events = run(false);
  assert.deepEqual(events.jobs.map(j => j.url), ['https://meet.example/abc', 'https://jobs.example/garden/1']);
  assert.equal(events.counts.seen, 1, 'the tracked posting is dropped for every plugin');
  assert.equal(events.jobs[0].source, 'plugin:demo');

  const postings = run(true);
  assert.deepEqual(postings.jobs, []);
  assert.deepEqual(postings.counts, { admitted: 0, seen: 1, blacklisted: 1, title: 1, location: 0 });
});

test('the manifest jobPostings flag is validated and carried through', () => {
  const base = { id: 'demo', apiVersion: 1, description: 'Demo.', humanInTheLoop: true, hooks: ['ingest'] };
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-manifest-'));
  try {
    assert.equal(validateManifest({ ...base, jobPostings: true }, dir, 'demo').jobPostings, true);
    assert.equal(validateManifest(base, dir, 'demo').jobPostings, false);
    assert.equal(validateManifest({ ...base, jobPostings: 'yes' }, dir, 'demo'), null);
    const gmail = JSON.parse(readFileSync(join(ROOT, 'plugins', 'gmail', 'manifest.json'), 'utf8'));
    assert.equal(gmail.jobPostings, true, 'the bundled gmail job-lead ingest opts in');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A structural guard: a writer that drops the gate for a private matcher again
// would bring back the drift this file exists to prevent.
test('every non-scan.mjs pipeline writer admits through the shared gate', () => {
  for (const file of ['scan-hn.mjs', 'scan-interamt.mjs', 'openrouter-runner.mjs', 'plugins.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /from '\.\/lib\/admission-gate\.mjs'/, `${file} does not import the admission gate`);
    assert.match(src, /createAdmissionGate\(/, `${file} does not build the admission gate`);
  }
  const interamt = readFileSync(join(ROOT, 'scan-interamt.mjs'), 'utf8');
  assert.doesNotMatch(interamt, /function matches(Title|Location)\(/, 'scan-interamt brought back a private matcher');
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-admission-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  return dir;
}

function runModule(dir, code) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' };
  for (const n of ['CAREER_OPS_PORTALS', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_TRACKER', 'CAREER_OPS_MODEL']) delete env[n];
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8', timeout: 30000, env });
}

test('openrouter-runner scan skips tracked, blacklisted and out-of-region postings', () => {
  const dir = tempRoot();
  try {
    writeFileSync(join(dir, 'data', 'blacklist.md'), '| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Initech | 2026-01-01 | | |\n');
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
      '|---|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-01 | Acme | AI Engineer | 4.0/5 | Applied | ❌ | — | — | https://boards.example/acme/1 |',
      '',
    ].join('\n'));
    const entries = [
      { url: 'https://boards.example/acme/1?utm_source=x', company: 'Acme', role: 'AI Engineer', location: 'Berlin' },
      { url: 'https://boards.example/initech/2', company: 'Initech', role: 'AI Engineer', location: 'Berlin' },
      { url: 'https://boards.example/acme/3', company: 'Acme', role: 'AI Engineer', location: 'Munich' },
      { url: 'https://boards.example/acme/4', company: 'Acme', role: 'AI Lead', location: 'Berlin' },
    ];
    const runner = pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href;
    const r = runModule(dir, `
      const { addToPipeline } = await import(${JSON.stringify(runner)});
      const added = await addToPipeline(${JSON.stringify(entries)}, { location_filter: { allow: ['Berlin'] } });
      console.log('ADDED=' + added);
    `);
    assert.equal(r.status, 0, `child failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /ADDED=1\b/);
    assert.match(r.stdout, /Skipped: 1 already seen, 1 blacklisted, 1 location filter/);
    const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    assert.deepEqual(pipeline.match(/^- \[ \] \S+/gm), ['- [ ] https://boards.example/acme/4']);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('openrouter-runner marks the row whose URL matches exactly, not a prefix of another', () => {
  const dir = tempRoot();
  try {
    const pipelinePath = join(dir, 'data', 'pipeline.md');
    writeFileSync(pipelinePath, [
      '# Pipeline',
      '',
      '## Pending',
      '',
      '- [ ] https://x.test/jobs/12 | A | Role',
      '- [ ] https://x.test/jobs/1 | B | Role',
      '- [ ] https://x.test/jobs/1?gh_jid=9 | C | Role',
      '',
    ].join('\n'));
    const runner = pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href;
    const r = runModule(dir, `
      const { markPipelineDone } = await import(${JSON.stringify(runner)});
      await markPipelineDone('https://x.test/jobs/1', { pipelinePath: ${JSON.stringify(pipelinePath)} });
      await markPipelineDone('https://x.test/jobs/404', { pipelinePath: ${JSON.stringify(pipelinePath)} });
    `);
    assert.equal(r.status, 0, `child failed:\n${r.stdout}\n${r.stderr}`);
    const lines = readFileSync(pipelinePath, 'utf8').split('\n').filter(l => l.startsWith('- ['));
    assert.deepEqual(lines, [
      '- [ ] https://x.test/jobs/12 | A | Role',
      '- [x] https://x.test/jobs/1 | B | Role',
      '- [ ] https://x.test/jobs/1?gh_jid=9 | C | Role',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
