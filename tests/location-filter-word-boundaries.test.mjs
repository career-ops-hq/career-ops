// tests/location-filter-word-boundaries.test.mjs — the location filter must not
// anchor a keyword inside a word, and must not mistake a job title for a location.
//
// Both defects below drop IN-REGION postings silently: the scanner simply never
// writes them, so there is no skipped_* row and no counter to notice. They were
// found by re-running a 1,800-row scan-history ledger through the filters and
// asking which surviving rows the filter would now refuse.
//
// 1. ASCII-ONLY WORD BOUNDARIES. compileLocationKeyword anchored with
//    (?<![a-z0-9]) / (?![a-z0-9]). Those classes contain no accented letter, so
//    every accented character reads as a word boundary and a keyword can match
//    mid-word: "al," matches inside "montréal, quebec, can". The direction of
//    the failure matters — a stray match on an `allow` keyword ADMITS a location
//    the user blocks, which is the opposite of what an allow-list is for.
//
// 2. TITLE READ AS LOCATION. locationHintFromUrl recovers a location from the
//    path segment after /job/, for providers that report a rolled-up "N
//    Locations" display string. Workday has two URL shapes and only one carries
//    a location there; on /job/{Title}_{ReqId} the hint became the job title.
//    A title matches no `allow` keyword but IS non-empty, which defeats
//    buildLocationFilter's "nothing to judge on either field → pass" escape, so
//    a posting with an empty location field was rejected because of its title.

import { pass, fail } from './helpers.mjs';
import { buildLocationFilter, locationHintFromUrl } from '../scan.mjs';

console.log('\nLocation filter — word boundaries and URL location hints');

// The boundary hole is only observable when the ALLOW list is the thing
// deciding. `block` is evaluated first, so a config that also blocks "Canada"
// would reject "Montréal, Quebec, CAN" for the right reason and hide the bug —
// which is exactly how it survived. So: no block entry here, and a non-empty
// allow list, meaning anything that is not matched by a keyword must be
// rejected. State abbreviations anchored on the comma that FOLLOWS them are a
// real-world config shape ("Pittsburgh PA, 15222") and the one that reaches it.
const allowOnly = buildLocationFilter({ allow: ['United States', 'al,', 'pa,'] });
const check = (loc, want, why) => {
  const got = allowOnly(String(loc).toLowerCase(), '', '');
  if (got === want) pass(`${why}: ${JSON.stringify(loc)} → ${got}`);
  else fail(`${why}: ${JSON.stringify(loc)} → ${got}, expected ${want}`);
};

// (1) The regression. In "montréal," the keyword "al," is preceded by "é",
// which an ASCII-only lookbehind does not count as a word character — so the
// keyword anchors mid-word and ADMITS a location nothing in the config allows.
check('Montréal, Quebec, CAN', false, 'keyword must not anchor after an accented letter');
// The same keyword preceded by an ASCII letter was always handled correctly.
// Keeping both makes the asymmetry — the actual defect — explicit.
check('Canal, Panama', false, 'keyword must not anchor after an ASCII letter');

// …and the keywords still match the strings they were written for.
check('Pittsburgh PA, 15222', true, 'comma-terminated state abbreviation still matches');
check('Remote - United States', true, 'plain allow keyword still matches');

// `block` precedence is unchanged — asserted on its own config so it cannot
// mask the allow-list behaviour above.
const withBlock = buildLocationFilter({
  allow: ['United States', 'Remote'],
  block: ['Colombia', 'Canada'],
});
if (withBlock('co - remote - colombia', '', '') === false) pass('block still beats allow');
else fail('block no longer beats allow');

// (2) The URL hint must be a location or nothing — never a job title.
const hint = (url, want, why) => {
  const got = locationHintFromUrl(url);
  if (got === want) pass(`${why} → ${JSON.stringify(got)}`);
  else fail(`${why} → ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};

hint(
  'https://acme.wd12.myworkdayjobs.com/careers/job/Scrum-Master---Technical-Project-Manager_R0073509',
  '',
  'title-only /job/ shape yields no hint',
);
hint(
  'https://acme.wd12.myworkdayjobs.com/careers/job/North-Carolina/Program-Manager_R0073884',
  'north carolina',
  'location shape still yields the location',
);
hint(
  'https://acme.wd3.myworkdayjobs.com/c/job/Hyderabad-Telangana-India/Network-Engineer_R-65193-1',
  'hyderabad telangana india',
  'multi-word location still yields the location',
);

// The two combine: an empty location field plus a title-only URL must fall
// through to "nothing to judge on → pass", not be judged on the title.
const titleOnlyUrl =
  'https://acme.wd12.myworkdayjobs.com/careers/job/Scrum-Master---Technical-Project-Manager_R0073509';
if (allowOnly('', titleOnlyUrl, 'Scrum Master - Technical Project Manager') === true) {
  pass('empty location + title-only URL passes (no data is not bad data)');
} else {
  fail('empty location + title-only URL was rejected on the strength of its job title');
}
