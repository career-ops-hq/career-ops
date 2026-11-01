import { pass, fail } from './helpers.mjs';
import { factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { buildHtml } from '../generate-cover-letter.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nAn employer named by "at <Name>, I ..."');

// The employer pattern reads a name only after "worked at", "joined", "Employer:"
// or "Company:". A letter usually says it another way, so a made-up employer in
// these sentences was never compared with cv.md (#6371):
//
//   "At Globex Corporation, I cut claim-form rendering 92%."
//   "In my current role as a Data Scientist at Globex, I have shipped ..."
//
// The other half of this file matters as much. A letter also names the company
// it is addressed to, which cv.md never contains, so a sentence that only
// mentions a company must stay unread or a truthful letter stops generating.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-at-employer-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  const writeConfig = (allowFacts = []) => writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: allowFacts, forbidden_phrases: [], warn_phrases: [] }));
  writeConfig();

  // Holds the metric in the reproduction, so an employer is all that can block it.
  const acmeCv = '### Acme Corp\n\n- Cut duplicate records 92%.';
  const check = (cv, target) => {
    writeFileSync(source, `${cv}\n`);
    return verifyFacts(target, { sourcePaths: [source], configPath: config });
  };
  const employers = text => factClaims(text).filter(claim => claim.kind === 'employer').map(claim => claim.value);
  const sameList = (found, expected) => JSON.stringify([...found].sort()) === JSON.stringify([...expected].sort());
  const claims = (label, text, expected) => {
    const found = employers(text);
    if (sameList(found, expected)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`);
  };
  const noClaim = (label, text) => claims(label, text, []);
  const blocksOn = (label, target, expected, cv = acmeCv) => {
    const result = check(cv, target);
    const found = result.unsupportedFacts.filter(claim => claim.kind === 'employer').map(claim => claim.value);
    if (result.verdict === 'block' && sameList(found, expected)) pass(label);
    else fail(`${label}: expected a block on ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };
  const passes = (label, target, cv = acmeCv) => {
    const result = check(cv, target);
    if (result.verdict === 'pass') pass(label);
    else fail(`${label}: expected a pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)} ${JSON.stringify(result.invented)}`);
  };

  // The reproduction from the issue, as a letter's HTML and with its control.
  blocksOn('the control: the same employer after "Worked at" blocks',
    '<p>Worked at Globex Corporation on billing.</p>', ['globex corporation']);
  blocksOn('the reproduction: "At Globex Corporation, I ..." blocks',
    '<html><body><p>At Globex Corporation, I cut duplicate records 92%.</p></body></html>', ['globex corporation']);

  // The sentence is what names the employer, wherever "at" falls in it. These are
  // the shapes real letters use, most often the first two.
  for (const [label, sentence] of [
    ['"In my current role as a ..."', 'In my current role as a Data Scientist at Globex, I have shipped three models.'],
    ['"In my current position as an ..."', 'In my current position as an Analyst at Globex, I have gained experience.'],
    ['"As a ..."', 'As a Data Scientist at Globex, I built three models.'],
    ['"As a current ..."', 'As a current Research Assistant at Globex, I have gained experience.'],
    ['"As <Title>" with no article', 'Currently, as Analytics Manager at Globex, I have led the team.'],
    ['"During my time at ..."', 'During my time at Globex, I led the migration.'],
    ['"During my tenure as a ..."', 'During my tenure as a Data Scientist at Globex, I have not only honed my skills.'],
    ['"In my previous roles at ..."', 'In my previous roles at Globex, I shipped three models.'],
    ['"My time at ..." opening the sentence', 'My time at Globex, I shipped three models.'],
    ['"While at ..."', 'While at Globex, I shipped three models.'],
    ['"Previously at ..."', 'Previously at Globex, I shipped three models.'],
    ['"I am a ... where I"', 'I am a Data Scientist at Globex, where I have enhanced the platform.'],
    ['"I am currently a ... where I"', 'I am currently a Senior Engineer at Globex, where I manage the platform.'],
    ['"I am employed at ... where I"', 'I am employed at Globex, where I oversee the platform.'],
    ['"I serve as a ... where I"', 'I serve as a Data Scientist at Globex, where I have enhanced the platform.'],
    ['"I hold the position of ... where I"', 'I hold the position of Lead Developer at Globex, where I have shipped.'],
    ['"With ... years at ..."', 'With five years at Globex, I have honed my skills.'],
    ['"including roles at ..."', 'With a degree and roles at Globex, I have honed my skills.'],
    ['a later clause joined by "and"', 'I built models, and at Globex, I led the team.'],
    ['a clause after a colon', 'Most relevant: at Globex, I led the team.'],
    ['a list item', '- At Globex, I led the team.'],
    ['a bold lead phrase', '<li><strong>At Globex,</strong> I led the team.</li>'],
    ['markdown bold', '**At Globex,** I led the team.'],
    ['"we"', 'At Globex, we shipped three models.'],
    ['no comma', 'At Globex I led the team.'],
    ['no comma with "we"', 'At Globex we shipped three models.'],
    ['"where I" after the name', 'At Globex, where I currently serve as a Data Scientist, I have shipped.'],
    ['a contraction', "At Globex, I've shipped three models."],
    ['a curly contraction', 'At Globex, I’ve shipped three models.'],
    ['"I\'d" with a past verb', "At Globex, I'd shipped three models."],
    ['an adverb before the verb', 'At Globex, I successfully shipped three models.'],
    ['"have" with an adverb', 'At Globex, I have also shipped three models.'],
    ['an irregular past', 'At Globex, I ran the team.'],
    ['a present verb of running work', 'At Globex, I manage a team of engineers.'],
    ['"currently" with a verb of running work', 'At Globex, I currently lead the team.'],
    ['"where I currently" with any verb', 'At Globex, where I currently excel as a Data Scientist, I have shipped.'],
    ['"was responsible for"', 'At Globex, I was responsible for billing.'],
    ['"was part of"', 'At Globex, I was part of the billing team.'],
    ['"were" with "we"', 'At Globex, we were responsible for billing.'],
    ['"was" with an adverb', 'At Globex, I was deeply involved in the migration.'],
    ['"have been responsible for"', 'In my current role at Globex, I have been responsible for billing.'],
    ['"have been" with a verb of running work', 'At Globex, I have been leading the team.'],
    ['"where I have been for"', 'I am currently working as a Data Scientist at Globex, where I have been for the past two years.'],
    ['"had the opportunity"', 'As a Data Scientist at Globex, I had the opportunity to lead the team.'],
    ['"have had the privilege"', 'Currently, as a Data Scientist at Globex, I have had the privilege of leading the team.'],
    ['"had the distinct pleasure"', 'During my tenure at Globex, I had the distinct pleasure of leading the team.'],
    ['"your" only after the clause', 'At Globex, I honed my skills, which I would bring to your team.'],
    ['"your" only in the next sentence', 'At Globex, I led the team. I would bring that to your team.'],
  ]) {
    claims(`${label} claims the employer`, sentence, ['globex']);
  }

  // What the name can be.
  claims('a name with a legal form', 'At Globex Inc., I led the team.', ['globex inc']);
  claims('"of" inside a name', 'At Bank of America, I led the team.', ['bank of america']);
  claims('"&" inside a name', 'At Johnson & Johnson, I led the team.', ['johnson & johnson']);
  claims('"&" without spaces', 'At AT&T, I led the team.', ['at&t']);
  claims('a dot inside a name', 'At Booking.com, I led the team.', ['booking.com']);
  claims('a possessive is read without its "s"', "At Macy's, I led the team.", ['macy']);
  claims('a curly possessive is read the same way', 'At Macy’s, I led the team.', ['macy']);
  claims('accented letters', 'At Société Générale, I led the team.', ['société générale']);
  claims('two employers are read apart', 'At Microsoft and Amazon, I led the team.', ['microsoft', 'amazon']);
  claims('"The" is not part of the name', 'At The Home Depot, I led the team.', ['home depot']);

  // A truthful letter still passes: the gate only asks that cv.md names it.
  passes('a backed employer passes', 'At Acme, I cut duplicate records 92%.');
  passes('a backed employer with its legal form passes', 'At Acme Corp, I cut duplicate records 92%.');
  passes('"The" does not stop a backed employer', 'At The Home Depot, I led the team.', '### Home Depot\n\n- Led the team.');
  passes('both of two backed employers pass', 'At Acme and Initech, I led the team.', '### Acme\n\n### Initech\n\n- Led the team.');
  passes('a curly apostrophe matches a straight one in cv.md', 'At Macy’s, I led the team.', "### Macy's\n\n- Led the team.");
  passes('a straight apostrophe matches a curly one in cv.md', "At Macy's, I led the team.", '### Macy’s\n\n- Led the team.');
  passes('a backed "&" name passes when the letter escapes it', '<p>At Johnson &amp; Johnson, I led the team.</p>', '### Johnson & Johnson\n\n- Led the team.');
  blocksOn('only the unbacked one of two employers blocks', 'At Acme and Globex, I led the team.', ['globex']);
  writeConfig(['globex']);
  passes('allow_facts covers a verified exception', 'At Globex, I led the team.');
  writeConfig();

  // The addressed company. None of these says the candidate worked there, and
  // cv.md will not name it. Each would block a truthful letter if it were read.
  for (const sentence of [
    'At Stripe, I would start by reading the incident reviews.',
    'At Stripe, I will start by reading the incident reviews.',
    "At Stripe, I'd start by reading the incident reviews.",
    "At Stripe, I'll start by reading the incident reviews.",
    'At Stripe, I can start right away.',
    'At Stripe, I could help the billing team.',
    'At Stripe, I hope to help the billing team.',
    'At Stripe, I want to help the billing team.',
    'At Stripe, I aim to help the billing team.',
    'At Stripe, I look forward to helping the billing team.',
    'At Stripe, I see an opening to help the billing team.',
    'At Stripe, I am eager to help the billing team.',
    "At Stripe, I'm eager to help the billing team.",
    'At Stripe, I have a strong interest in billing.',
    'At Stripe, I need a team that ships.',
    'At Stripe, I noticed your team moved to a monorepo.',
    'At Stripe, I admired how your team writes.',
    'At Stripe, I have appreciated how your team writes.',
    'At Stripe, I wanted to help the billing team.',
    'At Stripe, I hoped to help the billing team.',
    'At Stripe, I wished to help the billing team.',
    "At Stripe, I'd hoped to help the billing team.",
    'At Stripe, I was impressed by your Radar launch.',
    'At Stripe, I have been following your team.',
    'At Stripe, I learned how your team ships.',
    'At Stripe, I built a small demo for you.',
    'At Stripe, I had the pleasure of meeting your team.',
    'At Stripe, I was impressed by the Radar launch.',
    'At Stripe, I was deeply impressed by the Radar launch.',
    'At Stripe, I was drawn to the mission.',
    'At Stripe, I have been following the team.',
    'At Stripe, I have been reading the engineering blog.',
    'At Stripe, I had a chat with the team.',
    'At Stripe, I currently see an opportunity to contribute.',
    'At Stripe, I currently admire how the team writes.',
    'At Stripe, where I currently see your team shipping, the work is public.',
    'At Stripe, I did see an opening to help the billing team.',
    'At Stripe, you run payments for millions.',
    'At Stripe, your team runs payments for millions.',
    'At Stripe, the billing team moved to a monorepo.',
    'At Stripe, where the team ships daily, the work is public.',
    'As a Data Scientist at Stripe, I would start with the incident reviews.',
    'As a Data Scientist at Stripe, I will start with the incident reviews.',
    'In my role at Stripe, I would start with the incident reviews.',
    'I am a Data Scientist at Stripe, where I would start with the incident reviews.',
  ]) {
    noClaim(`intent, or a statement about the company, claims nothing: "${sentence}"`, sentence);
  }

  // A denial says the candidate did not work there, so blocking it would stop a
  // truthful letter. The last four use "not" or "n't", which the reader never accepted.
  for (const sentence of [
    'At Stripe, I have never worked as an employee.',
    'At Stripe, I never worked as an employee.',
    "At Stripe, I've never worked as an employee.",
    "At Stripe, I'd never worked as an employee.",
    'At Stripe, we never worked with the billing team.',
    'At Stripe, where I never worked, the work is public.',
    'As a contractor at Stripe, I never worked as an employee.',
    'At Stripe, I was never part of the team.',
    'At Stripe, I have never been part of the team.',
    'At Stripe, I did not work as an employee.',
    'At Stripe, we did not build the product.',
    'At Stripe, I have not worked as an employee.',
    "At Stripe, I haven't worked as an employee.",
    'At Stripe, I was not part of the team.',
    "At Stripe, I didn't work as an employee.",
  ]) {
    noClaim(`a denial claims nothing: "${sentence}"`, sentence);
  }
  passes('a denial about a company cv.md never names passes', 'At Stripe, I have never worked as an employee.');

  // A job word has to be what leads to the name. The first of these is from a
  // real letter: past tense, first person, and still about the addressed company.
  for (const sentence of [
    'Understanding the standards expected at Facebook, I have prepared carefully.',
    'After reading about the billing work at Stripe, I built a small demo.',
    'When I saw the opening at Stripe, I applied the same day.',
    'Having followed your team at Stripe, I learned how it ships.',
    'To show how I would improve developer experience at Stripe, I built a small demo.',
    'For the Data Scientist position at Stripe, I have prepared a small demo.',
    'I am interested in the role at Stripe, where I have applied twice.',
    'As a candidate for the role at Stripe, I have prepared a small demo.',
    'As an applicant to the team at Stripe, I have prepared a small demo.',
    'As a long-time user of the tools built at Stripe, I have written about them.',
    'As a result of the work at Stripe, I have changed how I test.',
    'As I read about the team at Stripe, I built a small demo.',
    'I see myself as a strong fit for the team at Stripe, where I have applied twice.',
    'I am a strong candidate for the team at Stripe, where I have applied twice.',
    'I am a big fan of the team at Stripe, where I have applied twice.',
    'As a developer impressed by your work at Stripe, I built a small demo.',
    'My interest in the role at Stripe, I have explained below.',
    'In my application for the role at Stripe, I have included a demo.',
    'Given my experience with payments and the team at Stripe, I have prepared a demo.',
    'Tools such as Terraform at Stripe, I have written about.',
    'Drawn to your mission as well as the culture at Stripe, I built a small demo.',
  ]) {
    noClaim(`no job statement before the name claims nothing: "${sentence}"`, sentence);
  }

  // Ordinary prose, from the issue and around it.
  for (const sentence of [
    'At scale, we shipped three models.',
    'At the time, I led the team.',
    'At least 3 services moved.',
    'At first, I led the team.',
    'At Globex',
    'Look at Globex, I led the team.',
    'We looked at Kafka, I led the migration.',
  ]) {
    noClaim(`ordinary prose claims nothing: "${sentence}"`, sentence);
  }

  // A sentence or line ending is not part of the name. The real letters these come
  // from read the name straight into the next line or sentence.
  noClaim('a period ends the name', 'As a Data Scientist at Amazon. I have shipped three models.');
  noClaim('a period ends the name before a capitalised word', 'As a Data Scientist at IBM. Previously, I have shipped three models.');
  noClaim('a line break ends the name', 'Subject: Applying as a Data Scientist at Google\n\nDear Hiring Manager,\n\nI have shipped three models.');
  noClaim('a block element ends the name', '<p>Applying as a Data Scientist at Google</p><p>Dear Hiring Manager,</p><p>I have shipped three models.</p>');
  noClaim('a job lead does not reach across a sentence', 'I am a Data Scientist. The standards expected at Facebook, I have prepared for.');
  noClaim('a job lead does not reach across a line', 'I am a Data Scientist\nThe standards expected at Facebook, I have prepared for.');

  // Each statement in a document is read on its own, and a repeat is one claim.
  claims('two employers in one sentence', 'At IBM, I honed my skills and at Microsoft, I gained experience.', ['ibm', 'microsoft']);
  claims('a repeated employer is one claim', 'At Globex, I led the team. At Globex, I shipped three models.', ['globex']);
  claims('the older trigger and the new one agree on one claim', 'I worked at Globex, where I led the team.', ['globex']);

  // The way a letter reaches the gate: rendered from its payload, addressed to a
  // company cv.md never names.
  const letter = fields => buildHtml({
    candidate: { name: 'Jane Doe' },
    letter: { role_title: 'Engineer', company: 'Stripe', city: 'Dublin', opening: 'I am applying for the Engineer role at Stripe.', profile_intro: 'Profile.', ...fields },
  });
  passes('a letter to a company cv.md never names passes',
    letter({ profile_intro: 'At Acme, I cut duplicate records 92%. At Stripe, I would start with the incident reviews.' }));
  blocksOn('a letter with a made-up employer blocks',
    letter({ profile_intro: 'In my current role at Globex, I cut duplicate records 92%. At Stripe, I would start with the incident reviews.' }), ['globex']);

  // Known limit, pinned so a change to it is deliberate. A sentence with no first
  // person after the name, or a descriptor inside it, stays unread, as on main.
  noClaim('known limit: no subject after the name', 'At Globex, cut duplicate records 92%.');
  noClaim('known limit: "my role" after the name', 'At Globex, my role involved billing.');
  noClaim('known limit: a descriptor after the name', 'At Globex in Berlin, I led the team.');
  noClaim('known limit: a present verb outside the list', 'As a Data Scientist at Globex, I tackle fraud.');
  noClaim('known limit: "currently" with a present verb outside the list', 'At Globex, I currently tackle fraud.');
  noClaim('known limit: "was" with a word outside the list', 'At Globex, I was the lead engineer.');
  noClaim('known limit: "your" in the clause that states the work', 'At Globex, I built the kind of tool your team uses.');
  noClaim('known limit: "never" with a verb that reports work', 'At Globex, I never missed a deadline.');
  noClaim('known limit: "never worked" on a subject, not for the company', 'At Globex, I never worked on payments.');
  noClaim('known limit: "did" with a plain object', 'At Globex, I did the migration.');
  claims('known limit: "nearly" is read like any other adverb', 'At Stripe, I nearly joined the team.', ['stripe']);

  // A page of hundreds of thousands of statements is read without overflowing the
  // call stack.
  try {
    claims('200,000 job statements are read without throwing', 'At Globex, I led the team. '.repeat(200000), ['globex']);
  } catch (error) {
    fail(`200,000 job statements threw: ${String(error.message).slice(0, 80)}`);
  }

  // Growth, not a wall-clock limit, as in verify-cv-facts-tool-fragments. Ten times
  // the input may take about ten times as long, and quadratic growth a hundred.
  const timed = (text) => {
    const started = performance.now();
    factClaims(text);
    return performance.now() - started;
  };
  for (const [label, unit, tail] of [
    ['a page of job statements with no sentence break', 'at Globex, I led ', ''],
    ['a long run of "as a"', 'as a ', 'at Globex, I led'],
    ['a long run of capitalised words', 'at Globex Corporation Holdings Group International Limited Partners ', 'I led'],
  ]) {
    const page = repeats => `${unit.repeat(repeats)}${tail}`;
    timed(page(200));
    const small = Math.max(timed(page(2000)), 1);
    const large = timed(page(20000));
    if (large < 1000 || large / small < 40) pass(`${label} is read in linear time`);
    else fail(`${label} scaled superlinearly: ${Math.round(small)} ms for 2,000, ${Math.round(large)} ms for 20,000`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
