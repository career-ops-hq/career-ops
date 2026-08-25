// tests/board-title-entities.test.mjs — boardTitleOwner() must decode the HTML
// entities a board page serves in its <title>.
//
// Ashby and Lever title the board after its owner, and a title is HTML: an
// ampersand in a company name arrives as `&amp;`, an apostrophe often as
// `&#39;`. boardTitleOwner reads the title as literal text, so the owner name it
// returns still carries the entity. boardIdentityMatches then compares that
// against the company name from portals.yml, which contains the real character,
// and the two never agree.
//
// The failure is a FALSE NEGATIVE in the guard #2937 added: a board that really
// does belong to the company is judged not to, so the slug repair it was meant
// to allow is refused. Every company whose name contains an ampersand is
// affected, which is not a rare shape.

import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const { boardTitleOwner, boardIdentityMatches } = await import(
  pathToFileURL(join(ROOT, 'verify-portals.mjs')).href
);

console.log('\nverify-portals.mjs — HTML entities in a board page title (#3155)');

const check = (desc, condition, details = '') => {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
};

// --- The entity is decoded out of the extracted owner name -------------------

const owner = (title) => boardTitleOwner(`<title>${title}</title>`);

check(
  'a named ampersand entity is decoded',
  owner('Hims &amp; Hers Jobs') === 'Hims & Hers',
  `got ${JSON.stringify(owner('Hims &amp; Hers Jobs'))}`,
);
check(
  'a numeric apostrophe entity is decoded',
  owner('Ben &amp; Jerry&#39;s Jobs') === "Ben & Jerry's",
  `got ${JSON.stringify(owner('Ben &amp; Jerry&#39;s Jobs'))}`,
);
check(
  'a hexadecimal numeric entity is decoded',
  owner('Ben &amp; Jerry&#x27;s Jobs') === "Ben & Jerry's",
  `got ${JSON.stringify(owner('Ben &amp; Jerry&#x27;s Jobs'))}`,
);

// Latin-1 letter entities. A European board writes `Soci&eacute;t&eacute;
// G&eacute;n&eacute;rale Careers`, and leaving those literal hits the same false
// negative an ampersand does. The shared decoder carries the full letter table.
check(
  'a Latin-1 letter entity is decoded',
  owner('Soci&eacute;t&eacute; G&eacute;n&eacute;rale Jobs') === 'Société Générale',
  `got ${JSON.stringify(owner('Soci&eacute;t&eacute; G&eacute;n&eacute;rale Jobs'))}`,
);
check(
  'Soci\u00e9t\u00e9 G\u00e9n\u00e9rale matches its own board title',
  boardIdentityMatches('Société Générale', owner('Soci&eacute;t&eacute; G&eacute;n&eacute;rale Jobs')),
);

// Letter entities are case-sensitive: `&Eacute;` is the capital. Looking the
// name up lowercased would decode it to the lowercase letter and quietly change
// a company's name.
check(
  'an uppercase letter entity keeps its case',
  owner('&Eacute;ditions Gallimard Jobs') === 'Éditions Gallimard',
  `got ${JSON.stringify(owner('&Eacute;ditions Gallimard Jobs'))}`,
);

// A double-encoded ampersand must decode exactly one level. Decoding `&amp;`
// before the other named entities would turn `&amp;lt;` into `<`, inventing
// markup the page never served.
check(
  'decoding runs one level only, so &amp;lt; becomes &lt; and not a bracket',
  owner('A &amp;lt; B Jobs') === 'A &lt; B',
  `got ${JSON.stringify(owner('A &amp;lt; B Jobs'))}`,
);

// --- The identity comparison the decode exists to serve ----------------------

const IDENTITY_CASES = [
  ['Hims &amp; Hers', 'Hims & Hers'],
  ['AT&amp;T', 'AT&T'],
  ['Smith &amp; Nephew', 'Smith & Nephew'],
  ['Johnson &amp; Johnson', 'Johnson & Johnson'],
  ['Ben &amp; Jerry&#39;s', "Ben & Jerry's"],
];

for (const [served, company] of IDENTITY_CASES) {
  const extracted = owner(`${served} Jobs`);
  check(
    `${company} matches its own board title`,
    boardIdentityMatches(company, extracted),
    `extracted ${JSON.stringify(extracted)}`,
  );
}

// --- Negative controls -------------------------------------------------------
// Without these the suite would pass on a boardTitleOwner that returned the
// company name unconditionally, or that decoded so aggressively it matched
// anything.

check(
  'a title with no entities is unchanged',
  owner('deepset Jobs') === 'deepset',
  `got ${JSON.stringify(owner('deepset Jobs'))}`,
);
check(
  'the jobs suffix is still stripped case-insensitively with surrounding space',
  owner('  Lever Demo 2 jobs ') === 'Lever Demo 2',
  `got ${JSON.stringify(owner('  Lever Demo 2 jobs '))}`,
);
check(
  'a page with no title still yields null',
  boardTitleOwner('<html><body>no title</body></html>') === null,
);
check(
  'a different employer still fails to match',
  !boardIdentityMatches('Mercury Systems', owner('Mercury &amp; Co Jobs')),
  `extracted ${JSON.stringify(owner('Mercury &amp; Co Jobs'))}`,
);
check(
  'an entity-only title does not decode into an empty owner treated as a match',
  boardIdentityMatches('Acme & Sons', owner('Acme &amp; Sons Jobs')) &&
    !boardIdentityMatches('Acme & Sons', owner('Globex &amp; Sons Jobs')),
);
