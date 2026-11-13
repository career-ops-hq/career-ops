// Local-parser fixture board for the Startup Jobs teaser: runs the real
// Startup Jobs parser over a feed whose teasers state sponsorship, refuse it,
// or say nothing about it, so the scan sees exactly the Job objects the
// provider builds (teaser in `visaText`, no `description`).
import { parseStartupJobsFeed } from '../../providers/startup-jobs.mjs';

const item = (slug, role, teaser) => [
  `<item><title>${role} at Fixture Labs</title>`,
  `<link>https://startup.jobs/${slug}</link>`,
  `<description>${teaser}\n\nBerlin, Germany</description>`,
  '</item>',
].join('');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  item('sponsor', 'Backend Engineer', 'Build our payments API in Go; we offer visa sponsorship.'),
  item('refuse', 'Platform Engineer', 'Run our Kubernetes clusters. We cannot sponsor visas for this role.'),
  item('plain', 'Data Engineer', 'Own the warehouse and the pipelines that feed it.'),
  '</channel></rss>',
].join('');

console.log(JSON.stringify(parseStartupJobsFeed(xml)));
