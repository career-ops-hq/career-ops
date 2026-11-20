// tests/providers/personio-identity.test.mjs — a Personio posting's listingIdentity: its tenant and its numeric id.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — personio listingIdentity');

const mod = await import(pathToFileURL(join(ROOT, 'providers/personio.mjs')).href);
const personio = mod.default;
const { parsePersonioXml, parsePersonioHtml, personioListingIdentity } = mod;
const check = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: ${JSON.stringify(got)}`));
const idOf = (host, id) => ({ ats_provider: 'personio', board_slug: host.split('.')[0], posting_id: id });

// The careers page's payload, built as the main test builds it.
const flightPage = (...objects) => {
  const payload = `7:["$","div",null,{"jobs":[${objects.map((o) => JSON.stringify(o)).join(',')}]}]\n`;
  return `<html><body><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
};
const posting = (id, name, available = ['en'], current = 'en') => ({
  id: String(id), name, main_office: 'Berlin', additional_offices: [], available_languages: available, default_locale: available[0], current_locale: current, created_at: '2026-10-02T09:00:00Z',
});
const ctxOf = (pages) => ({ fetchText: async (url) => { if (!(url in pages)) throw Object.assign(new Error('404'), { status: 404 }); return pages[url]; } });

// The payload: the tenant on either domain, the numeric id.
const de = await personio.fetch({ name: 'Acme', careers_url: 'https://acme.jobs.personio.de' }, ctxOf({ 'https://acme.jobs.personio.de/': flightPage(posting(1834171, 'Engineer')) }));
check('payload, .de: tenant and id', de[0]?.listingIdentity, idOf('acme.jobs.personio.de', '1834171'));
const com = await personio.fetch({ name: 'Acme', careers_url: 'https://acme.jobs.personio.com' }, ctxOf({ 'https://acme.jobs.personio.com/': flightPage(posting(42, 'Designer')) }));
check('payload, .com: the same tenant label (the domain is the row\'s, not the identity\'s)', com[0]?.listingIdentity, idOf('acme.jobs.personio.com', '42'));
const pinned = await personio.fetch({ name: 'Acme', personio: 'acme', careers_url: 'https://www.acme.example/careers' }, ctxOf({ 'https://acme.jobs.personio.de/': flightPage(posting(7, 'Analyst')) }));
check('a pinned tenant on a branded page: the tenant, on .de', pinned[0]?.listingIdentity, idOf('acme.jobs.personio.de', '7'));

// A language in the careers URL changes the URL, never the identity.
const lang = await personio.fetch({ name: 'Acme', careers_url: 'https://acme.jobs.personio.de/?language=de' }, ctxOf({ 'https://acme.jobs.personio.de/?language=de': flightPage(posting(9, 'Ingenieur', ['de'], 'de')) }));
check('a language query: the same id, the URL keeps its language', [lang[0]?.listingIdentity?.posting_id, lang[0]?.url], ['9', 'https://acme.jobs.personio.de/job/9?language=de']);

// The XML feed and the HTML fallback give the same identity.
const xml = parsePersonioXml('<workzag-jobs><position><id>900100</id><office>Remote</office><name>Senior Engineer</name><createdAt>2025-01-02T09:00:00+00:00</createdAt></position></workzag-jobs>', 'Acme', 'acme.jobs.personio.de');
check('XML: tenant and id', xml[0]?.listingIdentity, idOf('acme.jobs.personio.de', '900100'));
const html = parsePersonioHtml('<a class="page_job__x job-box" href="/job/555"><div><h3 class="jb-title">Ops Lead</h3><span class="page_jobMetaText__y">Berlin</span></div></a>', 'Acme', 'acme.jobs.personio.de');
check('HTML fallback: tenant and id', html[0]?.listingIdentity, idOf('acme.jobs.personio.de', '555'));

// No identity: an id that is not all digits, or a host off Personio.
check('a non-numeric id: none', personioListingIdentity('acme.jobs.personio.de', '12a'), undefined);
check('a host off Personio: none', personioListingIdentity('acme.example.com', '12'), undefined);
check('an empty id: none', personioListingIdentity('acme.jobs.personio.de', ''), undefined);

