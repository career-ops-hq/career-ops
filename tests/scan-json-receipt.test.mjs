import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { atomicWriteFile, isIgnorableDirectoryFsyncError, normalizeReceiptOffer } from '../scan.mjs';
import { formatLiveOfferLine } from '../scan-ats-full.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scan.mjs');

function workspace(portals) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-scan-receipt-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'portals.yml'), portals);
  writeFileSync(join(root, 'config', 'profile.yml'), '{}\n');
  return root;
}

function runJson(root, bootstrap) {
  return spawnSync(process.execPath, bootstrap ? ['--input-type=module', '-e', bootstrap] : [SCAN, '--dry-run', '--json'], {
    cwd: root,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_PORTALS: join(root, 'portals.yml'),
      CAREER_OPS_PROFILE: join(root, 'config', 'profile.yml'),
      CAREER_OPS_PIPELINE: join(root, 'data', 'pipeline.md'),
      CAREER_OPS_SCAN_HISTORY: join(root, 'data', 'scan-history.tsv'),
    },
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

test('atomicWriteFile replaces content without leaving a temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-atomic-'));
  try {
    const target = join(root, 'pipeline.md');
    writeFileSync(target, 'before\n');
    atomicWriteFile(target, 'after\n');
    assert.equal(readFileSync(target, 'utf-8'), 'after\n');
    assert.deepEqual(readdirSync(root), ['pipeline.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomicWriteFile preserves restrictive destination permissions', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-atomic-mode-'));
  try {
    const target = join(root, 'pipeline.md');
    writeFileSync(target, 'before\n');
    chmodSync(target, 0o600);
    atomicWriteFile(target, 'after\n');
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomicWriteFile preserves a destination symlink and replaces its target', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-atomic-symlink-'));
  try {
    const target = join(root, 'pipeline-target.md');
    const link = join(root, 'pipeline.md');
    writeFileSync(target, 'before\n');
    symlinkSync(target, link);
    atomicWriteFile(link, 'after\n');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(readFileSync(target, 'utf-8'), 'after\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('atomicWriteFile cannot be redirected through the old predictable temporary path', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-atomic-temp-link-'));
  try {
    const target = join(root, 'pipeline.md');
    const victim = join(root, 'victim.md');
    const predictableTemp = `${target}.tmp-${process.pid}`;
    writeFileSync(victim, 'untouched\n');
    symlinkSync(victim, predictableTemp);
    atomicWriteFile(target, 'pipeline\n');
    assert.equal(readFileSync(target, 'utf-8'), 'pipeline\n');
    assert.equal(readFileSync(victim, 'utf-8'), 'untouched\n');
    assert.equal(lstatSync(predictableTemp).isSymbolicLink(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only unsupported directory fsync errors are ignored on Windows', () => {
  assert.equal(isIgnorableDirectoryFsyncError({ code: 'EPERM' }, 'win32'), true);
  assert.equal(isIgnorableDirectoryFsyncError({ code: 'EACCES' }, 'win32'), true);
  assert.equal(isIgnorableDirectoryFsyncError({ code: 'EINVAL' }, 'linux'), true);
  assert.equal(isIgnorableDirectoryFsyncError({ code: 'EPERM' }, 'darwin'), false);
  assert.equal(isIgnorableDirectoryFsyncError({ code: 'ENOSPC' }, 'win32'), false);
});

test('normalizeReceiptOffer emits a date and preserves structured salary with missing location', () => {
  assert.deepEqual(normalizeReceiptOffer({
    company: 'Fixture Defense',
    title: 'Strategic Finance Manager',
    url: 'https://boards.example.com/fixture/1001',
    source: 'local-parser',
    postedAt: Date.parse('2026-07-15T23:30:00Z'),
    salary: { min: 125000, max: 150000, currency: 'USD' },
  }), {
    company: 'Fixture Defense',
    title: 'Strategic Finance Manager',
    location: '',
    postedAt: '2026-07-15',
    url: 'https://boards.example.com/fixture/1001',
    source: 'local-parser',
    salary: { min: 125000, max: 150000, currency: 'USD' },
  });
});

const metrics = { contractType: 'Permanent', hours: '40 h/semana', applicationDeadline: '2026-11-01', vacancyCount: 3, observedAt: '2026-10-08T12:00:00.000Z', availabilityEvidence: 'feed-seen', salary: { min: 24000, currency: 'EUR' }, sources: ['Employer', 'Greenhouse'] };
const metricJob = { company: 'Acme', title: 'Operador de Loja', url: 'https://acme.example/jobs/1', location: 'Lisboa', postedAt: Date.now(), ...metrics };

test('market receipt and ATS live event retain explicit metrics, without inventing publication dates', () => {
  for (const serialize of [normalizeReceiptOffer, job => JSON.parse(formatLiveOfferLine(job, 'greenhouse-full'))]) {
    const result = serialize({ ...metricJob, postedAt: undefined });
    for (const [key, value] of Object.entries(metrics)) assert.deepEqual(result[key], value, key);
    assert.ok(!result.postedAt);
    for (const vacancyCount of [-1, 0, 1.5, '3', NaN, Infinity]) {
      const invalid = serialize({ ...metricJob, vacancyCount, hours: ' ', contractType: '', applicationDeadline: ' ', observedAt: 'bad', availabilityEvidence: 'guess' });
      for (const key of ['vacancyCount', 'hours', 'contractType', 'applicationDeadline', 'observedAt', 'availabilityEvidence']) assert.equal(key in invalid, false, `${key}: ${vacancyCount}`);
    }
  }
});

test('actual market and ATS discovery passes stamp one observation time and preserve final metrics', () => {
  const root = workspace('tracked_companies: []\njob_boards:\n  - name: Acme\n    provider: greenhouse\n    careers_url: https://boards.greenhouse.io/acme\n');
  try {
    mkdirSync(join(root, 'data/cache/ats-companies'), { recursive: true });
    writeFileSync(join(root, 'data/cache/ats-companies/greenhouse.json'), '["acme"]');
    for (const scanner of ['scan.mjs', 'scan-ats-full.mjs']) {
      const started = Date.now();
      const script = join(ROOT, scanner);
      const bootstrap = `
        import greenhouse from ${JSON.stringify(new URL('../providers/greenhouse.mjs', import.meta.url).href)};
        greenhouse.fetch = async () => [${JSON.stringify(metricJob)}, { ...${JSON.stringify(metricJob)}, title:'Assistente de vendas', url:'https://acme.example/jobs/2', postedAt:null, vacancyCount:-2, contractType:' ' }];
        globalThis.fetch = () => { throw new Error('Network forbidden in fixture'); };
        process.argv = [process.execPath, ${JSON.stringify(script)}, '--dry-run', '--json', ${scanner === 'scan-ats-full.mjs' ? "'--ats', 'greenhouse', '--include-undated'," : ''}];
        await import(${JSON.stringify(new URL(`../${scanner}`, import.meta.url).href)});
      `;
      const result = runJson(root, bootstrap);
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.offers.length, 2, scanner);
      const [first, second] = receipt.offers;
      for (const key of ['contractType', 'hours', 'applicationDeadline', 'vacancyCount', 'availabilityEvidence', 'salary', 'sources']) assert.deepEqual(first[key], metrics[key], `${scanner} ${key}`);
      assert.ok(Date.parse(first.observedAt) >= started && Date.parse(first.observedAt) <= Date.now(), scanner);
      assert.equal(first.observedAt, second.observedAt);
      assert.ok(!second.postedAt);
      assert.equal('vacancyCount' in second, false);
      assert.equal('contractType' in second, false);
      if (scanner === 'scan-ats-full.mjs') {
        const live = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(event => event.kind === 'offer');
        assert.equal(live.length, 2);
        assert.equal(live[0].observedAt, first.observedAt);
        assert.equal(live[0].vacancyCount, 3);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--json includes local-parser offers during dry-run without creating pipeline or history', () => {
  const root = workspace([
    'tracked_companies:',
    '  - name: Fixture Defense',
    '    careers_url: https://boards.example.com/fixture',
    '    parser:',
    '      command: node',
    '      script: tests/fixtures/noc-board.mjs',
    'job_boards: []',
    '',
  ].join('\n'));
  try {
    const result = runJson(root);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.version, 'careerops.scan.receipt@1');
    assert.equal(receipt.added, 3);
    assert.deepEqual(receipt.offers.map(offer => offer.url), [
      'https://example.invalid/jobs/1',
      'https://example.invalid/jobs/2',
      'https://example.invalid/jobs/3',
    ]);
    assert.ok(receipt.offers.every(offer => offer.source === 'local-parser'));
    assert.equal(existsSync(join(root, 'data', 'pipeline.md')), false);
    assert.equal(existsSync(join(root, 'data', 'scan-history.tsv')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--json emits exactly one clean successful receipt', () => {
  const root = workspace('tracked_companies: []\njob_boards: []\n');
  try {
    const result = runJson(root);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.match(receipt.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(receipt, {
      version: 'careerops.scan.receipt@1',
      date: receipt.date,
      scanned: 0,
      skipped: 0,
      found: 0,
      filtered: 0,
      duplicates: 0,
      added: 0,
      added_urls: [],
      offers: [],
      errors: [],
      unverified_zero: [],
      dry_run: true,
    });
    assert.match(result.stderr, /Portal Scan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--json returns exit 2 and structured errors for a partial failure', () => {
  const root = workspace([
    'tracked_companies:',
    '  - name: Broken Co',
    '    provider: provider-that-does-not-exist',
    'job_boards: []',
    '',
  ].join('\n'));
  try {
    const result = runJson(root);
    assert.equal(result.status, 2, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.version, 'careerops.scan.receipt@1');
    assert.equal(receipt.dry_run, true);
    assert.deepEqual(receipt.errors, [{
      company: 'Broken Co',
      error: 'unknown provider: provider-that-does-not-exist',
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('incomplete Workday pagination keeps recovered offers and marks the market receipt partial', async t => {
  if (!existsSync(join(ROOT, 'web', 'src'))) return t.skip('web/ not present in this checkout — skipping the market receipt integration');
  const { parseMarketReceipt } = await import('../web/src/lib/core/market-merge.mjs');
  const board = { name: 'Auchan Portugal', provider: 'workday', enabled: true, careers_url: 'https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail' };
  const root = workspace(`job_boards:\n  - ${JSON.stringify(board)}\n`);
  const plan = { opportunityType: 'employment', markets: ['portugal'], jobBoards: [board], skippedSources: [], locationPolicy: { markets: ['portugal'], strict: true } };
  try {
    for (const [marker, diagnostic] of [
      [undefined, 'transient'], ['structural', 'structural'],
      ['secret=never-expose\n' + 'x'.repeat(1000), 'unknown'], [{ secret: 'never-expose' }, 'unknown'],
    ]) {
      const bootstrap = `
        import workday from ${JSON.stringify(new URL('../providers/workday.mjs', import.meta.url).href)};
        globalThis.fetch = () => { throw new Error('Network forbidden in fixture'); };
        const fetchWorkday = workday.fetch;
        workday.fetch = async (entry, ctx) => {
          const jobs = await fetchWorkday(entry, { ...ctx, sleep: async () => {}, fetchJson: async (_url, opts) => {
            if (JSON.parse(opts.body).offset > 0) throw Object.assign(new Error('fixture later page unavailable'), { status: 400 });
            return { total: 21, jobPostings: [{ title:'Operador/a de loja', externalPath:'/job/Lisboa/Operador_JR123', locationsText:'Lisboa, Portugal', postedOn:'Publicado hoje' }] };
          }});
          if (${marker !== undefined}) jobs.workdayTruncated = ${JSON.stringify(marker) ?? 'undefined'};
          return jobs;
        };
        process.argv = [process.execPath, ${JSON.stringify(SCAN)}, '--dry-run', '--json'];
        await import(${JSON.stringify(new URL('../scan.mjs', import.meta.url).href)});
      `;
      const result = runJson(root, bootstrap);
      const receipt = JSON.parse(result.stdout);
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual(receipt.errors, [{ company: 'Auchan Portugal', error: `workday: incomplete pagination (${diagnostic})` }]);
      assert.equal(receipt.offers.length, 1);
      assert.equal(receipt.offers[0].title, 'Operador/a de loja');
      assert.equal(receipt.offers[0].source, 'workday-api');
      const run = parseMarketReceipt(result.stdout, result.status, plan);
      assert.equal(run.status, 'partial');
      assert.equal(run.valid, true);
      assert.equal(run.sources[0].state, 'error');
      assert.equal(run.offers.length, 1);
      assert.equal(run.offers[0].url, 'https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail/job/Lisboa/Operador_JR123');
      assert.equal(existsSync(join(root, 'data', 'pipeline.md')), false);
      assert.equal(existsSync(join(root, 'data', 'scan-history.tsv')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a receipt larger than the pipe buffer drains completely', () => {
  const script = [
    `import { emitJsonReceipt } from ${JSON.stringify(new URL('../scan.mjs', import.meta.url).href)};`,
    "const added_urls = Array.from({ length: 20000 }, (_, i) => `https://example.invalid/very/long/job/posting/path/number/${i}`);",
    "emitJsonReceipt({ version: 'careerops.scan.receipt@1', added_urls }, 0);",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.added_urls.length, 20000);
  assert.ok(Buffer.byteLength(result.stdout) > 65536);
});

test('main Workday max_pages cap propagates provider truncation through receipt and stops the search ladder', async t => {
  if (!existsSync(join(ROOT, 'web', 'src'))) return t.skip('web/ not present');
  await import('../web/tests/helpers/web-ts-alias-loader.mjs');
  const { runDiscovery } = await import('../web/src/lib/core/scan.ts');
  const { parseMarketReceipt } = await import('../web/src/lib/core/market-merge.mjs');
  const board = { name: 'Auchan Portugal', provider: 'workday', enabled: true, max_pages: 1, careers_url: 'https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail' };
  const root = workspace(`job_boards:\n  - ${JSON.stringify(board)}\n`);
  try {
    const bootstrap = `
      import workday from ${JSON.stringify(new URL('../providers/workday.mjs', import.meta.url).href)};
      const fetchWorkday = workday.fetch;
      workday.fetch = async (entry, ctx) => {
        const jobs = await fetchWorkday(entry, { ...ctx, fetchJson:async () => ({ total:40, jobPostings:Array.from({length:20}, (_,i) => ({ title:'Sales Assistant', externalPath:'/job/Lisboa/Sales_JR'+i, locationsText:'Lisboa, Portugal', postedOn:'Publicado hoje' })) }) });
        if (jobs.workdayTruncated !== 'structural') throw new Error('main cap did not mark structural truncation');
        return jobs;
      };
      globalThis.fetch = () => { throw new Error('Network forbidden in fixture'); };
      process.argv = [process.execPath, ${JSON.stringify(SCAN)}, '--dry-run', '--json'];
      await import(${JSON.stringify(new URL('../scan.mjs', import.meta.url).href)});`;
    const result = runJson(root, bootstrap);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.offers.length, 20, result.stderr);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(receipt.errors, [{ company: board.name, error: 'workday: incomplete pagination (structural)' }]);
    const plan = { opportunityType:'employment', markets:['portugal'], jobBoards:[board], skippedSources:[], locationPolicy:{markets:['portugal'], strict:true} };
    const run = parseMarketReceipt(result.stdout, result.status, plan);
    assert.equal(run.status, 'partial');
    assert.equal(run.sources[0].state, 'error');
    assert.equal(run.offers.length, 20);
    // Even if every recovered offer is filtered out, this cannot certify zero.
    const phases = [];
    await runDiscovery({ opportunityType:'employment', positive:['Quantum Mechanic'], negative:[], allow:[], block:[], blockHard:[], alwaysAllow:[], sinceDays:7, ats:[], markets:['portugal'], limitPerAts:150 }, () => {}, async (search, emit) => {
      phases.push(search.phase);
      emit({ kind:'summary', companiesScanned:run.scanned, unreachable:0, matches:0, status:run.status, sources:run.sources });
      return [];
    });
    assert.deepEqual(phases, ['precise']);
  } finally { rmSync(root, { recursive:true, force:true }); }
});
