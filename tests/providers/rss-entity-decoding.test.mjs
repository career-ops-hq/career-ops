// tests/providers/rss-entity-decoding.test.mjs — the seven providers that
// carried a hand-rolled entity decoder emitted NUL / lone surrogates into job
// titles and silently deleted out-of-range references (#2790). They now share
// the safe decoder in providers/_html-entities.mjs, so their output must match
// it: any non-emittable reference is left as raw text, never a bad code unit.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProviders — entity decoding is illegal-code-point safe (#2790)');

const load = (f) => import(pathToFileURL(join(ROOT, 'providers/' + f)).href);
const { decodeEntities } = await load('_html-entities.mjs');

// A NUL or a *lone* surrogate must never reach a title. A valid supplementary
// character is a high surrogate immediately followed by a low surrogate, so a
// plain [\uD800-\uDFFF] class would false-positive on legitimate emoji/CJK-B —
// walk the string and only reject surrogates that are not part of a pair.
function hasNulOrLoneSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

// NUL, a lone surrogate, a C0 control, a noncharacter, and an out-of-range code
// point: the old decoder emitted the first four and deleted the last. The shared
// decoder leaves each reference as raw text.
const cases = ['A&#0;B', 'A&#xD800;B', 'A&#1;B', 'A&#xFFFF;B', 'A&#99999999;B'];

// Feed each case through getTitle(rawTitle) and check the result is exactly the
// shared decoder's output and free of NUL / lone surrogates.
function checkProvider(label, getTitle) {
  for (const raw of cases) {
    const input = `${raw} Engineer`;
    const title = getTitle(input) ?? '';
    if (hasNulOrLoneSurrogate(title)) {
      fail(`${label}: ${raw}: title contains a NUL or lone surrogate`);
      return;
    }
    if (title !== decodeEntities(input)) {
      fail(`${label}: ${raw}: got ${JSON.stringify(title)}, want ${JSON.stringify(decodeEntities(input))}`);
      return;
    }
  }
  pass(`${label} leaves illegal entity references as raw text`);
}

// ── RSS feed parsers ──
const rss = (title, link) =>
  `<?xml version="1.0"?><rss><channel><item>` +
  `<title>${title}</title><link>${link}</link>` +
  `<description>Location: Remote</description></item></channel></rss>`;

const rssProviders = [
  ['jobspresso.mjs', 'parseJobspressoFeed', 'https://jobspresso.co/job/x/'],
  ['higheredjobs.mjs', 'parseHigherEdJobsFeed', 'https://www.higheredjobs.com/details.cfm?JobCode=1'],
  ['nodesk.mjs', 'parseNodeskFeed', 'https://nodesk.co/remote-jobs/x/'],
  ['larajobs.mjs', 'parseLarajobsFeed', 'https://larajobs.com/job/1'],
  ['teamtailor.mjs', 'parseTeamtailorFeed', 'https://x.teamtailor.com/jobs/1'],
  ['weworkremotely.mjs', 'parseWwrFeed', 'https://weworkremotely.com/remote-jobs/x'],
];
for (const [file, fn, link] of rssProviders) {
  const parse = (await load(file))[fn];
  checkProvider(fn, (input) => parse(rss(input, link))[0]?.title);
}

// ── personio: title and location decode through the shared decoder on both the
// XML feed path (tagText → extractText) and the HTML-fallback path. ──
const { parsePersonioXml, parsePersonioHtml } = await load('personio.mjs');

checkProvider('parsePersonioXml', (input) =>
  parsePersonioXml(
    `<workzag-jobs><position><name>${input}</name><id>123</id><office>Remote</office></position></workzag-jobs>`,
    'Acme',
    'acme.jobs.personio.de',
  )[0]?.title,
);

checkProvider('parsePersonioHtml', (input) =>
  parsePersonioHtml(
    `<a class="job-box" href="/job/123"><h3>${input}</h3><span class="jobMetaText">Remote</span></a>`,
    'Acme',
    'acme.jobs.personio.de',
  )[0]?.title,
);
