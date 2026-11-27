// tests/role-matcher-short-acronyms.test.mjs — a short acronym on each side is
// two openings, not one.
//
// roleTokens drops every word of three letters or fewer (bar a short list of
// specialty acronyms), which is right for prepositions and wrong for the codes
// employers use to split one title into many requisitions: a segment (DNB,
// FSI), a platform (AWS, GCP), a country or state (DE, HU, GA, OH). The pairs
// below tokenize identically, score a perfect Jaccard ratio and, with no URL or
// req number to separate them, make merge-tracker fold the second requisition
// into the first row.
//
// The acronym is read from the raw title and only when it is written in
// capitals inside a title that is not itself all capitals. Titles that differ
// by an acronym on one side only, or that state the same acronym, still match.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrole-matcher.mjs — a short acronym on each side keeps titles apart');

try {
  const { roleFuzzyMatch, extractShortAcronyms } = await import(
    pathToFileURL(join(ROOT, 'role-matcher.mjs')).href
  );

  const same = (label, a, b) => {
    if (roleFuzzyMatch(a, b) && roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should match (both orders)`);
  };
  const distinct = (label, a, b) => {
    if (!roleFuzzyMatch(a, b) && !roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should NOT match (both orders)`);
  };

  distinct('segment codes split',
    'Enterprise Account Executive - DNB', 'Enterprise Account Executive - FSI');
  distinct('platform codes split',
    'Cloud Platform Engineer (AWS)', 'Cloud Platform Engineer (GCP)');
  distinct('country codes split',
    'Customer Support Agent - DE', 'Customer Support Agent - HU');
  distinct('state codes split',
    'Territory Account Executive, Retail - Columbus, GA',
    'Territory Account Executive, Retail - Columbus, OH');
  distinct('a different code on each side splits even next to a shared one',
    'Solutions Architect, AI', 'Solutions Architect, SMB');

  distinct('codes are read in titles written in another script',
    'Μηχανικός Δεδομένων AWS', 'Μηχανικός Δεδομένων GCP');

  same('the same code on both sides still matches',
    'Senior Data Engineer (GCP)', 'Data Engineer - GCP');
  same('a code on one side only still matches',
    'Customer Success Manager (SMB)', 'Customer Success Manager - SMB (Remote)');
  same('lower-case gender markers are not codes',
    'Backend Engineer, Payments (m/f/d)', 'Backend Engineer, Payments (w/m/x)');
  same('an all-capitals title carries no code signal',
    'SENIOR SOFTWARE ENGINEER, PAYMENTS', 'SENIOR SOFTWARE ENGINEER, PAYMENTS PLATFORM');

  const codes = (t) => [...extractShortAcronyms(t)].sort().join(',');
  if (codes('Engineer (AWS/GCP), EMEA') === 'AWS,GCP') pass('acronyms are read from the raw title');
  else fail(`extractShortAcronyms: ${codes('Engineer (AWS/GCP), EMEA')}`);
  if (codes('Μηχανικός Δεδομένων AWS') === 'AWS') pass('acronyms are read in a title with Greek lower case');
  else fail(`extractShortAcronyms Greek: ${codes('Μηχανικός Δεδομένων AWS')}`);
  if (codes('ΜΗΧΑΝΙΚΟΣ ΔΕΔΟΜΕΝΩΝ AWS') === '') pass('an all-capitals Greek title carries no code signal');
  else fail(`extractShortAcronyms Greek capitals: ${codes('ΜΗΧΑΝΙΚΟΣ ΔΕΔΟΜΕΝΩΝ AWS')}`);
  if (codes('Engineer II (ALL GENDERS)') === '') pass('level and filler words are not codes');
  else fail(`extractShortAcronyms noise: ${codes('Engineer II (ALL GENDERS)')}`);
} catch (error) {
  fail(`role-matcher short-acronym tests could not run: ${error.message}`);
}
