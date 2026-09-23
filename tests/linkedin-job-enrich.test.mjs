import {
  enrichJobList,
  isLinkedInJobUrl,
  parseLinkedInJobHtml,
  parseLinkedInOgTitle,
  rewritePipelineLine,
  titlesDiffer,
} from '../linkedin-job-enrich.mjs';
import { pass, fail } from './helpers.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

console.log('linkedin-job-enrich');

ok('detects linkedin job urls', isLinkedInJobUrl('https://www.linkedin.com/jobs/view/1234567890'));
ok('og parse company hiring', parseLinkedInOgTitle('Acme hiring Product Manager in Bengaluru | LinkedIn')?.company === 'Acme');

const html = `<meta property="og:title" content="Xurrent hiring Senior Product Manager (ITAM) in Bengaluru | LinkedIn">
<h1 class="top-card-layout__title">Senior Product Manager (ITAM)</h1>`;
const meta = parseLinkedInJobHtml(html);
ok('html parse title', meta.title === 'Senior Product Manager (ITAM)' && meta.company === 'Xurrent');

ok('titles differ', titlesDiffer('Product Manager', 'Senior Product Manager (ITAM)'));
ok('titles same-ish', !titlesDiffer('Product Manager', 'Product Manager - AI'));

const jobs = await enrichJobList(
  [{ url: 'https://www.linkedin.com/jobs/view/8888888888', title: 'Product Manager', company: '(LinkedIn)', location: '' }],
  {
    concurrency: 1,
    fetch: async () => ({
      ok: true,
      text: async () => html,
    }),
  },
);
ok('enrichJobList updates title/company', jobs[0].title === 'Senior Product Manager (ITAM)' && jobs[0].company === 'Xurrent');

ok('rewrite pipeline', rewritePipelineLine('- [ ] https://x | Co | Role', { title: 'New Role' }).includes('New Role'));
