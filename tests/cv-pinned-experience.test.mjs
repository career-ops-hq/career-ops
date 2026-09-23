import {
  checkPinnedExperience,
  injectPinnedExperience,
  loadPinnedExperience,
  parseCvWorkExperience,
} from '../cv-pinned-experience.mjs';
import { pass, fail } from './helpers.mjs';

const base = {
  candidate: { name: 'Test' },
  summary: 'Summary',
  experience: [
    { company: 'SigmaX Labs', role: 'Founder', dates: '2024', bullets: ['Built tools.'] },
    { company: 'Deloitte USI', role: 'Consultant', dates: '2022', bullets: ['GxP work.'] },
  ],
};

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

console.log('cv-pinned-experience');
{
  const fromCv = parseCvWorkExperience();
  const required = loadPinnedExperience();
  ok('parses all cv.md employers', fromCv.length === required.length);
  ok('cv.md includes SigmaX Labs', fromCv.some((r) => /sigmax/i.test(r.company)));
  ok('cv.md includes Deloitte USI', fromCv.some((r) => /deloitte/i.test(r.company)));
  ok('cv.md includes The Goodtime Co.', fromCv.some((r) => /goodtime/i.test(r.company)));
  ok('cv.md includes Synergy Teletech', fromCv.some((r) => /synergy/i.test(r.company)));
  ok('cv.md includes InstaCure', fromCv.some((r) => /instacure/i.test(r.company)));

  ok('no pinned employer is absent from cv.md', required.every((p) => fromCv.some((r) => addressable(r.company, p.company))));

  const missing = checkPinnedExperience(base);
  ok('blocks when Synergy absent', missing.missing.some((m) => /synergy/i.test(m)));
  ok('blocks when InstaCure absent', missing.missing.some((m) => /instacure/i.test(m)));

  const { payload, injected } = injectPinnedExperience(base);
  ok('injects Synergy Teletech', injected.some((n) => /synergy/i.test(n)));
  ok('injects InstaCure', injected.some((n) => /instacure/i.test(n)));
  ok('injects The Goodtime Co.', injected.some((n) => /goodtime/i.test(n)));
  ok('payload has all five employers', payload.experience.length === 5);
  ok(
    'Synergy has at least one bullet',
    payload.experience.find((j) => /synergy/i.test(j.company))?.bullets?.length >= 1,
  );
  ok(
    'InstaCure has at least one bullet',
    payload.experience.find((j) => /instacure/i.test(j.company))?.bullets?.length >= 1,
  );

  const after = checkPinnedExperience(payload);
  ok('passes after inject', after.verdict === 'pass');
}

function addressable(a, b) {
  const n = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n(a) === n(b);
}
