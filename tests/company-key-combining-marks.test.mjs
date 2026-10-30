// tests/company-key-combining-marks.test.mjs — rejection-latency's company
// identity key must not delete combining marks.
//
// companyKey normalized with `[^\p{L}\p{N}]` — no \p{M} — which strips COMBINING
// MARKS. Latin survives because NFKC precomposes its accents, which is precisely
// why the bug read as correct in every test anyone would have written:
//
//     José Ltd        ->  joséltd      (fine)
//     कंपनी लिमिटेड  ->  कपनलमटड     (every vowel sign and the anusvara gone)
//     บริษัท          ->  บรษท         (Thai for "company")
//
// Two silent consequences. Distinct Hindi employers differing only in vowel
// signs key identically and are grouped as one company; and an employer spelled
// the same in data/applications.md and data/active-interviews.md can key
// differently from itself, so its rounds never join and the latency signal is
// never computed for it.
//
// career-ops ships modes/hi and modes/ar as supported markets.
//
// Run:  node --test tests/company-key-combining-marks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { companyKey, parseTrackerInterviewRows } =
  await import(pathToFileURL(join(ROOT, 'rejection-latency.mjs')).href);
const { normalizeTextKey } = await import(pathToFileURL(join(ROOT, 'tracker-parse.mjs')).href);

test('a Devanagari name keeps its vowel signs', () => {
  const key = companyKey('कंपनी लिमिटेड');
  assert.ok(key.includes('ं'), `the anusvara was stripped: ${JSON.stringify(key)}`);
  assert.ok(key.includes('ी'), `a vowel sign was stripped: ${JSON.stringify(key)}`);
});

test('two Hindi names differing only in vowel signs do not collide', () => {
  // The consequence that matters: collapsing these groups two unrelated
  // employers into one company for the whole latency report.
  assert.notEqual(
    companyKey('शर्मा टेक'),
    companyKey('शरमा टेक'),
    'two distinct Hindi employers keyed identically',
  );
});

test('a Thai name survives', () => {
  assert.equal(companyKey('บริษัท'), normalizeTextKey('บริษัท'));
  assert.ok(companyKey('บริษัท').length > 4, `Thai name was reduced to ${JSON.stringify(companyKey('บริษัท'))}`);
});

test('Latin punctuation and case folding are unchanged', () => {
  // The regression guard. This is what the old regex did correctly and what
  // every existing caller depends on, so the fix must not move it.
  assert.equal(companyKey('Acme Corp.'), companyKey('acme corp'));
  assert.equal(companyKey('José Ltd'), 'joséltd');
  assert.equal(companyKey(''), '');
  assert.equal(companyKey(null), '');
  assert.equal(companyKey('?'), '', 'the placeholder marker must still key to empty');
});

test('Żubr and Zubr stay distinct', () => {
  // normalizeTextKey refuses NFD for this reason, and it is the trap an
  // "obvious" fix falls into: decompose, strip marks, recompose looks
  // equivalent and collapses Polish, Lithuanian and Maltese distinctions.
  assert.notEqual(companyKey('Żubr'), companyKey('Zubr'));
  assert.notEqual(companyKey('Ġenerali'), companyKey('Generali'));
});

test('İstanbul and Istanbul still key together', () => {
  // The old regex got this right by accident — it threw away every mark,
  // including the U+0307 that lowercasing a Turkish dotted İ leaves behind.
  // normalizeTextKey strips that one deliberately (#2705/#2736), so the
  // behaviour has to survive the delegation.
  assert.equal(companyKey('İstanbul Tekstil'), companyKey('Istanbul Tekstil'));
});

