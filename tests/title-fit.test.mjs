// tests/title-fit.test.mjs — free banded title-vs-profile fit estimator (#3260).
// Pure string math: no network, no tokens, no filesystem. The band annotates
// discovery cards; the assertions pin the CONTRACT (recommendation layer,
// bands not percentages in the UI) as much as the arithmetic.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ntitle-fit.mjs — free banded title/profile overlap hint (#3260)');
try {
  const m = await import(pathToFileURL(join(ROOT, 'web', 'src', 'lib', 'title-fit.mjs')).href);
  const { titleFit } = m;

  // Word order + punctuation insensitivity — exactly what firstMatch()'s
  // substring test misses ("platform engineer" chip vs "Engineer, Platform").
  const r = titleFit('Staff Engineer, Platform', ['platform engineer']);
  if (r && r.band === 'strong' && r.score === 1) {
    pass('word-order/punctuation titles still band strong (substring matching misses these)');
  } else {
    fail(`expected strong/1 for 'Staff Engineer, Platform': ${JSON.stringify(r)}`);
  }

  // Seniority words must not dilute the ratio — from EITHER side. A broken
  // filter on the title side would cap 'Senior Staff Platform Engineer' below
  // 1; a broken filter on the TARGET side ('senior platform engineer' counting
  // 3 tokens) would do the same from the other direction (CodeRabbit, #3261).
  const rs = titleFit('Senior Staff Platform Engineer', ['platform engineer']);
  const rs2 = titleFit('Platform Engineer', ['senior platform engineer']);
  if (rs && rs.band === 'strong' && rs.score === 1 && rs2 && rs2.score === 1) {
    pass('seniority words excluded on both title and target side');
  } else {
    fail(`seniority dilution: title-side=${JSON.stringify(rs)} target-side=${JSON.stringify(rs2)}`);
  }

  // Partial overlap → related; unrelated → weak (still returned, never hidden).
  const rp = titleFit('Data Engineer', ['platform engineer']);
  const rw = titleFit('Product Designer', ['platform engineer']);
  if (rp && rp.band === 'related' && rw && rw.band === 'weak') {
    pass('partial overlap → related, no overlap → weak');
  } else {
    fail(`banding wrong: partial=${JSON.stringify(rp)} none=${JSON.stringify(rw)}`);
  }

  // Multi-target profiles take the BEST role match.
  const rm = titleFit('Data Engineer', ['product designer', 'data engineer']);
  if (rm && rm.band === 'strong') {
    pass('best-matching target role wins across profile targets');
  } else {
    fail(`multi-target should pick data engineer: ${JSON.stringify(rm)}`);
  }

  // Band thresholds pinned: 2/3 hits ≈ 0.67 strong, 1/3 ≈ 0.33 weak, 1/2 related.
  const t3 = ['alpha beta gamma'];
  const b67 = titleFit('x alpha beta', t3), b33 = titleFit('x gamma', t3), b50 = titleFit('x alpha', ['alpha beta']);
  if (b67?.band === 'strong' && b33?.band === 'weak' && b50?.band === 'related'
      && b67.score === 0.67 && b33.score === 0.33 && b50.score === 0.5) {
    pass('thresholds: >=0.6 strong, >=0.34 related, else weak (scores rounded to 2dp)');
  } else {
    fail(`thresholds drifted: ${JSON.stringify([b67, b50, b33])}`);
  }

  // Empty/no-profile posture: null (chip omitted entirely), never a throw.
  if (titleFit('Anything At All', []) === null
      && titleFit('', ['engineer']) === null
      && titleFit(null, ['engineer']) === null
      && titleFit('Engineer', null) === null
      && titleFit('Engineer', 'not an array') === null) {
    pass('empty title/targets/non-array targets → null (caller omits the chip)');
  } else {
    fail('empty-input posture broken — expected null, got a band or a throw');
  }

  // A lone generic token still bands (profile said "engineer", title says so too):
  // honest, since it IS the user's declared target. Pinned so drift is visible.
  const rg = titleFit('Warranty Engineer', ['engineer']);
  if (rg && rg.band === 'strong' && rg.score === 1) {
    pass('single-token target matches fully when present (documented behavior)');
  } else {
    fail(`single-token target: ${JSON.stringify(rg)}`);
  }

  // Terminal periods are punctuation, not part of the role name — but dotted
  // names must keep their internal/leading dots (CodeRabbit follow-up, #3261).
  const rpd = titleFit('Platform Engineer.', ['platform engineer']);
  const rdot = titleFit('Node.js Engineer', ['node.js engineer']);
  const rdnet = titleFit('.NET Developer', ['.net developer']);
  if (rpd && rpd.score === 1 && rpd.band === 'strong'
      && rdot && rdot.score === 1 && rdnet && rdnet.score === 1) {
    pass('trailing periods stripped; node.js / .net stay whole');
  } else {
    fail(`terminal-period handling: ${JSON.stringify([rpd, rdot, rdnet])}`);
  }

  // Determinism — same inputs, same object (scan re-runs must be stable).
  const d1 = titleFit('Senior Platform Engineer', ['platform engineer', 'data engineer']);
  const d2 = titleFit('Senior Platform Engineer', ['platform engineer', 'data engineer']);
  if (JSON.stringify(d1) === JSON.stringify(d2)) {
    pass('deterministic for identical inputs');
  } else {
    fail(`nondeterministic: ${JSON.stringify(d1)} vs ${JSON.stringify(d2)}`);
  }
} catch (e) {
  fail(`title-fit tests crashed: ${e.message}`);
}
