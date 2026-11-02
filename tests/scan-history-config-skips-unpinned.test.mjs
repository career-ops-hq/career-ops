// tests/scan-history-config-skips-unpinned.test.mjs — a scan-history row that
// records a CONFIG cut never pins its URL, whichever scanner wrote it.
//
// shouldDedupScanHistoryRow() keeps `skipped_title`, `skipped_location` and
// `skipped_age` out of dedup because each names a setting the user edits: a
// row written under the old setting must not suppress the posting once the
// setting moves. scan-dayforce.mjs writes three more rows of exactly that kind,
// `skipped_content`, `skipped_visa` and `skipped_country_eligibility`, but they
// were in none of the status sets, and an unknown status falls through to the
// permanent pin. So widening `content_filter` never handed back a Dayforce
// posting it had once dropped.
//
// The census below reads every literal status any scanner passes to
// appendToScanHistory() and asks the dedup rules what they do with it. A
// status that pins a URL for good must be listed here with its reason, so the
// next scanner that invents a status cannot pin by accident.
import { pass, fail, ROOT, codeMask } from './helpers.mjs';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { trackedFiles } from '../lib/mjs-files.mjs';
import { collectSeenUrls, shouldDedupScanHistoryRow } from '../scan.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const CONFIG_SKIPS = ['skipped_content', 'skipped_visa', 'skipped_country_eligibility'];

// Statuses that deliberately keep a URL seen for good. Shrink-only: each entry
// must still be written somewhere (checked below), and a new one needs a reason.
const DELIBERATE_PINS = new Map([
  ['skipped_dup', 'restates a URL already seen, in this run or in history'],
  ['skipped_date', "scan-interamt's incremental cut: published before its last scan, which covered it"],
]);

/** True when a row with this status keeps its URL seen however old it is. */
const pinsForGood = (status) =>
  shouldDedupScanHistoryRow({ firstSeen: '2020-01-01', status }, { recheckAfterDays: 1, today: '2099-01-01' });

console.log('\nscan history — a config cut never pins its URL');

ok('the three Dayforce config cuts carry no dedup weight', () => {
  const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
  const rows = CONFIG_SKIPS.map((status, i) =>
    `https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/${1000 + i}\t2026-01-01\tdayforce\tEngineer\tAcme\t${status}\t`);
  const { seen } = collectSeenUrls({ scanHistoryText: [HEADER, ...rows, ''].join('\n') });
  assert.strictEqual(seen.size, 0, `pinned: ${[...seen].join(', ')}`);
  for (const status of CONFIG_SKIPS) assert.strictEqual(pinsForGood(status), false, status);
});

ok('premise: a status the rules do not know still pins for good', () => {
  // That fall-through is what the Dayforce statuses hit, and what the census guards.
  assert.strictEqual(pinsForGood('skipped_not_a_real_status'), true);
});

/**
 * Every literal status passed to `appendToScanHistory(…)` in tracked code,
 * mapped to the files that write it. The call name must sit at a code
 * position, so a mention in a comment or a string is not a call.
 */
function writtenStatuses() {
  const written = new Map();
  for (const abs of trackedFiles(ROOT, (rel) => rel.endsWith('.mjs') && !rel.startsWith('tests/'))) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    const src = readFileSync(abs, 'utf-8');
    const isCode = codeMask(src);
    for (const m of src.matchAll(/(?<!function )\bappendToScanHistory\s*\(/g)) {
      if (!isCode[m.index]) continue;
      const end = src.indexOf(';', m.index);
      const call = src.slice(m.index, end === -1 ? undefined : end);
      for (const [, status] of call.matchAll(/['"](skipped_[a-z_]+|added)['"]/g)) {
        if (!written.has(status)) written.set(status, new Set());
        written.get(status).add(rel);
      }
    }
  }
  return written;
}

let written = new Map();
ok('census premise: the scan found the scanners and their statuses', () => {
  written = writtenStatuses();
  const files = new Set([...written.values()].flatMap((s) => [...s]));
  assert.ok(written.size >= 8, `only ${written.size} statuses found: ${[...written.keys()].join(', ')}`);
  assert.ok(files.has('scan-dayforce.mjs') && files.has('scan.mjs') && files.has('scan-interamt.mjs'),
    `scanners found: ${[...files].join(', ')}`);
});

ok('every status a scanner writes either releases its URL or pins it for a listed reason', () => {
  const stray = [...written.keys()].filter((s) => pinsForGood(s) && !DELIBERATE_PINS.has(s));
  assert.deepStrictEqual(stray, [], `pins a URL for good with no listed reason: ${stray.map((s) => `${s} (${[...written.get(s)].join(', ')})`).join('; ')}`);
});

ok('every listed deliberate pin is still written and still pins', () => {
  for (const [status] of DELIBERATE_PINS) {
    assert.ok(written.has(status), `${status} is no longer written anywhere; remove it from DELIBERATE_PINS`);
    assert.strictEqual(pinsForGood(status), true, `${status} no longer pins; remove it from DELIBERATE_PINS`);
  }
});
