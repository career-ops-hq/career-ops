// tests/jd-capture.test.mjs — Unit tests for jd-capture.mjs report-keyed capture lookup (#134).
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const { findCaptureForReport, reportPrefix } = await import(pathToFileURL(join(ROOT, 'jd-capture.mjs')).href);

console.log('\njd-capture.mjs — report-keyed capture lookup');

function check(desc, condition, details = '') {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
}

const testDir = mkdtempSync(join(tmpdir(), 'cops-jdcapture-'));
const jds = join(testDir, 'jds');
mkdirSync(jds, { recursive: true });

// Ages a file so mtime ordering is deterministic rather than dependent on write speed.
function writeCapture(name, body = 'JD body', ageSeconds = 0) {
  const p = join(jds, name);
  writeFileSync(p, body);
  if (ageSeconds) {
    const t = Date.now() / 1000 - ageSeconds;
    utimesSync(p, t, t);
  }
  return p;
}

try {
  // ── reportPrefix ───────────────────────────────────────────────────────────
  check('reportPrefix pads to three digits', reportPrefix(64) === '064');
  check('reportPrefix leaves 3-digit numbers alone', reportPrefix(563) === '563');
  check('reportPrefix does not truncate 4-digit numbers', reportPrefix(1024) === '1024');
  check('reportPrefix accepts a numeric string', reportPrefix('64') === '064');

  // ── padded / unpadded matching ─────────────────────────────────────────────
  writeCapture('064-acme.txt');
  const padded = findCaptureForReport(jds, 64);
  check('finds a zero-padded capture', padded?.filename === '064-acme.txt');
  check('reports the resolved extension', padded?.ext === '.txt');

  writeCapture('01-beta-systems.txt');
  check('finds a two-digit unpadded legacy capture', findCaptureForReport(jds, 1)?.filename === '01-beta-systems.txt');

  writeCapture('7-gamma.txt');
  check('finds a one-digit unpadded legacy capture', findCaptureForReport(jds, 7)?.filename === '7-gamma.txt');

  writeCapture('563-delta-head-of-growth.md');
  const asMd = findCaptureForReport(jds, 563);
  check('finds an .md capture', asMd?.filename === '563-delta-head-of-growth.md');
  check('reports .md extension', asMd?.ext === '.md');

  // ── negative cases: this is where a naive prefix glob goes wrong ───────────
  writeCapture('640-epsilon.txt');
  check('does not confuse report 64 with report 640', findCaptureForReport(jds, 64)?.filename === '064-acme.txt');
  check('resolves report 640 to its own capture', findCaptureForReport(jds, 640)?.filename === '640-epsilon.txt');

  writeCapture('li-0640-zeta-cmo.txt');
  check('ignores a report number embedded mid-filename', findCaptureForReport(jds, 640)?.filename === '640-epsilon.txt');

  check('returns null when no capture matches', findCaptureForReport(jds, 999) === null);

  writeCapture('theta-vp-marketing.md');
  check('ignores captures with no numeric prefix', findCaptureForReport(jds, 0) === null);

  // A company slug that begins with digits is genuinely ambiguous with a report
  // number. Documented limitation: the companySlug hint below is the escape hatch.
  writeCapture('360-learning-cmo.txt');
  check('digit-leading company slug is matched (known ambiguity)', findCaptureForReport(jds, 360)?.filename === '360-learning-cmo.txt');

  // ── multiple candidates ────────────────────────────────────────────────────
  writeCapture('070-iota-old.txt', 'older', 600);
  writeCapture('070-iota-new.pdf', 'newer', 0);
  const multi = findCaptureForReport(jds, 70);
  check('surfaces every candidate for the report', multi?.candidates?.length === 2);
  check('defaults to the most recent capture', multi?.filename === '070-iota-new.pdf');

  const hinted = findCaptureForReport(jds, 70, { companySlug: 'iota-old' });
  check('companySlug hint overrides the recency default', hinted?.filename === '070-iota-old.txt');

  // A hint that matches nothing is not a preference the lookup may quietly drop:
  // it means no candidate is this company's posting. Falling back to the most
  // recent one returned a different company's JD, indistinguishable to the caller
  // from a real hit (see the cross-company collision case below).
  const hintMiss = findCaptureForReport(jds, 70, { companySlug: 'nomatch' });
  check('unmatched companySlug reports no capture rather than guessing', hintMiss === null);

  // ── cross-company prefix collision ─────────────────────────────────────────
  // `04-mission-preborn-vp-marketing.txt` parses to report 4. When report 4 is a
  // different company, no candidate is that company's posting, and returning the
  // mismatch is worse than returning nothing: outcome.mjs copies the result to
  // the outcome dir as the permanent posting record, and treats the lookup as a
  // success, so it never archives the real posting.
  writeCapture('04-mission-preborn-vp-marketing.txt');
  check('companySlug matching no candidate returns null rather than another company\'s capture',
    findCaptureForReport(jds, 4, { companySlug: 'weave' }) === null);

  // ── the slug must identify the company, not merely occur in the name ───────
  // Both grammars this repo writes put the company first, after the report
  // prefix and an optional capture date:
  //   {NNN}-{YYYY-MM-DD}_{company}_{role}.pdf   (archive-posting.mjs)
  //   {NNN}-{company}-{role}.{ext}              (hand-named / plugin captures)
  // Substring matching let a role word stand in for a company, which is the
  // same mistake as matching on the number alone.
  writeCapture('004-2026-08-11_weave_chief-marketing-officer.pdf');
  check('company field matches in the dated underscore grammar',
    findCaptureForReport(jds, 4, { companySlug: 'weave' })?.filename === '004-2026-08-11_weave_chief-marketing-officer.pdf');
  check('company field matches in the hand-named hyphen grammar',
    findCaptureForReport(jds, 4, { companySlug: 'mission-preborn' })?.filename === '04-mission-preborn-vp-marketing.txt');
  check('a role word does not stand in for the company',
    findCaptureForReport(jds, 4, { companySlug: 'marketing' }) === null);
  check('a role abbreviation does not stand in for the company',
    findCaptureForReport(jds, 4, { companySlug: 'vp' }) === null);
  check('a mid-name role word does not stand in for the company',
    findCaptureForReport(jds, 4, { companySlug: 'chief' }) === null);

  // An empty slug is a supplied-but-unusable company, not an absent hint. A
  // caller that could not determine the company must not silently receive the
  // most recent capture as though it had been attributed.
  check('empty companySlug is treated as supplied and matches nothing',
    findCaptureForReport(jds, 4, { companySlug: '' }) === null);

  // ── robustness ─────────────────────────────────────────────────────────────
  check('missing jds dir returns null instead of throwing', findCaptureForReport(join(testDir, 'nope'), 64) === null);
  check('non-numeric report returns null', findCaptureForReport(jds, 'abc') === null);
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
