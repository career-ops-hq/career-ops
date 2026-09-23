import { humanizeCoverPayload, humanizeCvPayload, humanizeText } from '../cv-humanize.mjs';
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