test('grouping still works end to end for a non-Latin employer', () => {
  // Unit parity is not the point on its own — the key feeds row grouping, and
  // that is where a mangled key shows up as a missing company.
  const tracker = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-05 | शर्मा टेक | Backend Engineer | 4.2/5 | Interview | ✅ | [1](r1.md) | n |',
    '| 2 | 2026-01-06 | Acme | ML Lead | 4.1/5 | Interview | ✅ | [2](r2.md) | n |',
    '',
  ].join('\n');
  const byCompany = parseTrackerInterviewRows(tracker);
  assert.ok(byCompany.has(companyKey('शर्मा टेक')), `the Hindi employer did not group: ${[...byCompany.keys()].join(', ')}`);
  assert.equal(byCompany.size, 2, `expected two companies, got ${[...byCompany.keys()].join(', ')}`);
});

// ── the same key is used for roles and for the via channel ─────────────────
//
// companyKey is not only the company key. rejection-latency also keys ROLE
// titles with it (`:399`, `:401`, for joining an interview round to the right
// tracker row when a company has several open) and the `via=` AGENCY name
// (`:217`, for the `? (via Hays)` bucket that groups confidential rows).
//
// So the stripped marks hit three identities, not one: a non-Latin role title
// failed to join its own tracker row, and two distinct agencies could share a
// channel bucket.

test('a non-Latin role title keeps its marks', () => {
  const key = companyKey('वरिष्ठ अभियंता');
  assert.equal(key, normalizeTextKey('वरिष्ठ अभियंता'));
  assert.ok(key.includes('ि') || key.includes('े'), `role vowel signs were stripped: ${JSON.stringify(key)}`);
});

test('two roles differing only in vowel signs do not collide', () => {
  // The join at :401 matches an interview round to a tracker row by role key.
  // Collapsing these attaches a round to the wrong opening at the same company.
  assert.notEqual(companyKey('वरिष्ठ अभियंता'), companyKey('वरिषठ अभियंता'));
});

test('two agencies differing only in vowel signs get separate via buckets', () => {
  // groupIdentity keys the channel with companyKey, so a collision here merges
  // two agencies' confidential rows into one `? (via ...)` group.
  assert.notEqual(companyKey('कंसल्टिंग'), companyKey('कंसलटिंग'));
});

test('a Latin role still joins case- and punctuation-insensitively', () => {
  // The guard for the role leg, matching the company one above.
  assert.equal(companyKey('Sr. Backend Engineer'), companyKey('sr backend engineer'));
});

// ── the delegation itself ──────────────────────────────────────────────────

test('companyKey stays a delegation, not a reimplementation', () => {
  // This is the regression the fix most needs. The bug was a LOCAL copy of a
  // normalizer that drifted from the maintained one, and the natural way to
  // reintroduce it is to inline the regex again for speed or to avoid the
  // import. Agreement is asserted over inputs that separate the two
  // implementations rather than by reading the source, so any divergence
  // reddens regardless of how it is written.
  const probes = [
    'Acme Corp.', 'acme corp', 'José Ltd', 'Żubr', 'Zubr', 'Ġenerali', 'Generali',
    'İstanbul Tekstil', 'Istanbul Tekstil', 'कंपनी लिमिटेड', 'शर्मा टेक',
    'บริษัท', 'مؤسسة', 'वरिष्ठ अभियंता', '', '?', '—', '-', null, undefined,
  ];
  for (const p of probes) {
    assert.equal(
      companyKey(p), normalizeTextKey(p),
      `companyKey diverged from normalizeTextKey on ${JSON.stringify(p)} — if that is deliberate, this test should say why`,
    );
  }
});

test('and no local regex in this file strips marks from an identity', () => {
  // Scoped to this file on purpose. fingerprint-core.mjs and detect-reposts.mjs
  // carry the same `[^\p{L}\p{N}]` alphabet, but they fingerprint TITLES for
  // repost detection rather than keying an identity, and detect-reposts folds
  // accents deliberately with a documented fallback. That is a separate
  // question with a separate answer, so it is not asserted here — widening this
  // check to the repo would couple this fix to that decision.
  const src = readFileSync(join(ROOT, 'rejection-latency.mjs'), 'utf-8');
  const offenders = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && /\[\^\\p\{L\}\\p\{N\}\]/.test(l));
  assert.deepEqual(offenders, [], `a mark-stripping alphabet came back:\n${offenders.join('\n')}`);
});
