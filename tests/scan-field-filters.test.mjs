// tests/scan-field-filters.test.mjs — #3438: a target declares WHICH FIELD its
// whitelist reads. A title whitelist cannot express "this posting is in an
// occupation I want" on a board that publishes an occupation code, so those
// matches were dropped silently — the title never matched, and nothing was
// counted as rejected for the reason that actually applied.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan — declared-field whitelists (filter_on / field_filters)');

const scan = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const { normalizeFilterOn, buildTitleFilter } = scan;
const titleKeywords = await import(pathToFileURL(join(ROOT, 'title-keywords.mjs')).href);

// ── normalizeFilterOn ──────────────────────────────────────────────
// The default is the whole backward-compatibility guarantee: every existing
// portals.yml has no filter_on at all, and must keep gating on title.
{
  const cases = [
    [undefined, ['title'], 'absent filter_on defaults to title'],
    [null, ['title'], 'null filter_on defaults to title'],
    ['', ['title'], 'empty string defaults to title'],
    ['noc', ['noc'], 'a bare string becomes a one-field list'],
    [['noc'], ['noc'], 'a one-element array is kept'],
    [['company', 'title'], ['company', 'title'], 'a multi-field array is kept in order'],
    ['  noc  ', ['noc'], 'surrounding whitespace is trimmed'],
    [[], ['title'], 'an empty array defaults to title'],
    [[null, 'noc', 42], ['noc'], 'non-string entries are dropped'],
  ];
  for (const [input, want, label] of cases) {
    const got = normalizeFilterOn(input);
    if (JSON.stringify(got) === JSON.stringify(want)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}

// ── The bug this issue is about ────────────────────────────────────
// Real shape: Job Bank publishes NOC 22221 (TEER 2, help desk) on a posting
// titled "Analyst, Client Services". No title whitelist can enumerate the
// titles an occupation is advertised under, so the match is lost.
{
  const titleFilter = buildTitleFilter({ positive: ['help desk', 'service desk'] });
  const job = { title: 'Analyst, Client Services', noc: '22221' };

  if (!titleFilter(job.title)) pass('title whitelist drops the posting — the bug, reproduced');
  else fail('expected the title whitelist to miss this posting');

  const nocFilter = buildTitleFilter({ positive: ['stem:22', 'stem:13'] });
  if (nocFilter(job.noc)) pass('a noc whitelist keeps it — the fix');
  else fail('expected the noc whitelist to match 22221');
}

// ── No new matching semantics ──────────────────────────────────────
// field_filters blocks go through the same compiler as title_filter, so the
// word-boundary rules from #3103 cannot drift between fields.
{
  if (typeof titleKeywords.buildTitleFilter === 'function'
      && buildTitleFilter === titleKeywords.buildTitleFilter) {
    pass('field blocks compile with the same buildTitleFilter as title_filter');
  } else {
    fail('scan.mjs re-exports a different compiler than title-keywords.mjs');
  }

  const f = buildTitleFilter({ positive: ['stem:22'], negative: ['22222'] });
  if (f('22221')) pass('stem: prefix matches on a non-title field');
  else fail('stem:22 should match 22221');
  if (!f('22222')) pass('negative entries veto on a non-title field too');
  else fail('22222 should have been vetoed');
}

// ── Absent field passes, and is counted ────────────────────────────
// Dropping a posting because the provider omitted the field would recreate
// the silent loss with the sign flipped. It passes, and the run says so.
{
  const fieldFilters = new Map([['noc', buildTitleFilter({ positive: ['stem:22'] })]]);
  const gate = (job, filterOn) => {
    let absent = false;
    const ok = normalizeFilterOn(filterOn).every((field) => {
      if (field === 'title') return true;
      const value = job[field];
      if (value === undefined || value === null || value === '') { absent = true; return true; }
      return fieldFilters.get(field)(String(value));
    });
    return { ok, absent };
  };

  const missing = gate({ title: 'Anything' }, 'noc');
  if (missing.ok && missing.absent) pass('a posting with no noc passes and is flagged absent');
  else fail(`expected pass+absent, got ${JSON.stringify(missing)}`);

  const present = gate({ title: 'Anything', noc: '65102' }, 'noc');
  if (!present.ok && !present.absent) pass('a posting with a non-matching noc is rejected');
  else fail(`expected reject, got ${JSON.stringify(present)}`);

  const anded = gate({ title: 'Anything', noc: '22221' }, ['noc', 'title']);
  if (anded.ok) pass('an array of fields is ANDed');
  else fail('expected both fields to pass');
}

