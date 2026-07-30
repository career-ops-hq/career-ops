// tests/scan-url-dedup.test.mjs — normalizeUrlForDedup() must ignore volatile
// tracking parameters without ever collapsing two distinct postings onto one key.
//
// StepStone regenerates its `rltr` parameter on every request, so a dedup key that
// keeps it treats the same posting as new on each scan (one Vonovia posting was
// stored under three URLs across three scans, HDI and Lloyds under four each, and
// every re-add flowed into pipeline.md as a fresh offer to evaluate).
//
// DEDUP_STRIP_PARAMS is an allowlist rather than a blanket strip because the risk
// is asymmetric: an unstripped param leaves a visible duplicate, while stripping an
// identity-bearing one (Greenhouse's `gh_jid`) silently hides a real job. These
// tests pin both sides of that line.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — normalizeUrlForDedup() ignores tracking params, preserves identity');
try {
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // The reported bug: one StepStone posting, two scans, two `rltr` values.
  const SS = 'https://www.stepstone.de/stellenangebote--AI-Engineer-Berlin-Acme--12345-inline.html';
  const a = normalizeUrlForDedup(`${SS}?rltr=23_23_25_seorl_a_0_0_0_0_1_0`);
  const b = normalizeUrlForDedup(`${SS}?rltr=42_17_25_seorl_r_0_0_0_0_1_0`);
  if (a === b && a === normalizeUrlForDedup(SS)) pass('rltr variants collapse onto the bare posting key');
  else fail(`rltr = ${JSON.stringify({ a, b, bare: normalizeUrlForDedup(SS) })}`);

  // utm_* are analytics only.
  const utm = normalizeUrlForDedup('https://jobs.example.com/j/7?utm_source=x&utm_medium=y&utm_campaign=z');
  if (utm === 'https://jobs.example.com/j/7') pass('utm_* parameters are stripped');
  else fail(`utm = ${utm}`);

  // Identity-bearing params MUST survive: collapsing two real postings would
  // silently hide a job, which is worse than re-adding a duplicate.
  const gh1 = normalizeUrlForDedup('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
  const gh2 = normalizeUrlForDedup('https://boards.greenhouse.io/acme/jobs/1?gh_jid=2');
  if (gh1 !== gh2) pass('identity params (gh_jid) stay distinct');
  else fail(`collapsed distinct gh_jid postings onto ${gh1}`);

  // A tracking param must not take a real one with it.
  const mixed = normalizeUrlForDedup('https://jobs.example.com/j?gh_jid=9&rltr=abc&utm_source=feed');
  if (mixed === 'https://jobs.example.com/j?gh_jid=9') pass('only tracking params are dropped from a mixed query');
  else fail(`mixed query = ${mixed}`);

  // Untracked URLs must keep matching what is already in scan-history.
  const plain = 'https://jobs.ashbyhq.com/acme/abc-123';
  if (normalizeUrlForDedup(plain) === plain) pass('a tracking-free URL is left unchanged');
  else fail(`plain = ${normalizeUrlForDedup(plain)}`);

  // pipeline.md supports `local:jds/foo.md`. `local:` is a valid URL scheme, so this
  // parses and round-trips unchanged rather than hitting the catch — either way the
  // key must equal the input, or a local JD would be re-added on every scan.
  const local = 'local:jds/acme-ai-engineer.md';
  if (normalizeUrlForDedup(local) === local) pass('local: pipeline entries round-trip unchanged');
  else fail(`local = ${normalizeUrlForDedup(local)}`);

  // A genuinely unparseable value (no scheme) is what the catch actually handles.
  const bare = 'jds/acme-ai-engineer.md';
  if (normalizeUrlForDedup(bare) === bare) pass('scheme-less values pass through unchanged');
  else fail(`scheme-less = ${normalizeUrlForDedup(bare)}`);

  // Empty and nullish input is returned as-is, so a blank history cell never
  // becomes the shared key that every other blank cell dedups against.
  if (normalizeUrlForDedup('') === '' && normalizeUrlForDedup(null) === null && normalizeUrlForDedup(undefined) === undefined) {
    pass('empty/nullish input is returned unchanged');
  } else {
    fail('empty/nullish input should be returned unchanged');
  }
} catch (err) {
  fail(`scan.mjs normalizeUrlForDedup tests crashed: ${err && err.message}`);
}
