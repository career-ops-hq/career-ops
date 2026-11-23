import { pass, fail } from './helpers.mjs';
import {
  buildSeekUrl,
  formatSeekLocation,
  parseSeekPage,
  resolveSeekSite,
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
check('AU posting URL uses the AU host', auOffers[0]?.url === 'https://au.seek.com/job/111', auOffers[0]?.url);
check('AU offers are tagged seek-au', auOffers[0]?.source === 'seek-au', auOffers[0]?.source);

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
