import { pass, fail } from './helpers.mjs';
import { metricClaims } from '../verify-cv-facts.mjs';

console.log('\nA number about the addressed employer is not a candidate claim');

// A cover letter cites what the employer did ("your team ran four regional
// sessions in July"). cv.md can never contain that figure, so the gate blocked
// every letter that showed it had read about the company. The exemption keys on
// the nearest subject pronoun before the number being second person.
const exempt = [
  ['your team, spelled-out count', 'I read that your team ran four regional sessions in July.', '4 sessions'],
  ['possessive noun', 'Your roadshow ran four regional sessions in July.', '4 sessions'],
  ['you-subject', 'You shipped 12 integrations last quarter.', '12 integrations'],
  ["you've", "I noticed you've opened 3 offices this year.", '3 offices'],
  ['complementizer "that"', 'I read that your team ran four regional sessions in July.', '4 sessions'],
  ['complementizer "how"', 'I admire how your team grew to 12 offices.', '12 offices'],
  ['bare "you" after a complementizer', 'I noticed that you shipped 12 integrations.', '12 integrations'],
];
for (const [label, text, claim] of exempt) {
  const claims = metricClaims(text);
  if (!claims.has(claim)) pass(`employer figure is not extracted as a claim: ${label}`);
  else fail(`employer figure "${claim}" was treated as a candidate claim (${label}): ${JSON.stringify([...claims])}`);
}

// The candidate's own numbers must keep needing a source.
const kept = [
  ['plain first person', 'I ran four regional sessions in July.', '4 sessions'],
  ['your AFTER the number', 'I ran four regional sessions for your team.', '4 sessions'],
  ['no pronoun', 'Ran four regional sessions in July.', '4 sessions'],
  ['we', 'We ran four regional sessions with your team.', '4 sessions'],
  ['first person after your', 'Your team grew and I managed 5 people.', '5 people'],
  ['possessive object of a first-person verb', 'I managed your 12 engineers.', '12 engineers'],
  ['possessive inside a first-person object', 'I led your team of 12 engineers.', '12 engineers'],
  ['bare "you" as an object', 'I worked with you for 12 years.', '12 years'],
  ['complementizer not introducing "you"', 'I did it because of you for 12 years.', '12 years'],
  ['complementizer not introducing "your"', 'I said that all of your 12 engineers agreed.', '12 engineers'],
  // Deliberately conservative: "and you" cannot be told from an object ("Sam and
  // you"), and a wrongly checked number is safer than a wrongly skipped one.
  ['coordinated "and you" stays checked', 'I shipped 4 integrations and you shipped 12 integrations.', '12 integrations'],
  ['"and you" as an object', 'I thanked Sam and you for 12 years.', '12 years'],
];
for (const [label, text, claim] of kept) {
  const claims = metricClaims(text);
  if (claims.has(claim)) pass(`candidate claim is still extracted: ${label}`);
  else fail(`candidate claim "${claim}" slipped past the gate (${label}): ${JSON.stringify([...claims])}`);
}

// One clause can hold both: each number gets its own verdict.
const mixed = metricClaims('Your team ran four regional sessions and I have three years of experience.');
if (!mixed.has('4 sessions') && mixed.has('3 years')) {
  pass('a clause with an employer figure and a personal claim exempts only the first');
} else {
  fail(`mixed clause verdict is wrong: ${JSON.stringify([...mixed])}`);
}

// Scope is the clause: a "your" in a neighbouring clause or sentence must not
// silence an unrelated personal number.
const neighbours = [
  ['sentence', 'I admire your team. I ran four regional sessions in July.'],
  ['clause', 'I admire your team, and ran four regional sessions in July.'],
];
for (const [label, text] of neighbours) {
  const claims = metricClaims(text);
  if (claims.has('4 sessions')) pass(`a "your" in a neighbouring ${label} does not exempt the number`);
  else fail(`"your" in a neighbouring ${label} exempted a personal number: ${JSON.stringify([...claims])}`);
}
