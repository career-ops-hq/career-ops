// tests/process-quality-unknown-employer.test.mjs — the `?` unknown-employer
// placeholder must not become a company in the per-company friction report.
//
// `AGENTS.md` documents the convention: when the end employer is not disclosed,
// the Company cell holds `?` and the agency goes in the tagged `via=` field
// (#1596). merge-tracker already honours it — its dedup carries an explicit
// cross-channel guard so `?` rows never fuzzy-merge across agencies.
//
// aggregateProcessQuality grouped on the Company cell alone, so every
// undisclosed employer collapsed into ONE bucket. Measured before the fix, on
// three unrelated employers reached through three different agencies:
//
//   { company: "?", totalInterviews: 3, frictionCount: 2, frictionRate: 0.67 }
//
// That row is not a company, it is three — and 0.67 is arithmetic across
// unrelated employers. The number a user acts on ("this company wastes my
// time") is precisely the one that cannot be computed here.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nprocess-quality.mjs — an undisclosed employer is not a company');

try {
  const { aggregateProcessQuality } = await import(
    pathToFileURL(join(ROOT, 'process-quality.mjs')).href
  );

  const rows = [
    { company: '?', via: 'Hays', role: 'Backend Engineer', notes: 'round 3 [process-friction] rescheduled twice' },
    { company: '?', via: 'Michael Page', role: 'Data Engineer', notes: 'smooth process' },
    { company: '?', via: 'Robert Half', role: 'Platform Eng', notes: '[process-friction] ghosted after onsite' },
    { company: 'Acme', via: '—', role: 'Fullstack', notes: 'ok' },
  ];
  const out = aggregateProcessQuality(rows, 1);

  // ── The three undisclosed employers must not merge ──
  const bare = out.filter((r) => r.company.trim() === '?');
  if (bare.length === 0) {
    pass('no bucket is reported under the bare "?" placeholder');
  } else {
    fail(`three employers merged into one row: ${JSON.stringify(bare)}`);
  }

  const viaBuckets = out.filter((r) => /Hays|Michael Page|Robert Half/.test(r.company));
  if (viaBuckets.length === 3 && viaBuckets.every((r) => r.totalInterviews === 1)) {
    pass('each agency channel is its own bucket, one interview apiece');
  } else {
    fail(`channels not separated: ${JSON.stringify(out)}`);
  }

  // The friction must land on the channel that actually had it, not be averaged
  // across all three.
  const hays = out.find((r) => /Hays/.test(r.company));
  const page = out.find((r) => /Michael Page/.test(r.company));
  if (hays?.frictionRate === 1 && page?.frictionRate === 0) {
    pass('friction is attributed to the channel that had it, not averaged');
  } else {
    fail(`friction misattributed: Hays=${JSON.stringify(hays)} Page=${JSON.stringify(page)}`);
  }

  // ── A row that names neither employer nor channel supports no claim ──
  const unattributable = aggregateProcessQuality([
    { company: '?', via: '', role: 'X', notes: '[process-friction] slow' },
    { company: '?', via: '—', role: 'Y', notes: 'ok' },
  ], 1);
  if (unattributable.length === 0) {
    pass('a row with no employer and no channel is dropped, not given a bucket');
  } else {
    fail(`unattributable rows produced buckets: ${JSON.stringify(unattributable)}`);
  }

  // An EMPTY company says the same thing as `?` — no employer named — so it must
  // reach the same channel attribution instead of being dropped one line
  // earlier (CodeRabbit, #3005). The label has to stay stable too: composing it
  // from an empty prefix would yield " (via Hays)" with a leading space.
  const blankCompany = aggregateProcessQuality([
    { company: '', via: 'Hays', role: 'A', notes: '[process-friction] slow' },
    { company: '', via: 'Hays', role: 'B', notes: 'fine' },
    { company: '', via: 'Michael Page', role: 'C', notes: 'fine' },
  ], 1);
  const haysBlank = blankCompany.find((r) => /Hays/.test(r.company));
  if (blankCompany.length === 2 && haysBlank?.totalInterviews === 2 && haysBlank?.frictionRate === 0.5) {
    pass('an empty company with a via is attributed to its channel, not dropped');
  } else {
    fail(`blank company not attributed: ${JSON.stringify(blankCompany)}`);
  }
  if (haysBlank && haysBlank.company === '? (via Hays)') {
    pass('an empty company gets the stable "?" label, with no leading space');
  } else {
    fail(`unstable label: ${JSON.stringify(haysBlank?.company)}`);
  }

  // EVERY placeholder spelling must collapse to the same bucket. isPlaceholder
  // accepts `?`, `—`, `-` and an empty cell, so normalizing only the empty one
  // left `— (via Hays)` keyed apart from `? (via Hays)` — splitting one
  // channel's totals, which is this PR's own bug in miniature (CodeRabbit,
  // #3005).
  const mixedMarkers = aggregateProcessQuality([
    { company: '?', via: 'Hays', role: 'A', notes: '[process-friction] slow' },
    { company: '—', via: 'Hays', role: 'B', notes: 'fine' },
    { company: '-', via: 'Hays', role: 'C', notes: 'fine' },
    { company: '', via: 'Hays', role: 'D', notes: 'fine' },
  ], 1);
  if (mixedMarkers.length === 1 && mixedMarkers[0].company === '? (via Hays)'
      && mixedMarkers[0].totalInterviews === 4 && mixedMarkers[0].frictionRate === 0.25) {
    pass('every placeholder spelling collapses into one bucket per channel');
  } else {
    fail(`markers split the channel: ${JSON.stringify(mixedMarkers)}`);
  }

  // ── Guards: ordinary companies are untouched ──
  const acme = out.find((r) => r.company === 'Acme');
  if (acme && acme.totalInterviews === 1 && acme.frictionCount === 0) {
    pass('a named company is unaffected');
  } else {
    fail(`named company changed: ${JSON.stringify(acme)}`);
  }

  const plain = aggregateProcessQuality([
    { company: 'Globex', role: 'A', notes: '[process-friction] rescheduled' },
    { company: 'globex', role: 'B', notes: 'fine' },
  ], 1);
  if (plain.length === 1 && plain[0].totalInterviews === 2 && plain[0].frictionRate === 0.5) {
    pass('case-insensitive grouping of a named company still merges');
  } else {
    fail(`named grouping regressed: ${JSON.stringify(plain)}`);
  }

  // A tracker with no Via column at all (the pre-#1596 layout) must not crash
  // or invent channels.
  const legacy = aggregateProcessQuality([
    { company: 'Initech', role: 'A', notes: 'ok' },
  ], 1);
  if (legacy.length === 1 && legacy[0].company === 'Initech') {
    pass('a tracker with no Via column still aggregates normally');
  } else {
    fail(`legacy layout broke: ${JSON.stringify(legacy)}`);
  }
} catch (error) {
  fail(`process-quality tests could not run: ${error.message}`);
}
