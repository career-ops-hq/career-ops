// Local-parser fixture board for employment_type_filter: runs the real We Work
// Remotely parser over a feed whose items state a full-time, contract and
// part-time <type>, and one that states none, so the scan sees exactly the Job
// objects the provider builds (`employmentType` set from <type>, or absent).
import { parseWwrFeed } from '../../providers/weworkremotely.mjs';

const item = (slug, type) => [
  '<item>',
  `<title>Fixture Labs: ${slug} Engineer</title>`,
  '<region>Anywhere in the World</region>',
  '<category>Programming</category>',
  type ? `<type>${type}</type>` : '',
  `<link>https://weworkremotely.com/remote-jobs/fixture-labs-${slug}</link>`,
  '</item>',
].join('');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
  item('fulltime', 'Full-Time'),
  item('contract', 'Contract'),
  item('parttime', 'Part-Time'),
  item('untyped', ''),
  '</channel></rss>',
].join('');

console.log(JSON.stringify(parseWwrFeed(xml)));
