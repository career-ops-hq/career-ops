// tests/providers/rss-entity-decoding.test.mjs — the RSS providers that carried
// a hand-rolled entity decoder emitted NUL / lone surrogates into job titles and
// silently deleted out-of-range references (#2790). They now share the safe
// decoder in providers/_html-entities.mjs, so their output must match it.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProviders — RSS entity decoding is illegal-code-point safe (#2790)');

const load = (f) => import(pathToFileURL(join(ROOT, 'providers/' + f)).href);
const { decodeEntities } = await load('_html-entities.mjs');

const rss = (title, link) =>
  `<?xml version="1.0"?><rss><channel><item>` +
  `<title>${title}</title><link>${link}</link>` +
  `<description>Location: Remote</description></item></channel></rss>`;

const providers = [
  ['jobspresso.mjs', 'parseJobspressoFeed', 'https://jobspresso.co/job/x/'],
  ['higheredjobs.mjs', 'parseHigherEdJobsFeed', 'https://www.higheredjobs.com/details.cfm?JobCode=1'],
  ['nodesk.mjs', 'parseNodeskFeed', 'https://nodesk.co/remote-jobs/x/'],
  ['larajobs.mjs', 'parseLarajobsFeed', 'https://larajobs.com/job/1'],
  ['teamtailor.mjs', 'parseTeamtailorFeed', 'https://x.teamtailor.com/jobs/1'],
  ['weworkremotely.mjs', 'parseWwrFeed', 'https://weworkremotely.com/remote-jobs/x'],
];

// NUL, a lone surrogate, a C0 control, a noncharacter, and an out-of-range code
// point: the old decoder emitted the first four and deleted the last. The
// shared decoder leaves each reference as raw text.
const cases = ['A&#0;B', 'A&#xD800;B', 'A&#1;B', 'A&#xFFFF;B', 'A&#99999999;B'];

for (const [file, fn, link] of providers) {
  const parse = (await load(file))[fn];
  let ok = true;
  let detail = '';
  for (const raw of cases) {
    const input = `${raw} Engineer`;
    const title = parse(rss(input, link))[0]?.title ?? '';
    if (/[\u0000\uD800-\uDFFF]/.test(title)) {
      ok = false;
      detail = `${raw}: title contains a NUL or lone surrogate`;
      break;
    }
    if (title !== decodeEntities(input)) {
      ok = false;
      detail = `${raw}: got ${JSON.stringify(title)}, want ${JSON.stringify(decodeEntities(input))}`;
      break;
    }
  }
  if (ok) pass(`${fn} leaves illegal entity references as raw text`);
  else fail(`${fn}: ${detail}`);
}
