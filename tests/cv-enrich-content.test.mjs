import { contentVolumeScore, enrichCvContent } from '../cv-enrich-content.mjs';
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
}
