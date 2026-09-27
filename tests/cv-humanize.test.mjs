import { humanizeCoverPayload, humanizeCvPayload, humanizeText, parseBannedWords } from '../cv-humanize.mjs';
import { mineKeywordsFromReports } from '../generate-master-cvs.mjs';
import { pass, fail } from './helpers.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

ok('humanize leverage', humanizeText('We leverage AI to optimize workflows').includes('use'));
ok('payload humanize', humanizeCvPayload({ summary: 'Furthermore, we leverage synergy.' }).payload.summary.length > 0);
ok('company name safe', humanizeCvPayload({
  experience: [{ company: 'Synergy Teletech Pvt Ltd', role: 'Field Executive', bullets: ['Led IoT.'] }],
}).payload.experience[0].company.includes('Synergy'));
ok('cover opening humanized', humanizeCoverPayload({
  candidate: { name: 'Jane' },
  letter: { role_title: 'PM', opening: 'Furthermore, we leverage synergy.', profile_intro: 'Hi.' },
}).payload.letter.opening.toLowerCase().includes('use'));
ok('cover company untouched', humanizeCoverPayload({
  candidate: { name: 'Jane' },
  letter: { role_title: 'PM', company: 'Synergy Partners', opening: 'Hi.', profile_intro: 'Hi.' },
}).payload.letter.company === 'Synergy Partners');
const mined = mineKeywordsFromReports();
ok('keyword mine', mined.general.size > 5);

// The §3A parser shipped inert for as long as it existed: its character class
// had no hyphen, so none of the hyphenated entries in the list could match and
// the layer reported a clean run having enforced nothing. The fixture below
// carries the hyphenated shape that broke it.
const parsed = parseBannedWords([
  '### 3A. Dead AI vocabulary',
  '',
  'Prose with commas, and words, and more that must not be swallowed.',
  '',
  'delve, cutting-edge, data-driven, state-of-the-art, robust, intricate/intricacies',
].join('\n'));
ok('3A parser loads the list', parsed.error === null && parsed.words.length === 6);
ok('3A parser keeps hyphenated entries',
  parsed.words.includes('cutting-edge') && parsed.words.includes('state-of-the-art') && parsed.words.includes('data-driven'));
ok('3A parser does not swallow prose', !parsed.words.some((w) => w.includes('swallowed')));
ok('3A parser reports a missing section', parseBannedWords('## 3. BANNED LIST').error !== null);
ok('3A parser reports an unparseable section',
  parseBannedWords('### 3A. Dead AI vocabulary\n\nNo comma list here.').error !== null);

// A banned word with no registered replacement used to be DELETED, leaving
// sentence holes. voice-dna §5 is explicit that a human decides these.
const unreplaced = [];
const kept = humanizeText('We align with the vibrant, dynamic landscape of delivery.', 't', unreplaced);
ok('unreplaced banned words are not deleted', !/\s{2,}/.test(kept) && /align/.test(kept) && /landscape/.test(kept));
ok('unreplaced banned words are reported', unreplaced.some((f) => f.rule === '3A' && f.severity === 'high'));

ok('double hyphen collapses in prose', humanizeText('Nov 2025 -- Present') === 'Nov 2025 - Present');
ok('double hyphen collapses in a dates field', humanizeCvPayload({
  experience: [{ company: 'Acme', role: 'PM', dates: 'Nov 2025 -- Present', bullets: ['Did things.'] }],
}).payload.experience[0].dates === 'Nov 2025 - Present');
ok('double hyphen collapses in education year', humanizeCvPayload({
  education: [{ org: 'Some University -- formerly Other', year: '2020 -- 2022' }],
}).payload.education[0].year === '2020 - 2022');
ok('url is not dash-mangled', humanizeCvPayload({
  candidate: { name: 'A', url: 'https://x.dev/a--b' },
}).payload.candidate.url === 'https://x.dev/a--b');

ok('rule-of-three headline is reported',
  humanizeCvPayload({ headline: 'Product | Delivery | AI' }).findings.some((f) => f.rule === '4B' && f.where === 'headline'));
ok('two-slot headline is not reported',
  !humanizeCvPayload({ headline: 'Product | Delivery' }).findings.some((f) => f.where === 'headline'));
ok('product name in a bullet is not a title-case finding',
  !humanizeCvPayload({
    experience: [{ company: 'Acme', role: 'PM', bullets: ['Shipped the Network Modelling Tool for the client.'] }],
  }).findings.some((f) => f.rule === '4K'));
ok('negative parallelism is auto-fixed not merely reported',
  !/not only/i.test(humanizeText('Not only did it scale, but also it shipped.')));
ok('unfixable negative parallelism is reported',
  humanizeText('This isn\'t a side project, it\'s the core product.', 't', [])
    && humanizeCvPayload({ summary: 'While this might seem right, growth is actually the real answer.' })
      .findings.some((f) => f.rule === '3F'));

