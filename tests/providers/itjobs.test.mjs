// tests/providers/itjobs.test.mjs — provider-contract tests for the ITJobs
// (itjobs.pt) board-wide RSS provider (providers/itjobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — itjobs');

// Items in the feed's real shape (measured 2026-11-23); names are fictional.
function item({ title, link, fields, pubDate = 'Mon, 23 Nov 2026 13:42:24 +0000' }) {
  const description = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('<br />\n');
  return `    <item>
      <title><![CDATA[${title}]]></title>
      <link>${link}</link>
      <description><![CDATA[${description}]]></description>
      <guid isPermaLink="false">${link}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>\n`;
}

function feed(items) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>ITJobs - Pesquisa em emprego</title>
    <link>https://www.itjobs.pt/feed/emprego</link>
    <language>pt</language>
${items.join('')}  </channel>
</rss>`;
}

const FULL = {
  'Função': 'Data Engineer',
  Empresa: 'Acme Lda',
  Tipo: 'Full-time',
  Contrato: 'Contrato sem termo',
  Localidade: 'Lisboa, Porto',
  'Modelo de trabalho': 'Híbrido',
  'Salário anual': 'n/d',
};

const SAMPLE = feed([
  item({ title: 'Data Engineer', link: 'https://www.itjobs.pt/oferta/100/data-engineer', fields: FULL }),
  item({
    title: 'R&amp;D Developer',
    link: 'https://www.itjobs.pt/oferta/101/rd-developer?utm_source=x',
    fields: { 'Função': 'R&D Developer', Empresa: 'ExampleCo &amp; Partners', Tipo: 'n/d', Contrato: 'n/d', Localidade: 'n/d', 'Modelo de trabalho': 'Remoto', 'Salário anual': '€30&#160;000 - €40&#160;000' },
    pubDate: 'not a date',
  }),
  item({ title: 'Support Technician', link: 'https://www.itjobs.pt/oferta/102/support', fields: { ...FULL, Tipo: 'Part-time', Localidade: 'Aveiro', 'Modelo de trabalho': 'Presencial' } }),
  item({ title: 'No Employer', link: 'https://www.itjobs.pt/oferta/103/x', fields: { ...FULL, Empresa: 'n/d' } }),
  item({ title: 'Off Site', link: 'https://evil.example.com/oferta/104/x', fields: FULL }),
  item({ title: 'Plain HTTP', link: 'http://www.itjobs.pt/oferta/105/x', fields: FULL }),
]);

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/itjobs.mjs')).href);
  const itjobs = mod.default;
  const { parseItjobsFeed, parseFields } = mod;

  if (itjobs.id === 'itjobs') pass('itjobs.id is "itjobs"');
  else fail(`itjobs.id is ${JSON.stringify(itjobs.id)}`);

  // ── detect: explicit provider only ──
  const hit = itjobs.detect({ name: 'ITJobs', provider: 'itjobs' });
  if (hit && hit.url === 'https://feeds.itjobs.pt/feed/emprego?limit=5000') pass('detect() resolves provider:itjobs → the board-wide feed');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  for (const [label, entry] of [
    ['no provider field', { name: 'ITJobs', careers_url: 'https://www.itjobs.pt/' }],
    ['a different provider', { provider: 'landingjobs' }],
    ['null', null],
    ['a non-object', 'itjobs'],
  ]) {
    if (itjobs.detect(entry) === null) pass(`detect() returns null for ${label}`);
    else fail(`detect() claimed ${label}`);
  }

  // ── parseFields ──
  const f = parseFields('Empresa: Acme<br />Tipo: n/d<br/>Localidade : Lisboa<br>Sem rótulo');
  if (f.get('empresa') === 'Acme' && !f.has('tipo') && f.get('localidade') === 'Lisboa' && f.size === 2) {
    pass('parseFields reads "Label: value" lines and treats n/d as absent');
  } else {
    fail(`parseFields returned ${JSON.stringify([...f])}`);
  }

  // ── parseItjobsFeed ──
  const { jobs, rawCount } = parseItjobsFeed(SAMPLE);
  if (rawCount === 6 && jobs.length === 3) pass('parse: rows with no employer, an off-site link or a non-https link are dropped');
  else fail(`parse: ${jobs.length} of ${rawCount} rows kept`);
  const [a, b, c] = jobs;
  if (a.title === 'Data Engineer' && a.company === 'Acme Lda' && a.url === 'https://www.itjobs.pt/oferta/100/data-engineer') {
    pass('parse: title, employer and offer URL');
  } else {
    fail(`parse: first row ${JSON.stringify(a)}`);
  }
  if (a.location === 'Lisboa, Porto' && JSON.stringify(a.locations) === '["Lisboa","Porto"]') pass('parse: several places become locations[]');
  else fail(`parse: locations ${JSON.stringify(a)}`);
  if (c.location === 'Aveiro' && JSON.stringify(c.locations) === '["Aveiro"]') pass('parse: a single place sets location and locations[]');
  else fail(`parse: single place ${JSON.stringify(c)}`);
  if (a.workplaceType === 'hybrid' && b.workplaceType === 'remote' && c.workplaceType === 'onsite') pass('parse: Modelo de trabalho maps to workplaceType');
  else fail(`parse: workplaceType ${[a, b, c].map((j) => j.workplaceType).join(',')}`);
  if (a.employmentType === 'full_time' && c.employmentType === 'part_time' && !('employmentType' in b)) pass('parse: Tipo maps to employmentType, n/d leaves it off');
  else fail(`parse: employmentType ${[a, b, c].map((j) => j.employmentType).join(',')}`);
  if (b.title === 'R&D Developer' && b.company === 'ExampleCo & Partners') pass('parse: entities in title and employer are decoded');
  else fail(`parse: entities ${JSON.stringify(b)}`);
  if (b.url === 'https://www.itjobs.pt/oferta/101/rd-developer') pass('parse: the query string is dropped from the offer URL');
  else fail(`parse: url ${b.url}`);
  if (b.location === 'Remote' && !('locations' in b) && !('postedAt' in b)) pass('parse: a remote row with n/d location reads "Remote", and an invalid pubDate leaves postedAt unset');
  else fail(`parse: n/d / date ${JSON.stringify(b)}`);
  if (a.postedAt === Date.parse('Mon, 23 Nov 2026 13:42:24 +0000')) pass('parse: pubDate becomes postedAt');
  else fail(`parse: postedAt ${a.postedAt}`);
  if (jobs.every((j) => !('description' in j) && !('salary' in j))) pass('parse: the summary block is not passed off as a description, and salary is not read');
  else fail('parse: description or salary set');

  // Remote marker: appended to the display location only, for remote rows only.
  {
    const rows = parseItjobsFeed(feed([
      item({ title: 'Remote City', link: 'https://www.itjobs.pt/oferta/110/a', fields: { ...FULL, Localidade: 'Lisboa', 'Modelo de trabalho': 'Remoto' } }),
      item({ title: 'Remote Listed', link: 'https://www.itjobs.pt/oferta/111/b', fields: { ...FULL, Localidade: 'Porto, Remoto', 'Modelo de trabalho': 'Remoto' } }),
    ])).jobs;
    const [r1, r2] = rows;
    if (r1.location === 'Lisboa, Remote' && JSON.stringify(r1.locations) === '["Lisboa"]') pass('parse: a remote row keeps its city and adds "Remote" to location only');
    else fail(`parse: remote marker ${JSON.stringify(r1)}`);
    if (r2.location === 'Porto, Remoto, Remote' && JSON.stringify(r2.locations) === '["Porto","Remoto"]') pass('parse: a remote row whose place reads "Remoto" still gets the English "Remote" in location');
    else fail(`parse: Remoto row ${JSON.stringify(r2)}`);
    if (a.location === 'Lisboa, Porto' && c.location === 'Aveiro') pass('parse: hybrid and onsite rows get no "Remote" marker');
    else fail(`parse: non-remote marked ${a.location} / ${c.location}`);
  }

  // Empty vs broken.
  const empty = parseItjobsFeed(feed([]));
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('parse: an empty channel is an empty board');
  else fail('parse: empty channel');
  for (const [label, body] of [
    ['an unclosed item', feed([item({ title: 'X', link: 'https://www.itjobs.pt/oferta/120/x', fields: FULL }).replace('</item>', '')])],
    ['a feed cut short after one item', feed([item({ title: 'A', link: 'https://www.itjobs.pt/oferta/121/a', fields: FULL }), item({ title: 'B', link: 'https://www.itjobs.pt/oferta/122/b', fields: FULL }).replace('</item>', '')])],
  ]) {
    try {
      parseItjobsFeed(body);
      fail(`parse: ${label} should throw`);
    } catch (err) {
      if (/malformed or cut short/.test(err.message)) pass(`parse: ${label} throws instead of reading as fewer rows`);
      else fail(`parse: ${label} → ${err.message}`);
    }
  }
  // A title or comment that mentions <item> is text, not structure.
  {
    const xmlTitle = item({ title: 'XML <item> </item> Developer', link: 'https://www.itjobs.pt/oferta/130/xml', fields: FULL });
    try {
      const out = parseItjobsFeed(feed([xmlTitle, '    <!-- <item> -->\n']));
      if (out.rawCount === 1 && out.jobs.length === 1 && out.jobs[0].title === 'XML <item> </item> Developer') pass('parse: <item> inside CDATA or a comment is not counted as an item tag');
      else fail(`parse: CDATA item text ${JSON.stringify(out)}`);
    } catch (err) {
      fail(`parse: <item> inside CDATA or a comment threw: ${err.message}`);
    }
  }
  for (const [label, body] of [['an HTML error page', '<html><body>404</body></html>'], ['an empty body', ''], ['a non-string', null]]) {
    try {
      parseItjobsFeed(/** @type {any} */ (body));
      fail(`parse: ${label} should throw`);
    } catch (err) {
      if (/expected an <rss><channel> envelope/.test(err.message)) pass(`parse: ${label} throws a descriptive envelope error`);
      else fail(`parse: ${label} → ${err.message}`);
    }
  }
  try {
    parseItjobsFeed(feed([item({ title: 'X', link: 'https://evil.example.com/a', fields: FULL })]));
    fail('parse: items with none parsed should throw');
  } catch (err) {
    if (/none parsed/.test(err.message)) pass('parse: items present but none parsed throws');
    else fail(`parse: none parsed → ${err.message}`);
  }

  // ── fetch ──
  {
    const calls = [];
    const out = await itjobs.fetch({ name: 'ITJobs', provider: 'itjobs' }, {
      fetchText: async (url, opts) => { calls.push({ url, opts }); return SAMPLE; },
    });
    if (calls.length === 1 && calls[0].url === 'https://feeds.itjobs.pt/feed/emprego?limit=5000' && calls[0].opts?.redirect === 'error') {
      pass("fetch() makes one request to the fixed feed URL with redirect:'error'");
    } else {
      fail(`fetch() calls ${JSON.stringify(calls)}`);
    }
    if (out.length === 3 && out.truncated === undefined) pass('fetch() returns the parsed rows and marks nothing');
    else fail(`fetch() returned ${out.length}, truncated=${JSON.stringify(out.truncated)}`);
  }
  {
    // A board that reached the feed limit is marked partial.
    const many = [];
    for (let i = 0; i < 5000; i++) many.push(item({ title: `Role ${i}`, link: `https://www.itjobs.pt/oferta/${i}/r`, fields: FULL }));
    const out = await itjobs.fetch({ name: 'ITJobs', provider: 'itjobs' }, { fetchText: async () => feed(many) });
    if (out.length === 5000 && out.truncated?.reason === 'page-cap') pass('fetch() marks the board page-cap when the feed limit is reached');
    else fail(`fetch() at the limit: ${out.length}, truncated=${JSON.stringify(out.truncated)}`);
  }
  {
    const sentinel = Object.assign(new Error('budget'), { status: 404 });
    try {
      await itjobs.fetch({ name: 'ITJobs', provider: 'itjobs' }, { maxPages: 1, fetchText: async () => { throw sentinel; } });
      fail('fetch() should propagate a fetch error');
    } catch (err) {
      if (err === sentinel) pass('fetch() propagates a ctx.fetchText rejection unwrapped');
      else fail(`fetch() rewrapped the error: ${err && err.message}`);
    }
  }
} catch (err) {
  fail(`itjobs provider tests crashed: ${err && err.stack}`);
}
