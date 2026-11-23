import { pass, fail } from './helpers.mjs';
import {
  buildSeekUrl,
  formatSeekLocation,
  parseSeekPage,
  resolveSeekSite,
  scanSeekSearch,
  SEEK_SITES,
} from '../scan-seek.mjs';

console.log('\nSEEK site support (NZ + AU)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const au = resolveSeekSite('au');
const nz = resolveSeekSite('nz');

check('resolveSeekSite defaults to NZ', resolveSeekSite(undefined) === SEEK_SITES.nz, 'default is not NZ');
check('resolveSeekSite accepts au', au === SEEK_SITES.au, 'au did not resolve');
check(
  'resolveSeekSite accepts a host spelling',
  resolveSeekSite('au.seek.com') === SEEK_SITES.au,
  'host spelling did not resolve',
);
let threw = false;
try {
  resolveSeekSite('uk');
} catch {
  threw = true;
}
check('resolveSeekSite rejects an unknown site', threw, 'unknown site was accepted');
for (const key of ['constructor', '__proto__']) {
  threw = false;
  try {
    resolveSeekSite(key);
  } catch {
    threw = true;
  }
  check(`resolveSeekSite rejects the prototype key ${key}`, threw, `${key} resolved to an inherited member`);
}

// A host spelling is accepted only as that site's exact host; the old
// suffix-stripping lookup coerced `seek.com`/`au.seek.com.au` into a valid key.
check('resolveSeekSite accepts https://au.seek.com/', resolveSeekSite('https://au.seek.com/') === SEEK_SITES.au, 'scheme + trailing slash did not resolve');
check('resolveSeekSite accepts AU.SEEK.COM', resolveSeekSite('AU.SEEK.COM') === SEEK_SITES.au, 'uppercase host did not resolve');
for (const bad of ['seek.com', 'uk.seek.com', 'au.seek.com.au', 'evil.com/au']) {
  threw = false;
  try {
    resolveSeekSite(bad);
  } catch (err) {
    threw = err.message.includes('Unknown seek_site') && err.message.includes(bad);
  }
  check(`resolveSeekSite rejects ${bad}`, threw, `${bad} was coerced into a site key`);
}

check(
  'AU location uses the in- segment',
  buildSeekUrl({ keyword: 'business analyst', location: 'Adelaide' }, { site: au }) ===
    'https://au.seek.com/business-analyst-jobs/in-Adelaide-SA',
  buildSeekUrl({ keyword: 'business analyst', location: 'Adelaide' }, { site: au }),
);
check(
  'NZ location is unchanged',
  buildSeekUrl({ keyword: 'data analyst', location: 'Wellington' }, { site: nz }) ===
    'https://nz.seek.com/data-analyst-jobs/in-All-Wellington',
  buildSeekUrl({ keyword: 'data analyst', location: 'Wellington' }, { site: nz }),
);
check(
  'a bare number still means daterange, on NZ',
  buildSeekUrl({ keyword: 'pm' }, 7, 2) === 'https://nz.seek.com/pm-jobs?daterange=7&page=2',
  buildSeekUrl({ keyword: 'pm' }, 7, 2),
);
check(
  'the country name drops the location segment',
  buildSeekUrl({ keyword: 'ba', location: 'australia' }, { site: au }) === 'https://au.seek.com/ba-jobs',
  buildSeekUrl({ keyword: 'ba', location: 'australia' }, { site: au }),
);
check(
  'a canonical in- slug passes through',
  formatSeekLocation('in-Adelaide-SA', au) === 'in-Adelaide-SA',
  formatSeekLocation('in-Adelaide-SA', au),
);
// City slugs are the short `<City>-<STATE>` form; state-wide ones are
// `in-<State-Name>` / `in-<ABBR>` — never `in-All-<State>`, which returns zero.
for (const [input, expected] of [
  ['Sydney NSW', 'in-Sydney-NSW'],
  ['NSW', 'in-NSW'],
  ['Victoria', 'in-Victoria'],
  ['Gold Coast', 'in-Gold-Coast-QLD'],
  ['South Australia', 'in-South-Australia'],
]) {
  check(
    `AU location ${JSON.stringify(input)} → ${expected}`,
    formatSeekLocation(input, au) === expected,
    formatSeekLocation(input, au),
  );
}
threw = false;
try {
  formatSeekLocation('Wellington', au);
} catch {
  threw = true;
}
check('an unmapped AU location throws instead of guessing', threw, 'plain unknown location was accepted');

// AU records nest the place under locations[].label; NZ carries `location`.
const auHtml = `<script>window.SEEK_REDUX_DATA = {"results":{"results":{"jobs":[
  {"id":111,"title":"Business Systems Analyst","advertiser":{"description":"Plenti"},
   "locations":[{"label":"Adelaide SA"}],"listingDate":"2026-11-03T08:39:07.000Z"}
]}}};</script>`;
const nzHtml = `<script>window.SEEK_REDUX_DATA = {"results":{"jobs":[
  {"id":222,"title":"Data Analyst","advertiser":{"description":"Acme"},"location":"Wellington","listingDate":"2026-11-04"}
]}};</script>`;

const auOffers = parseSeekPage(auHtml, au);
check('AU job is parsed', auOffers.length === 1, `got ${auOffers.length}`);
check('AU location comes from locations[].label', auOffers[0]?.location === 'Adelaide SA', auOffers[0]?.location);
check('AU posting URL uses the www host', auOffers[0]?.url === 'https://www.seek.com.au/job/111', auOffers[0]?.url);
check('AU offers are tagged seek-au', auOffers[0]?.source === 'seek-au', auOffers[0]?.source);

// The posting host differs from the fetch host on AU: www 403s a plain fetch.
const fetched = [];
await scanSeekSearch(
  { keyword: 'business analyst', location: 'Sydney NSW' },
  { site: au, maxPages: 1, fetchText: async (url) => { fetched.push(url); return auHtml; } },
);
check(
  'AU scans still fetch from au.seek.com',
  fetched[0] === 'https://au.seek.com/business-analyst-jobs/in-Sydney-NSW',
  fetched[0],
);

const nzOffers = parseSeekPage(nzHtml, nz);
check('NZ job is parsed', nzOffers.length === 1, `got ${nzOffers.length}`);
check('NZ location is read from location', nzOffers[0]?.location === 'Wellington', nzOffers[0]?.location);
check('NZ offers stay tagged seek-nz', nzOffers[0]?.source === 'seek-nz', nzOffers[0]?.source);

threw = false;
try {
  parseSeekPage('<html>nothing here</html>', au);
} catch {
  threw = true;
}
check('a page without the Redux dump fails loudly', threw, 'missing dump returned instead of throwing');
