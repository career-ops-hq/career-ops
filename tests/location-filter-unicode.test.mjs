// #3431: location keywords must not anchor inside Unicode words, and a
// Workday title-only URL must not manufacture a nonempty location.
import { pass, fail } from './helpers.mjs';
import { buildLocationFilter, locationHintFromUrl } from '../scan.mjs';

console.log('\nLocation filter — Unicode boundaries and Workday URL shapes');

function equal(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const issueFilter = buildLocationFilter({ allow: ['United States', 'al,'] });
equal(issueFilter('Montréal, Quebec, CAN'), false, 'al, does not admit Montréal');
equal(issueFilter('Austin, TX, United States'), true, 'the allowed US control still passes');
equal(issueFilter('Paris, France'), false, 'the out-of-region control still fails');

// The same compiler serves all four tiers. Each row pairs a real standalone
// match with an embedded match that must fail. Non-Latin keyword edges need
// boundaries too; astral letters must be read as code points, not code units.
const boundaryCases = [
  ['al,', 'Huntsville, AL, United States', 'Montréal, Quebec, Canada'],
  ['montr', 'Montr', 'Montréal'],
  ['al,', 'AL, United States', 'Montre\u0301al, Quebec, Canada'],
  ['\u0301al', '(\u0301al)', 'e\u0301al'],
  ['cafe', 'Cafe', 'Cafe\u0301'],
  ['cafe\u0301', '(Cafe\u0301)', 'Cafe\u0301teria'],
  ['é', '(É)', 'Pré'],
  ['é', '(É)', 'Évry'],
  ['東京', '(東京)', '新東京'],
  ['東京', '(東京)', '東京都'],
  ['𐐀', '(𐐀)', 'x𐐀'],
  ['𐐀', '(𐐀)', '𐐀x'],
  ['al,', 'AL, United States', '𐐀al,'],
  ['al', '(AL)', 'al𐐀'],
  ['al,', 'AL, United States', '٢al,'],
  ['al', '(AL)', 'al٢'],
  ['٢', '(٢)', 'x٢'],
  ['٢', '(٢)', '٢x'],
];
for (const tier of ['block_hard', 'always_allow', 'block', 'allow']) {
  const admits = tier === 'allow' || tier === 'always_allow';
  const failures = [];
  for (const [keyword, standalone, embedded] of boundaryCases) {
    const filter = buildLocationFilter({ allow: admits ? ['Neverland'] : [], [tier]: [keyword] });
    for (const [location, expected] of [[standalone, admits], [embedded, !admits]]) {
      const actual = filter(location);
      if (actual !== expected) failures.push({ keyword, location, actual, expected });
    }
  }
  const label = `${tier} respects Unicode keyword edges and adjacent letters, marks and numbers`;
  if (failures.length === 0) pass(label);
  else fail(`${label}: ${JSON.stringify(failures)}`);
}

// Punctuation at a keyword edge keeps its existing literal semantics. A dot
// is not a wildcard, and a punctuation-ended alias needs no right boundary.
for (const [keyword, match, miss] of [
  ['UK -', 'UK - London', 'Truck - Depot'],
  [', IND', 'Hyderabad, IND', 'Hyderabad, Indiana'],
  ['U.S.', 'Boston, U.S.', 'Boston, UxSx'],
  ['U.S.A.', 'Boston, U.S.A.', 'Boston, UxSxAx'],
  ['(India)', 'Remote (India)', 'Remote India'],
]) {
  const filter = buildLocationFilter({ allow: [keyword] });
  equal(filter(match), true, `${keyword} keeps its literal standalone match`);
  equal(filter(miss), false, `${keyword} rejects its punctuation control`);
}
equal(buildLocationFilter({ allow: ['Montréal'] })('Montre\u0301al'), false,
  'boundary matching does not introduce Unicode normalization or accent folding');
equal(buildLocationFilter({ allow: ['U.S.'] })('U.S.A.'), true,
  'punctuation-ended aliases retain their open right edge');

const mixed = 'Montréal, Canada / 東京, Japan';
for (const [config, expected, label] of [
  [{ block_hard: ['東京'], always_allow: ['Montréal'], allow: ['Canada'] }, false, 'block_hard beats always_allow'],
  [{ always_allow: ['東京'], block: ['Montréal'], allow: ['Neverland'] }, true, 'always_allow beats block'],
  [{ block: ['東京'], allow: ['Canada'] }, false, 'block beats allow and a remote title'],
  [{ block_hard: ['al,'], always_allow: ['東京'] }, true, 'a mid-word block_hard alias does not veto always_allow'],
  [{ always_allow: ['al,'], block: ['東京'] }, false, 'a mid-word always_allow alias does not bypass block'],
]) {
  equal(buildLocationFilter(config)(mixed, '', 'Engineer - Remote'), expected, label);
}
equal(buildLocationFilter({ allow: ['東京'] })('Montréal', '', 'Engineer - Remote'), true,
  'a remote title still satisfies allow after location blocks clear');
equal(buildLocationFilter({ allow: [null, 42, '', '  東京  '], block: [false, {}] })('東京'), true,
  'empty and non-string keywords remain harmless');
equal(buildLocationFilter({ allow: ' Montréal ' })('Montréal'), true,
  'a bare string keyword is still normalized');

// US always_allow expands to USPS abbreviations through a separate matcher.
// It needs Unicode boundaries too, while retaining its comma/trailing-token
// policy: ordinary interior words such as "or" must not stand for Oregon.
const usFilter = buildLocationFilter({
  always_allow: ['United States'],
  block: ['Dublin', 'Rome', 'Indian Head'],
});
for (const location of ['Dublin, OH', 'Dublin,OH, USA', 'Dublin OH.', 'Dublin Ohio', 'Rome, NY', 'Indian Head, MD']) {
  equal(usFilter(location), true, `a real US state still rescues ${location}`);
}
for (const location of [
  'Montréal', 'Montre\u0301al',
  '𐐀al', 'al𐐀', '٢al', 'al٢',
  'Canada, CAé', 'Canada, CA\u0301', 'Canada, CA𐐀', 'Canada, CA٢',
  'Remote, Belgium or France',
]) {
  const filter = buildLocationFilter({ always_allow: ['United States'], block: [location] });
  equal(filter(location), false, `US state abbreviations do not bypass the block on ${location}`);
}

const workday = 'https://acme.wd12.myworkdayjobs.com/careers/job/';
equal(buildLocationFilter({ always_allow: ['United States'], block: ['Canada'] })(
  '5 Locations', `${workday}Canada---Montr%C3%A9al/Eng_R1`), false,
  'a Unicode URL location cannot impersonate a US state abbreviation');
equal(usFilter('5 Locations', `${workday}Dublin-OH/Eng_R1`), true,
  'a real US state abbreviation in a URL still overrides a blocked city');
const titleOnly = `${workday}Scrum-Master---Technical-Project-Manager_R0073509`;
for (const suffix of ['', '/', '?source=India', '/?source=India#Paris', '//']) {
  equal(locationHintFromUrl(titleOnly + suffix), '', `title-only URL ${suffix || '(bare)'} has no location hint`);
  equal(issueFilter('', titleOnly + suffix), true, `title-only URL ${suffix || '(bare)'} preserves the missing-location escape hatch`);
}
for (const location of [undefined, null, 42, {}, ' \t ']) {
  equal(issueFilter(location, titleOnly), true, `missing/malformed location ${JSON.stringify(location)} still passes`);
}
equal(buildLocationFilter({ block: ['India'], allow: ['United States'] })('India', titleOnly), false,
  'title-only URLs do not override an explicit blocked location');

for (const [path, hint] of [
  ['Hyderabad-Telangana-India/Eng_R1', 'hyderabad telangana india'],
  ['USA---El-Segundo-CA/Eng_R1/', 'usa el segundo ca'],
  ['United_Arab+Emirates/Eng_R1', 'united arab emirates'],
  ['Montr%C3%A9al-Qu%C3%A9bec/Eng_R1', 'montréal québec'],
  ['%E6%9D%B1%E4%BA%AC/Eng_R1', '東京'],
  ['%E0%A4%A/Eng_R1', '%e0%a4%a'],
  ['ignored/job/Tokyo/Eng_R1', 'tokyo'],
]) {
  equal(locationHintFromUrl(workday + path), hint, `${path} retains the location hint`);
}
for (const url of [
  `${workday}ignored/job/Eng_R1/`,
  workday,
  workday.replace('/job/', '/jobs/'),
  'https://boards.greenhouse.io/acme/job/India/Eng_R1',
  'https://acme.myworkdayjobs.com.evil.example/c/job/India/Eng_R1',
  'https://notmyworkdayjobs.com/c/job/India/Eng_R1',
  'not a URL', '', null, 42,
]) {
  equal(locationHintFromUrl(url), '', `no hint from non-location URL ${JSON.stringify(url)}`);
}
equal(buildLocationFilter({ block: ['India'] })('5 Locations', `${workday}Hyderabad-India/Eng_R1`), false,
  'a real URL location still blocks rolled-up display locations');
equal(buildLocationFilter({ allow: ['al,'] })('5 Locations', `${workday}Montr%C3%A9al,-Quebec/Eng_R1`), false,
  'Unicode boundaries apply to decoded URL locations too');
equal(buildLocationFilter({ allow: ['東京'] })('', `${workday}%E6%9D%B1%E4%BA%AC/Eng_R1`), true,
  'an encoded allowed location still satisfies allow');
