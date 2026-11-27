// tests/scan-visa-refusals.test.mjs — visa_filter rejects a refusal that
// contains a positive keyword.
//
// Negatives are checked first and matching is a plain substring test, so
// "We are unable to offer visa sponsorship" used to pass strict mode on the
// positive "visa sponsorship" inside it: no negative covered that wording.
// The phrasings below are the ones measured in public postings, plus the
// common variants of each.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — visa_filter rejects refusals that contain a positive keyword');

const { buildVisaFilter, DEFAULT_VISA_NEGATIVE, DEFAULT_VISA_POSITIVE } =
  await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

const strict = buildVisaFilter({ enabled: true, require_mention: true });
const lenient = buildVisaFilter({ enabled: true });

const REFUSALS = [
  'Visa sponsorship is not offered for this role.',
  'Visa sponsorship not offered for this role.',
  'Visa sponsorship is not provided for this role.',
  'Visa sponsorship will not be provided.',
  'We are unable to offer visa sponsorship for this role in any of the listed locations.',
  "You'll need the independent right to work in the UK, as we're unfortunately unable to provide sponsorship at this time.",
  'We are unable to provide work visa sponsorship for this position.',
  'We are unable to support visa sponsorship or transfers at this time.',
  'We are not able to offer visa sponsorship at this time.',
  'We are not in a position to offer visa sponsorship.',
  'We do not provide visa sponsorship.',
  'This role does not support visa sponsorship and candidates must have the right to work in the UK.',
  "We can't offer visa sponsorship.",
  'We can’t offer visa sponsorship.',
  "We don't sponsor visas.",
  'We won’t sponsor visas for this role.',
  'We will not sponsor visas for this role.',
  'Visa sponsorship: we are not currently able to sponsor visas for fellows.',
  'This position is not eligible for visa sponsorship.',
  'This role is not eligible for sponsorship.',
  'Applicants must have work authorization that does not require sponsorship from the company now or in the future.',
  'Work authorization that does not require company sponsorship now or in the future.',
  'You must hold work authorisation that doesn’t require sponsorship.',
  'Applicants must not require visa sponsorship now or in the future.',
  'Candidates must not now or in the future require sponsorship for employment.',
  'Applicants must be legally authorized to work in the United States without requiring visa sponsorship now or in the future.',
  'Applicants must be authorized to work without the need for visa sponsorship by the start date.',
  'Must be legally eligible to work in Canada without requiring company sponsorship.',
  // Past the old 4,000-character Greenhouse cut (2026-11-26).
  'This position does not include visa sponsorship.',
  'You must be work authorized in the United States without the need for new visa sponsorship.',
  'As a result, visa sponsorship and relocation support are not available for this position.',
  'Visa Sponsorship is not offer for this position.',
];

// Postings that do offer sponsorship. Each must still pass strict mode, so no
// new negative may sit inside one of them.
const OFFERS = [
  'We offer visa sponsorship for this role.',
  'We are happy to provide visa sponsorship and relocation support.',
  'Visa sponsorship is available for exceptional candidates.',
  'We will sponsor your visa.',
  // A candidate who does not need sponsorship is welcome too. This is an
  // offer, so "not require sponsorship" on its own must not reject it.
  'We offer visa sponsorship to candidates who need it and welcome those who do not require sponsorship.',
  "We sponsor Blue Card visas, and candidates who don't need sponsorship are just as welcome.",
  'This role is eligible for sponsorship.',
  'We can support visa sponsorship for candidates outside the EU, including the EU Blue Card.',
  'We sponsor H-1B transfers.',
  // An offer that hedges. "aren't able to successfully sponsor" must not read
  // as a refusal.
  "Visa sponsorship: We do sponsor visas! However, we aren't able to successfully sponsor visas for every role and every candidate.",
  // Welcome text next to an offer. Only the measured requirement "work
  // authorized in the United States without the need for new visa
  // sponsorship" is a refusal.
  'We sponsor visas and welcome candidates who can work without needing new visa sponsorship.',
  'We sponsor visas and welcome candidates who can work without the need for new visa sponsorship.',
  // "include" refuses only visa sponsorship, not other kinds.
  'We offer visa sponsorship. The benefits package does not include sponsorship for conferences.',
  'Not sure whether you qualify? We provide visa sponsorship for every hire.',
];

{
  const kept = REFUSALS.filter(t => strict(t));
  if (kept.length === 0) pass(`strict mode rejects all ${REFUSALS.length} refusal phrasings`);
  else fail(`strict mode kept refusals: ${JSON.stringify(kept)}`);
}

{
  const kept = REFUSALS.filter(t => lenient(t));
  if (kept.length === 0) pass(`default mode rejects all ${REFUSALS.length} refusal phrasings`);
  else fail(`default mode kept refusals: ${JSON.stringify(kept)}`);
}

{
  const dropped = OFFERS.filter(t => !strict(t));
  if (dropped.length === 0) pass(`strict mode still keeps all ${OFFERS.length} postings that offer sponsorship`);
  else fail(`strict mode dropped postings that offer sponsorship: ${JSON.stringify(dropped)}`);
}

// A refusal followed by an offer elsewhere is still a refusal: negatives win,
// as they always have.
if (strict('We sponsor H-1B for US roles. Visa sponsorship is not offered for this role.') === false) {
  pass('a refusal still wins over a positive elsewhere in the posting');
} else {
  fail('a refusal should win over a positive elsewhere in the posting');
}

// Curly apostrophes are folded on both sides, so a keyword a user writes with
// a curly apostrophe matches text with a straight one, and the reverse.
{
  const custom = buildVisaFilter({ enabled: true, require_mention: true, negative: ['we don’t sponsor'], positive: ['sponsor'] });
  if (custom("Sadly we don't sponsor visas.") === false && custom('Sadly we don’t sponsor visas.') === false) {
    pass('a user keyword with a curly apostrophe matches either apostrophe');
  } else {
    fail('a user keyword with a curly apostrophe should match either apostrophe');
  }
}

{
  const bad = DEFAULT_VISA_NEGATIVE.filter(k => typeof k !== 'string' || k !== k.toLowerCase().trim() || k.includes('  ') || /[\u2018\u2019]/.test(k));
  const dupes = DEFAULT_VISA_NEGATIVE.filter((k, i, all) => all.indexOf(k) !== i);
  if (bad.length === 0 && dupes.length === 0) pass('DEFAULT_VISA_NEGATIVE is lowercase, trimmed, single-spaced and has no duplicates');
  else fail(`DEFAULT_VISA_NEGATIVE malformed: ${JSON.stringify({ bad, dupes })}`);
}

// No default negative may sit inside a default positive, or that positive
// could never match on its own.
{
  const shadowing = DEFAULT_VISA_NEGATIVE.filter(n => DEFAULT_VISA_POSITIVE.some(p => p.includes(n)));
  if (shadowing.length === 0) pass('no default negative is contained in a default positive');
  else fail(`default negatives contained in a positive: ${JSON.stringify(shadowing)}`);
}
