// Local-parser fixture board for #6747: runs the real CryptocurrencyJobs
// parser over a feed whose teasers use the live clause shapes, so the scan
// sees exactly the Job objects the provider builds. One extra posting with a
// real description proves content_filter is active in the same run.
import { parseCryptocurrencyJobsRss } from '../../providers/cryptocurrencyjobs.mjs';

const item = (slug, role, teaser) => [
  `<item><title>${role} at Fixture Chain</title>`,
  `<link>https://example.invalid/jobs/${slug}</link>`,
  teaser === null ? '' : `<description>Fixture Chain is looking to hire a ${role} to join their team. ${teaser}</description>`,
  '</item>',
].join('');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  item('us-only', 'Protocol Engineer', 'This is a full-time position that can be done remotely anywhere in the United States.'),
  item('us-canada', 'Backend Engineer', 'This is a full-time position that can be done remotely anywhere in the United States, or Canada.'),
  item('worldwide', 'Platform Engineer', 'This is a contract position that is 100% remote with no geographical restrictions. Work remotely from anywhere.'),
  item('no-clause', 'Data Engineer', 'This is a full-time position'),
  '</channel></rss>',
].join('');

console.log(JSON.stringify([
  ...parseCryptocurrencyJobsRss(xml),
  {
    title: 'Frontend Engineer',
    url: 'https://example.invalid/jobs/with-jd',
    company: 'Fixture Chain',
    location: 'Remote',
    description: 'We build our frontend in TypeScript.',
  },
]));
