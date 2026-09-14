// tests/plugins/gmail-linkedin-alert.test.mjs: the gmail plugin's LinkedIn
// job-alert path.
//
// A digest is ~6 unrelated postings in one email, and its per-job links are the
// only ones carrying a `trackingId` — which isCleanUrl rejects on the 'track'
// keyword. Run through the generic one-email-is-one-job path, a digest yielded
// every posting dropped and all the surrounding chrome (feed, messaging,
// promos) kept, each stamped with the subject line's company. These assertions
// pin the inverse.
import { pass, fail } from '../helpers.mjs';
import {
  parseLinkedInAlert, canonicalLinkedInJobUrl, isCleanUrl,
} from '../../plugins/gmail/_helpers.mjs';

const DIGEST = [
  'Your job alert for senior manager of customer success in Cambridge',
  'New jobs match your preferences.',
  '            ',
  'Senior Manager, Center of Expertise',
  'Veeam Software',
  'United States',
  'Fast growing',
  'View job: https://www.linkedin.com/comm/jobs/view/4430024078/?trackingId=abc%3D%3D&trk=eml-x',
  '',
  '---------------------------------------------------------',
  '            ',
  'Senior Manager, Customer Success - West',
  'Ladders',
  'United States',
  'View job: https://www.linkedin.com/comm/jobs/view/4465204159/?trackingId=def%3D%3D&trk=eml-x',
  '',
  '---------------------------------------------------------',
].join('\n');

const jobs = parseLinkedInAlert(DIGEST);

jobs.length === 2
  ? pass('linkedin alert: both cards parsed')
  : fail(`linkedin alert: expected 2 jobs, got ${jobs.length}`);

// The whole point: card 2 must not inherit card 1's company from the subject.
jobs[0]?.company === 'Veeam Software' && jobs[1]?.company === 'Ladders'
  ? pass('linkedin alert: per-card company, not one company for the whole email')
  : fail(`linkedin alert: wrong companies — ${JSON.stringify(jobs.map(j => j.company))}`);

jobs[0]?.title === 'Senior Manager, Center of Expertise'
  ? pass('linkedin alert: digest header is not mistaken for the first title')
  : fail(`linkedin alert: first title was ${JSON.stringify(jobs[0]?.title)}`);

jobs[0]?.location === 'United States'
  ? pass('linkedin alert: location read, badge line skipped')
  : fail(`linkedin alert: first location was ${JSON.stringify(jobs[0]?.location)}`);

// Tracking params differ per email, so the canonical form is what keeps the
// same posting from landing twice across two alerts.
jobs[0]?.url === 'https://www.linkedin.com/jobs/view/4430024078'
  ? pass('linkedin alert: url canonicalized, tracking params dropped')
  : fail(`linkedin alert: url was ${jobs[0]?.url}`);

canonicalLinkedInJobUrl('https://www.linkedin.com/comm/feed/?trk=eml-x') === ''
  ? pass('canonicalLinkedInJobUrl: non-job link rejected')
  : fail('canonicalLinkedInJobUrl: accepted a non-job link');

// Canonical URLs must survive the generic filter too — they are what the plugin
// emits, and a 'track'-keyword rejection here would empty the pipeline again.
isCleanUrl('https://www.linkedin.com/jobs/view/4430024078')
  ? pass('isCleanUrl: canonical linkedin job url passes')
  : fail('isCleanUrl: rejected a canonical linkedin job url');

['feed', 'messaging', 'mynetwork', 'notifications'].every(
  p => !isCleanUrl(`https://www.linkedin.com/comm/${p}/?trk=eml-x`),
)
  ? pass('isCleanUrl: linkedin digest chrome rejected')
  : fail('isCleanUrl: let digest chrome through');

parseLinkedInAlert('') .length === 0 && parseLinkedInAlert('no cards here').length === 0
  ? pass('linkedin alert: non-digest body yields nothing (generic path still runs)')
  : fail('linkedin alert: invented jobs from a non-digest body');
