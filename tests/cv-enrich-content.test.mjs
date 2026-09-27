import { contentVolumeScore, durationMonths, enrichCvContent, fillPriority } from '../cv-enrich-content.mjs';
import { pass, fail } from './helpers.mjs';

const sparse = {
  candidate: { name: 'Test' },
  summary: 'Short summary.',
  experience: [
    { company: 'SigmaX Labs', role: 'Founder', dates: '2024', bullets: ['Built kbcompress.com.'] },
    { company: 'Deloitte USI', role: 'Consultant', dates: '2022', bullets: ['SPARK MVP.'] },
    { company: 'Synergy Teletech Pvt Ltd', role: 'Field Executive', dates: '2017', bullets: ['IoT trucks.'] },
    { company: 'InstaCure', role: 'Business Associate', dates: '2016', bullets: ['Sales ops.'] },
  ],
  projects: [],
  skills: [],
};

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

console.log('cv-enrich-content');
{
  const before = contentVolumeScore(sparse);
  ok('sparse payload below target', before < 3600);

  const { payload, added, scoreAfter } = enrichCvContent(sparse);
  ok('adds verified content', added.length > 0);
  ok('score increases', scoreAfter > before);
  ok('SigmaX gets more bullets', payload.experience.find((j) => /sigmax/i.test(j.company))?.bullets?.length > 1);
  ok('adds projects when sparse', (payload.projects || []).length >= 2);
  ok('adds skills from cv.md', (payload.skills || []).length >= 3);
  ok('still has all employers', payload.experience.length === 4);

  // The backfill pool must stay own-work only. SPARK Analytics MVP and the
  // Donor Engagement Portal are Deloitte deliveries: they were badged
  // "Regulated Industry" and "Bilingual" here, naming no client, so a sparse
  // tailored CV presented them as personal builds.
  const names = (payload.projects || []).map((p) => p.name);
  ok('backfill never injects a client engagement', !names.some((n) => /spark|donor engagement/i.test(n)));
  ok('backfill pool carries ClearState', names.includes('ClearState'));

  // The pool must be able to satisfy enrichCvContent's own 3-project floor,
  // or a sparse tailored CV silently ships with fewer projects.
  ok('backfill reaches 3 own-work projects', names.length >= 3);
  ok('every backfilled project is a known own-work build',
    names.every((n) => /kbcompress|hermes|clearstate/i.test(n)));
}

console.log('cv-enrich-content: fill order');
{
  const now = new Date(2026, 8, 28);

  ok('durations parse for a closed range', durationMonths('Sep 2022 -- Oct 2024', now) === 26);
  ok('durations parse for a single-hyphen range', durationMonths('Sep 2022 - Oct 2024', now) === 26);
  ok('durations parse an en-dash range', durationMonths('Sep 2022 – Oct 2024', now) === 26);
  ok('Present resolves to now', durationMonths('Nov 2025 -- Present', now) === 11);
  ok('Present resolves with a single hyphen', durationMonths('Nov 2025 - Present', now) === 11);
  ok('bare years degrade to whole-year spans', durationMonths('2022 - 2024', now) === 24);
  ok('unparseable dates are 0, not NaN', durationMonths('garbage', now) === 0);
  ok('empty dates are 0, not NaN', durationMonths('', now) === 0);

  // Duration alone would put Synergy Teletech (25mo) and InstaCure (13mo) ahead
  // of the current founder role (11mo), so a recovered page could be spent on
  // decade-old field-exec bullets. The candidate's own ventures and the
  // regulated moat fill first; duration only breaks ties within tier 2.
  const roles = [
    { company: 'Synergy Teletech Pvt Ltd', dates: 'Jun 2017 -- Jun 2019' },
    { company: 'SigmaX Labs', dates: 'Nov 2025 -- Present' },
    { company: 'InstaCure', dates: 'May 2016 -- May 2017' },
    { company: 'Deloitte USI', dates: 'Sep 2022 -- Oct 2024' },
    { company: 'The Goodtime Co.', dates: 'May 2025 -- Oct 2025' },
  ];
  const order = fillPriority(roles, now).map((r) => r.company);
  ok('protected tier fills first', order.slice(0, 3).every((c) => /sigmax|goodtime|deloitte/i.test(c)));
  ok('longest tenure leads the protected tier', order[0] === 'Deloitte USI');
  ok('the shortest venture still outranks a longer stale role',
    order.indexOf('The Goodtime Co.') < order.indexOf('Synergy Teletech Pvt Ltd'));
  ok('tier 2 is duration-ranked', order.indexOf('Synergy Teletech Pvt Ltd') < order.indexOf('InstaCure'));
  ok('fillPriority does not mutate its input',
    roles.map((r) => r.company)[0] === 'Synergy Teletech Pvt Ltd');
}
