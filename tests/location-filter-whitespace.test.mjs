// Location keywords must match across no-break spaces and doubled spaces.
// joinup.ch returns "St.\u00a0Gallen", and providers/_html-entities.mjs decodes
// `&#160;` to a raw U+00A0, so a keyword written with a normal space missed it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

const NBSP = '\u00a0';

test('allow matches a location that carries a no-break space', () => {
  const accepts = buildLocationFilter({ allow: ['St. Gallen'] });
  assert.equal(accepts(`St.${NBSP}Gallen`, 'https://joinup.ch/job/x', 'Engineer', {}), true);
  assert.equal(accepts('Zürich', 'https://joinup.ch/job/y', 'Engineer', {}), false);
});

test('block rejects a blocked city written with a no-break space', () => {
  const accepts = buildLocationFilter({ block: ['New York'] });
  assert.equal(accepts(`New${NBSP}York`, 'https://x.com/j', 'Engineer', {}), false);
  assert.equal(accepts(`New${NBSP}York,${NBSP}NY`, '', 'Engineer'), false);
});

test('always_allow wins over block across a no-break space', () => {
  const accepts = buildLocationFilter({ always_allow: ['New York'], block: ['York'] });
  assert.equal(accepts(`New${NBSP}York`, '', 'Engineer'), true);
});

test('block_hard rejects across a no-break space', () => {
  const accepts = buildLocationFilter({ always_allow: ['Porto'], block_hard: ['Rio Grande'] });
  assert.equal(accepts(`Porto Alegre, Rio${NBSP}Grande do Sul, Brazil`, '', 'Engineer'), false);
});

test('a keyword written with a no-break space matches a plain-space location', () => {
  const accepts = buildLocationFilter({ allow: [`St.${NBSP}Gallen`] });
  assert.equal(accepts('St. Gallen', '', 'Engineer'), true);
});

test('doubled and other Unicode spaces fold like a single space', () => {
  const accepts = buildLocationFilter({ allow: ['New  York'] });
  for (const location of ['New  York', 'New York', 'New\u202fYork', 'New\u2009York', 'New\tYork']) {
    assert.equal(accepts(location, '', 'Engineer'), true, JSON.stringify(location));
  }
});

test('a no-break space in a US always_allow entry still turns on the state expansion', () => {
  const accepts = buildLocationFilter({ always_allow: [`United${NBSP}States`], block: ['Dublin'] });
  assert.equal(accepts('Dublin, OH', '', 'Engineer'), true);
  assert.equal(accepts('Dublin, Ireland', '', 'Engineer'), false);
});

// Whitespace is not a qualifier: a doubled or no-break space still spells the
// exact label (#6553). Qualified labels stay rejected in location-filter-worldwide.
test('a worldwide label with a no-break or doubled space passes a country-only allow list', () => {
  const accepts = buildLocationFilter({ allow: ['Germany'] });
  assert.equal(accepts(`Anywhere in the${NBSP}world`, '', 'Engineer'), true);
  assert.equal(accepts('Anywhere  in the World', '', 'Engineer'), true);
  assert.equal(accepts('Worldwide  except Canada', '', 'Engineer'), false);
});

test('ISO codes keep their case-sensitive match next to a no-break space (#6605)', () => {
  const accepts = buildLocationFilter({ allow: ['IN'], strict: true });
  assert.equal(accepts(`Pune,${NBSP}IN`, '', 'Engineer'), true);
  assert.equal(accepts(`Anywhere${NBSP}in${NBSP}the${NBSP}World`, '', 'Engineer'), false);
});

test('astral-letter keywords keep their word boundary (#4478)', () => {
  const accepts = buildLocationFilter({ allow: ['𐐀'] });
  assert.equal(accepts('𐐀', '', 'Engineer'), true);
  assert.equal(accepts(`${NBSP}𐐀${NBSP}`, '', 'Engineer'), true);
  assert.equal(accepts('𐐀x', '', 'Engineer'), false);
});
