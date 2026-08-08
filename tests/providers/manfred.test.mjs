// tests/providers/manfred.test.mjs — provider-contract tests for the getManfred
// board-wide JSON feed (providers/manfred.mjs).
//
// The fixtures mirror shapes measured on the live feed on 2026-08-03, including
// the ones that decide the provider's design: a catalogue dominated by CLOSED
// entries, a symbol-not-ISO currency (with a narrow-no-break-space variant),
// placeless offers whose only place signal is remotePercentage, and updatedAt
// as the sole timestamp.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — manfred');

try {
  const manfredModule = await import(pathToFileURL(join(ROOT, 'providers/manfred.mjs')).href);
  const manfred = manfredModule.default;
  const { normalizeManfredOffer, normalizeCurrency, parseCompensation, resolveLocation, resolveLang } = manfredModule;

  if (manfred.id === 'manfred') pass('manfred.id is "manfred"');
  else fail(`manfred.id is ${JSON.stringify(manfred.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = manfred.detect({ name: 'getManfred', provider: 'manfred' });
  if (hit && hit.url === 'https://www.getmanfred.com/api/v2/public/offers?lang=EN') {
    pass('manfred.detect() resolves provider:manfred → feed URL with the required lang');
  } else {
    fail(`manfred.detect() returned ${JSON.stringify(hit)}`);
  }
  if (manfred.detect({ name: 'X' }) === null) pass('manfred.detect() returns null without provider:manfred');
  else fail('manfred.detect() should require provider:manfred');

  // lang: the API answers 400 without it, so it is always sent; only EN/ES exist.
  if (resolveLang({ lang: 'es' }) === 'ES' && resolveLang({ lang: 'FR' }) === 'EN' && resolveLang({}) === 'EN') {
    pass('resolveLang accepts EN/ES case-insensitively and falls back to EN');
  } else {
    fail(`resolveLang drift: ${resolveLang({ lang: 'es' })}/${resolveLang({ lang: 'FR' })}/${resolveLang({})}`);
  }

  const activeOffer = {
    id: 8417,
    position: '  Backend Engineer  ',
    slug: 'wuolah-backend-engineer-jul26',
    status: 'ACTIVE',
    company: { name: 'Wuolah' },
    locations: ['Madrid, Spain'],
    remotePercentage: 0,
    salaryFrom: 32000,
    salaryTo: 35000,
    currency: '€',
    updatedAt: '2026-07-31T10:53:31.241Z',
  };

  const n = normalizeManfredOffer(activeOffer, 'Fallback');
  if (n && n.title === 'Backend Engineer' && n.company === 'Wuolah'
      && n.url === 'https://www.getmanfred.com/ofertas-empleo/8417/wuolah-backend-engineer-jul26'
      && n.location === 'Madrid, Spain'
      && JSON.stringify(n.salary) === JSON.stringify({ min: 32000, max: 35000, currency: 'EUR' })) {
    pass('normalizeManfredOffer maps title/company/url/location/salary');
  } else {
    fail(`normalizeManfredOffer => ${JSON.stringify(n)}`);
  }

  // The single most important rule: the feed is a catalogue, and 1,604 of the
  // 1,628 entries measured were CLOSED. Without this filter the first scan
  // floods the pipeline with dead postings.
  if (normalizeManfredOffer({ ...activeOffer, status: 'CLOSED' }) === null) {
    pass('a CLOSED offer is dropped — the feed is a catalogue, not a live board');
  } else {
    fail('CLOSED offers must never reach the pipeline');
  }
  if (normalizeManfredOffer({ ...activeOffer, status: undefined }) === null) {
    pass('an offer with no status is dropped rather than assumed live');
  } else {
    fail('a status-less offer should be dropped');
  }

  // updatedAt is a modification time, not a publication date: mapping it to
  // postedAt would make an edited old posting look freshly published.
  if (n && !('postedAt' in n)) {
    pass('no postedAt is emitted — updatedAt is not a publication date');
  } else {
    fail(`postedAt must be omitted, got ${JSON.stringify(n?.postedAt)}`);
  }

  // Placeless offers: remote and hybrid stay distinguishable so a
  // location_filter.block: ["Hybrid"] rule can still act on them (#2258).
  const placeless = (remotePercentage) => resolveLocation({ locations: [], remotePercentage });
  if (placeless(100) === 'Remote' && placeless(60) === 'Hybrid' && placeless(40) === 'Hybrid' && placeless(0) === '') {
    pass('placeless offers derive Remote/Hybrid from remotePercentage, on-site keeps ""');
  } else {
    fail(`placeless location drift: ${JSON.stringify([placeless(100), placeless(60), placeless(40), placeless(0)])}`);
  }
  if (resolveLocation({ locations: ['Paris, France', 'Barcelona, Spain'], remotePercentage: 100 }) === 'Paris, France, Barcelona, Spain') {
    pass('listed locations win over the remote signal and are joined');
  } else {
    fail(`multi-location join => ${JSON.stringify(resolveLocation({ locations: ['Paris, France', 'Barcelona, Spain'], remotePercentage: 100 }))}`);
  }
  if (resolveLocation({ remotePercentage: 'oops' }) === '' && resolveLocation({}) === '') {
    pass('a missing or non-numeric remotePercentage yields "" rather than a guess');
  } else {
    fail('non-numeric remotePercentage must not invent a location');
  }

  // Currency arrives as a SYMBOL, and the live feed carries a narrow-no-break
  // space glued to it. scan.mjs's salary_filter compares currency strings, so a
  // symbol would never match a user's `currency: EUR`.
  if (normalizeCurrency('€') === 'EUR' && normalizeCurrency(' €') === 'EUR'
      && normalizeCurrency('£') === 'GBP' && normalizeCurrency('US$') === 'USD'
      && normalizeCurrency('MXN$') === 'MXN' && normalizeCurrency('EUR') === 'EUR') {
    pass('normalizeCurrency maps the observed symbols (spacing variants included) to ISO codes');
  } else {
    fail(`normalizeCurrency drift: ${JSON.stringify(['€', ' €', '£', 'US$', 'MXN$', 'EUR'].map(normalizeCurrency))}`);
  }
  if (normalizeCurrency('₿') === '' && normalizeCurrency(null) === '') {
    pass('an unknown currency symbol yields "" instead of a guess');
  } else {
    fail('unknown currency must not be guessed');
  }

  // salary: one-sided ranges are mirrored; no usable figure yields null, which
  // the salary filter treats as "no data" and passes.
  if (JSON.stringify(parseCompensation({ salaryFrom: 40000, currency: '€' })) === JSON.stringify({ min: 40000, max: 40000, currency: 'EUR' })) {
    pass('a one-sided salary range is mirrored into min and max');
  } else {
    fail(`one-sided salary => ${JSON.stringify(parseCompensation({ salaryFrom: 40000, currency: '€' }))}`);
  }
  if (parseCompensation({ salaryFrom: 0, salaryTo: 0 }) === null && parseCompensation({}) === null) {
    pass('a zero or absent salary yields null (the filter passes on no data)');
  } else {
    fail('zero/absent salary must yield null');
  }

  // drops: no title, no id, no slug — url is the dedup key and is never guessed
  if (normalizeManfredOffer({ ...activeOffer, position: '   ' }) === null) pass('normalizeManfredOffer drops a title-less offer');
  else fail('title-less offer should be dropped');
  if (normalizeManfredOffer({ ...activeOffer, id: undefined }) === null) pass('normalizeManfredOffer drops an offer with no id');
  else fail('id-less offer should be dropped');
  if (normalizeManfredOffer({ ...activeOffer, slug: '' }) === null) pass('normalizeManfredOffer drops an offer with no slug');
  else fail('slug-less offer should be dropped');

  // company falls back to the entry name
  const bare = normalizeManfredOffer({ ...activeOffer, company: null }, 'EntryName');
  if (bare?.company === 'EntryName') pass('normalizeManfredOffer falls back to the entry name for company');
  else fail(`company fallback => ${JSON.stringify(bare?.company)}`);

  // fetch() — single call (the endpoint has no pagination), host-pinned,
  // redirect:'error', and CLOSED entries filtered out of the result.
  const calls = [];
  const ctx = {
    transport: 'http',
    fetchJson: async (url, options) => {
      calls.push(url);
      if (options?.redirect !== 'error') throw new Error(`fetchJson without redirect:'error': ${JSON.stringify(options)}`);
      if (new URL(url).hostname !== 'www.getmanfred.com') throw new Error(`fetchJson off-host: ${url}`);
      return [activeOffer, { ...activeOffer, id: 8418, slug: 'other', status: 'CLOSED' }];
    },
    fetchText: async () => { throw new Error('fetchText should not be called'); },
  };
  const jobs = await manfred.fetch({ name: 'getManfred', provider: 'manfred' }, ctx);
  if (jobs.length === 1 && jobs[0].url.endsWith('/8417/wuolah-backend-engineer-jul26')) {
    pass('manfred.fetch() returns only ACTIVE offers');
  } else {
    fail(`manfred.fetch() returned ${JSON.stringify(jobs.map((j) => j.url))}`);
  }
  if (calls.length === 1 && calls[0] === 'https://www.getmanfred.com/api/v2/public/offers?lang=EN') {
    pass('manfred.fetch() makes exactly one request, with the required lang');
  } else {
    fail(`manfred.fetch() made ${calls.length} request(s): ${JSON.stringify(calls)}`);
  }

  // unexpected shape throws
  let threw = false;
  try {
    await manfred.fetch({ name: 'getManfred', provider: 'manfred' },
      { transport: 'http', fetchJson: async () => ({ offers: [] }), fetchText: async () => {} });
  } catch { threw = true; }
  if (threw) pass('manfred.fetch() throws on an unexpected API response shape');
  else fail('manfred.fetch() should throw when the response is not an array');

} catch (e) {
  fail(`manfred provider tests crashed: ${e.message}`);
}
