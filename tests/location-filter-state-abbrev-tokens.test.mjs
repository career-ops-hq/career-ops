// A USPS state abbreviation in the `, ST` form must end its comma segment.
//
// When `always_allow` names the United States, `scan.mjs` additionally accepts
// USPS state names and two-letter codes, so a posting labelled only
// "Austin, TX" clears a US-only filter. `compileUsStateAbbrev` already refuses
// to match inside a word, and the comment above it states the invariant this
// file guards: ordinary English words such as "in", "or" and "me" must not
// stand for Indiana, Oregon and Maine.
//
// The comma alternative used to accept any abbreviation that followed a comma
// and was not glued to a letter, which a conjunction inside a list satisfies.
// "Canada - Remote (ON, AB, BC, or NS Only)" — a real Instacart posting —
// matched OR through its ", or " and so cleared a United-States-only filter as
// an Oregon role. Multi-region Canadian strings take exactly this shape, and
// none of ON, AB, BC or NS is a USPS code, so the conjunction was the only
// thing admitting it.
//
// The distinguishing signal is what follows: a real state label ends its
// segment, so the next thing is the end of the string, a comma, or bracketed
// or punctuated trailing detail. A two-letter English word inside a list is
// followed by another bare word, which a state label never is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

const usOnly = buildLocationFilter({
  always_allow: ['United States', 'USA'],
  allow: ['United States', 'USA'],
});

test('a conjunction after a comma does not stand for a US state', () => {
  for (const location of [
    'Canada - Remote (ON, AB, BC, or NS Only)',
    'Canada - Remote (ON, AB, or BC)',
    'Remote, Belgium or France',
    'Remote, Germany or Austria only',
    'Bangalore, India or Hyderabad, India',
  ]) {
    assert.equal(usOnly(location), false, `${location} must not clear a US-only filter`);
  }
});

test('the comma form still admits a real City, ST label', () => {
  for (const location of [
    'Austin, TX',
    'Austin,TX',
    'Dublin, OH, USA',
    'Portland, OR, United States',
    'Austin, TX, US',
    'Remote, OR',
    'San Francisco, CA (Hybrid)',
    'Seattle, WA - Remote',
    'Chicago, IL.',
    'Menlo Park, CA; New York, NY',
  ]) {
    assert.equal(usOnly(location), true, `${location} must still pass`);
  }
});

// The abbreviation reaches the matcher from a Workday URL hint too, where
// separators are already flattened to spaces and there is no comma to lean on.
test('the trailing-token form is unaffected', () => {
  const workday = 'https://acme.wd12.myworkdayjobs.com/careers/job/';
  assert.equal(usOnly('5 Locations', `${workday}Dublin-OH/Eng_R1`), true,
    'a URL-derived City ST hint still resolves to a US state');
  assert.equal(usOnly('5 Locations', `${workday}Canada---Vancouver-BC/Eng_R1`), false,
    'a Canadian URL hint stays out');
});

// Guard the whole USPS set, not just the codes that happen to read as English
// here: `or` was the one that bit, but `in`, `me`, `ok`, `hi`, `la`, `pa` and
// `de` are all two-letter words that appear in location strings.
test('no USPS code admits a list of non-US regions', () => {
  const offenders = [];
  for (const region of ['ON', 'AB', 'BC', 'NS', 'QC', 'MB', 'SK']) {
    const location = `Canada - Remote (${region}, or elsewhere)`;
    if (usOnly(location) !== false) offenders.push(location);
  }
  assert.deepEqual(offenders, []);
});
