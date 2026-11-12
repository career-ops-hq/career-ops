// tests/scan-ats-full-workable-resume.test.mjs — --resume and the Workable
// source: a checkpoint that lists the source as complete must not download the
// feed again (its status and size come from the checkpoint), and a checkpoint
// that stopped inside the source must run it again from the first employer,
// not from the saved offset, because the feed is rebuilt between runs.
//
// Driven end-to-end in a child process against a sandbox data root, with a
// stubbed dns.lookup that records every hostname and fails it, so no network
// is used and any attempt to reach the feed host is visible. Where the feed is
// needed, it is read from the copy kept in the cache directory, as a run does
// when the request fails before any of the feed arrived.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, run, formatRunFailure, NODE, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — --resume and the Workable feed source');

const scanUrl = pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href;

/** A sandbox data root with a portals.yml and a launcher that fails every DNS lookup. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-workable-resume-'));
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - engineer\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  const lookups = join(dir, 'lookups.txt');
  writeFileSync(join(dir, 'launch.mjs'), `
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
dns.lookup = (hostname, options, callback) => {
  const cb = typeof options === 'function' ? options : callback;
  appendFileSync(${JSON.stringify(lookups)}, hostname + '\\n');
  const err = new Error('getaddrinfo ENOTFOUND ' + hostname);
  err.code = 'ENOTFOUND';
  err.syscall = 'getaddrinfo';
  err.hostname = hostname;
  process.nextTick(cb, err);
};
process.argv[1] = ${JSON.stringify(join(ROOT, 'scan-ats-full.mjs'))};
await import(${JSON.stringify(scanUrl)});
`, 'utf-8');
  return { dir, lookups };
}

function writeCheckpoint(dir, fields) {
  writeFileSync(join(dir, 'data', 'cache', 'ats-full-checkpoint.json'), JSON.stringify({
    version: 1,
    cutoffMs: Date.now() - 3 * 86_400_000,
    ats: ['workable'],
    limit: null,
    includeUndated: false,
    offers: [],
    counters: {},
    savedAt: new Date().toISOString(),
    ...fields,
  }), 'utf-8');
}

function resume(dir) {
  const out = run(NODE, [join(dir, 'launch.mjs'), '--ats', 'workable', '--json', '--resume', '--dry-run'], {
    cwd: dir,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' },
    timeout: 120_000,
  });
  if (out === null) return null;
  try { return JSON.parse(out); } catch { return { unparsed: out }; }
}

// A run that finished the workable source and then stopped.
{
  const { dir, lookups } = sandbox();
  try {
    writeCheckpoint(dir, {
      completedSources: ['workable'],
      datasets: { workable: { status: 'ok', available: 55 } },
      current: null,
    });
    const json = resume(dir);
    if (json === null) {
      fail(`resumed run did not complete${formatRunFailure()}`);
    } else {
      const asked = existsSync(lookups) ? readFileSync(lookups, 'utf-8').split('\n').filter(Boolean) : [];
      if (!asked.some((h) => h === 'workable.com' || h.endsWith('.workable.com'))) pass('the finished Workable source is not downloaded again on --resume');
      else fail(`the resumed run looked up ${asked.join(', ')}`);
      if (json?.datasetStatus?.workable === 'ok' && json.companiesAvailable === 55) {
        pass('its status and size in the report come from the checkpoint');
      } else {
        fail(`report wrong: ${JSON.stringify({ datasetStatus: json?.datasetStatus, companiesAvailable: json?.companiesAvailable })}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A run that stopped inside the workable source, at a nonzero offset. The
// rebuilt feed has its only match at the first employer, below that offset.
{
  const { dir } = sandbox();
  try {
    const date = new Date(Date.now() - 86_400_000).toUTCString();
    const job = (company, title, code) => `<job><title><![CDATA[${title}]]></title><date><![CDATA[${date}]]></date>`
      + `<url><![CDATA[https://apply.workable.com/j/${code}]]></url><company><![CDATA[${company}]]></company>`
      + '<city><![CDATA[Berlin]]></city><country><![CDATA[DE]]></country><remote><![CDATA[false]]></remote>'
      + '<description><![CDATA[<p>Test it.</p>]]></description></job>';
    const feed = `<?xml version="1.0" encoding="UTF-8"?><source>${[
      job('A Corp', 'QA Engineer', 'RESUME1'),
      job('B Corp', 'Office Manager', 'RESUME2'),
      job('C Corp', 'Office Manager', 'RESUME3'),
      job('D Corp', 'Office Manager', 'RESUME4'),
      job('E Corp', 'Office Manager', 'RESUME5'),
    ].join('')}</source>`;
    writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'workable.xml.gz'), gzipSync(feed));
    writeCheckpoint(dir, {
      completedSources: [],
      datasets: {},
      current: { name: 'workable', resumeAt: 3, datasetLen: 5 },
    });
    const json = resume(dir);
    if (json === null) {
      fail(`resumed run did not complete${formatRunFailure()}`);
    } else {
      const expectedUrl = 'https://apply.workable.com/j/RESUME1';
      if ((json?.offers ?? []).some((o) => o.url === expectedUrl)) {
        pass('an interrupted Workable source runs again from the first employer, not from the saved offset');
      } else {
        fail(`the match below the saved offset was not processed: ${JSON.stringify(json?.offers ?? json)}`);
      }
      if (json?.datasetStatus?.workable === 'stale' && json.companiesScanned === 5) {
        pass('every employer of the rebuilt feed is scanned, read from the kept copy');
      } else {
        fail(`report wrong: ${JSON.stringify({ datasetStatus: json?.datasetStatus, companiesScanned: json?.companiesScanned })}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
