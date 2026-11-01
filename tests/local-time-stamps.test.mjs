// tests/local-time-stamps.test.mjs — the two remaining writers that stamp a
// record with the UTC clock now use the local one.
//
//   agent-inbox.mjs        `- [ ] <stamp> — <request>`: the stamp was
//                          toISOString().slice(0, 16), i.e. UTC date AND time
//                          with no zone marker. At UTC+14 a request queued at
//                          10:30 on the 18th was recorded as "2026-08-17 20:30".
//   plugins/apify          the `scraped:` date in a saved JD's frontmatter was
//                          the UTC day, one day behind for the first hours of a
//                          local morning east of Greenwich.
//
// Every other "today" in the repo already goes through lib/local-today.mjs
// (#2765, #2932, #3070, #3301, #3990). These two were missed because they stamp
// rather than gate.
//
// PINNED INSTANT in a zone far from UTC: Pacific/Kiritimati is UTC+14, so
// 20:30Z on the 17th is 10:30 on the 18th there, and no two readings of the
// clock can agree by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TZ = 'Pacific/Kiritimati';
const INSTANT = '2026-08-17T20:30:00Z';
const LOCAL_DAY = '2026-08-18';
const LOCAL_STAMP = '2026-08-18 10:30';
const UTC_DAY = '2026-08-17';

// Replace Date so `new Date()` and Date.now() return INSTANT; dated
// constructions are untouched.
const FREEZE = `
const RealDate = Date;
const FROZEN = new RealDate('${INSTANT}').getTime();
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN); else super(...a); }
  static now() { return FROZEN; }
};
`;

test('premise: at this instant the UTC day and the local day differ in Kiritimati', () => {
  const day = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(INSTANT));
  assert.equal(day('UTC'), UTC_DAY);
  assert.equal(day(TZ), LOCAL_DAY);
});

test('agent-inbox add stamps the local date and time, not UTC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-stamp-'));
  try {
    const preload = join(dir, 'freeze.mjs');
    writeFileSync(preload, FREEZE);
    const inbox = join(dir, 'agent-inbox.md');
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'agent-inbox.mjs'), 'add', 'evaluate https://acme.example/jobs/42'], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, TZ, CAREER_OPS_INBOX: inbox },
    });
    assert.equal(r.status, 0, r.stderr);
    const line = readFileSync(inbox, 'utf-8').split('\n').find((l) => l.startsWith('- [ ]'));
    assert.ok(line, 'no queued item was written');
    assert.ok(line.startsWith(`- [ ] ${LOCAL_STAMP} — `), `stamp was not the local time: ${line}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apify JD frontmatter dates the capture with the local day, not UTC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apify-stamp-'));
  const RealDate = Date;
  const realFetch = globalThis.fetch;
  const realTz = process.env.TZ;
  try {
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/acts/owner~actor/runs')) return json({ data: { id: 'run-1' } });
      if (u.endsWith('/actor-runs/run-1')) return json({ data: { status: 'SUCCEEDED' } });
      if (u.endsWith('/actor-runs/run-1/dataset/items')) {
        return json([{ title: 'Data Engineer', url: 'https://jobs.example.test/1', company: 'Acme', description: 'Build and run the data platform. '.repeat(4) }]);
      }
      throw new Error(`unexpected request in test: ${u}`);
    };
    const { default: apify } = await import('../plugins/apify/index.mjs');
    process.env.TZ = TZ;
    const frozen = new RealDate(INSTANT).getTime();
    globalThis.Date = class extends RealDate {
      constructor(...a) { if (a.length === 0) super(frozen); else super(...a); }
      static now() { return frozen; }
    };
    const entry = { name: 'fixture', actor: 'owner/actor', field_map: { title: 'title', url: 'url', company: 'company', description: 'description' } };
    await apify.provider.fetch(entry, { env: { APIFY_TOKEN: 'test-token' }, dataRoot: dir });
    globalThis.Date = RealDate;

    const jds = join(dir, 'jds');
    assert.ok(existsSync(jds), 'no JD capture was written');
    const [file] = readdirSync(jds);
    const front = readFileSync(join(jds, file), 'utf-8').split('---')[1];
    assert.match(front, new RegExp(`scraped: '?${LOCAL_DAY}'?`), `scraped was not the local day:\n${front}`);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
    if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    rmSync(dir, { recursive: true, force: true });
  }
});
