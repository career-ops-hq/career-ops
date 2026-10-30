// tests/providers/hiringroom.test.mjs — HiringRoom per-company HTML microsite provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hiringroom');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hiringroom.mjs')).href);
  const hiringroom = mod.default;
  const { parseHiringRoomJobs } = mod;

  if (hiringroom.id === 'hiringroom') pass('hiringroom.id is "hiringroom"');
  else fail(`hiringroom.id is ${JSON.stringify(hiringroom.id)}`);

  // detect(): claims *.hiringroom.com careers_url, rejects everything else.
  if (hiringroom.detect({ careers_url: 'https://growuphr.hiringroom.com/jobs' }))
    pass('hiringroom.detect() claims a *.hiringroom.com careers_url');
  else fail('hiringroom.detect() should claim a *.hiringroom.com careers_url');

  if (!hiringroom.detect({ careers_url: 'https://jobs.lever.co/acme' }))
    pass('hiringroom.detect() ignores a non-hiringroom careers_url');
  else fail('hiringroom.detect() should ignore a non-hiringroom careers_url');

  if (!hiringroom.detect({ careers_url: 'https://evil-hiringroom.com/jobs' }))
    pass('hiringroom.detect() rejects a look-alike host (evil-hiringroom.com)');
  else fail('hiringroom.detect() should reject a look-alike host');

  // A tiny fixture mirroring the live markup: two real cards (one with an HTML
  // entity + whitespace in the title), one apply link (dropped), one anchor
  // whose block has no title (dropped), and a duplicate of card 1 (deduped).
  const html = `
    <a href="/jobs/get_vacancy/aaa111" class="text-decoration-none">
      <div class="card p-3">
        <div class="card-vacancy">
          <h4 class="font-black fs-20 name__vacancy"> Senior Python Backend Engineer (USA) </h4>
          <p class="card-text"><span><i class="hr-Location-pin hrc-black"></i> Argentina </span></p>
        </div>
      </div>
    </a>
    <a href="/jobs/get_vacancy/bbb222" class="text-decoration-none">
      <div class="card p-3">
        <div class="card-vacancy">
          <h4 class="fs-20 name__vacancy"> Desarrollador Go &amp; Cloud </h4>
          <p class="card-text"><span><i class="hr-Location-pin hrc-black"></i> Remoto </span></p>
        </div>
      </div>
    </a>
    <a href="/jobs/get_vacancy/aaa111/candidates/new">Postularme</a>
    <a href="/jobs/get_vacancy/ccc333" class="text-decoration-none">
      <div class="card p-3"><div class="card-vacancy"><h5>No title here</h5></div></div>
    </a>
    <a href="/jobs/get_vacancy/aaa111" class="text-decoration-none">
      <div class="card p-3"><div class="card-vacancy"><h4 class="name__vacancy"> Senior Python Backend Engineer (USA) </h4></div></div>
    </a>`;

  const jobs = parseHiringRoomJobs(html, 'https://growuphr.hiringroom.com', 'Grow UP HR');

  if (jobs.length === 2)
    pass('parseHiringRoomJobs keeps 2 cards (drops apply link, title-less block, dedups repeat)');
  else fail(`parseHiringRoomJobs returned ${jobs.length} jobs (expected 2): ${JSON.stringify(jobs.map(j => j.url))}`);

  if (jobs[0] && Object.keys(jobs[0]).sort().join(',') === 'company,location,title,url')
    pass('parseHiringRoomJobs returns the normalized { title, url, company, location } shape');
  else fail(`parseHiringRoomJobs row 0 keys = ${JSON.stringify(jobs[0] && Object.keys(jobs[0]))}`);

  if (jobs[0]?.title === 'Senior Python Backend Engineer (USA)'
      && jobs[0]?.url === 'https://growuphr.hiringroom.com/jobs/get_vacancy/aaa111'
      && jobs[0]?.company === 'Grow UP HR'
      && jobs[0]?.location === 'Argentina')
    pass('parseHiringRoomJobs maps title/url/company/location and trims whitespace');
  else fail(`parseHiringRoomJobs row 0 = ${JSON.stringify(jobs[0])}`);

  if (jobs[1]?.title === 'Desarrollador Go & Cloud')
    pass('parseHiringRoomJobs decodes HTML entities in the title (&amp; → &)');
  else fail(`parseHiringRoomJobs row 1 title = ${JSON.stringify(jobs[1]?.title)}`);

  if (jobs[1]?.location === 'Remoto')
    pass('parseHiringRoomJobs extracts the location that follows the pin icon');
  else fail(`parseHiringRoomJobs row 1 location = ${JSON.stringify(jobs[1]?.location)}`);

  // fetch() drives ctx.fetchText with the pinned URL + SSRF guard, then parses.
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await hiringroom.fetch(
    { name: 'Grow UP HR', careers_url: 'https://growuphr.hiringroom.com/jobs', provider: 'hiringroom' },
    { fetchText: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return html; } },
  );
  if (capturedUrl === 'https://growuphr.hiringroom.com/jobs' && capturedOpts?.redirect === 'error')
    pass('hiringroom.fetch() fetches the careers_url with redirect:"error" (SSRF guard)');
  else fail(`hiringroom.fetch() requested ${JSON.stringify(capturedUrl)} opts=${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2 && fetched[0]?.company === 'Grow UP HR')
    pass('hiringroom.fetch() returns parsed jobs labelled with entry.name as company');
  else fail(`hiringroom.fetch() = ${JSON.stringify(fetched)}`);

  // Newer tenants moved to a /portal/jobs microsite that embeds the listing as
  // schema.org JSON-LD (ItemList of JobPosting) and has none of the legacy card
  // markup. The fixture mirrors that shape: an http:// url (normalized to the
  // https origin), a string address, an object address, an entity-encoded HTML
  // description, a foreign-host url (dropped) and a non-vacancy url (dropped).
  const ld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, item: {
        '@type': 'JobPosting', title: ' Ingeniero/a de Producci&oacute;n ',
        jobLocation: { '@type': 'Place', address: 'La Plata, Buenos Aires, Argentina' },
        description: '<p>Gestionar la ingenier&iacute;a de <strong>producci&oacute;n</strong>.</p>\n<p>Turnos rotativos.</p>',
        datePosted: '2026-09-08',
        url: 'http://acme.hiringroom.com/jobs/get_vacancy/6aa02812d6589654b9d9ff67' } },
      { '@type': 'ListItem', position: 2, item: {
        '@type': 'JobPosting', title: 'Operario/a de Mantenimiento',
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Puerto Madryn', addressRegion: 'Chubut', addressCountry: 'Argentina' } },
        datePosted: 'not-a-date',
        url: 'https://acme.hiringroom.com/jobs/get_vacancy/68a629f6a7b3ca2fd423e61b' } },
      { '@type': 'ListItem', position: 3, item: {
        '@type': 'JobPosting', title: 'Elsewhere',
        url: 'https://evil.example.com/jobs/get_vacancy/aaa111' } },
      { '@type': 'ListItem', position: 4, item: {
        '@type': 'JobPosting', title: 'Not a vacancy',
        url: 'https://acme.hiringroom.com/portal' } },
    ],
  };
  const portalHtml = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    </head><body><a href="https://acme.hiringroom.com/jobs/get_vacancy/6aa02812d6589654b9d9ff67">Ver</a></body></html>`;

  const pj = parseHiringRoomJobs(portalHtml, 'https://acme.hiringroom.com', 'Acme');

  if (pj.length === 2)
    pass('parseHiringRoomJobs reads the /portal JSON-LD listing (drops foreign-host and non-vacancy urls)');
  else fail(`parseHiringRoomJobs /portal returned ${pj.length} jobs (expected 2): ${JSON.stringify(pj.map(j => j.url))}`);

  if (pj[0]?.url === 'https://acme.hiringroom.com/jobs/get_vacancy/6aa02812d6589654b9d9ff67'
      && pj[0]?.title === 'Ingeniero/a de Producción'
      && pj[0]?.company === 'Acme'
      && pj[0]?.location === 'La Plata, Buenos Aires, Argentina')
    pass('parseHiringRoomJobs maps JSON-LD title/url/location, forcing the https origin');
  else fail(`parseHiringRoomJobs /portal row 0 = ${JSON.stringify(pj[0])}`);

  if (pj[0]?.postedAt === Date.parse('2026-09-08'))
    pass('parseHiringRoomJobs maps datePosted to postedAt (epoch ms)');
  else fail(`parseHiringRoomJobs /portal row 0 postedAt = ${JSON.stringify(pj[0]?.postedAt)}`);

  if (pj[0]?.description === 'Gestionar la ingeniería de producción. Turnos rotativos.')
    pass('parseHiringRoomJobs flattens the JSON-LD description to plain text');
  else fail(`parseHiringRoomJobs /portal row 0 description = ${JSON.stringify(pj[0]?.description)}`);

  if (pj[1]?.location === 'Puerto Madryn, Chubut, Argentina' && !('postedAt' in (pj[1] || {})))
    pass('parseHiringRoomJobs joins a PostalAddress and omits an unparseable datePosted');
  else fail(`parseHiringRoomJobs /portal row 1 = ${JSON.stringify(pj[1])}`);

  // SSRF: a non-hiringroom host must throw before any parse.
  let ssrfThrew = false;
  try {
    await hiringroom.fetch(
      { name: 'X', careers_url: 'https://evil.example.com/jobs' },
      { fetchText: async () => html },
    );
  } catch (e) {
    ssrfThrew = /untrusted hostname/.test(e.message);
  }
  if (ssrfThrew) pass('hiringroom.fetch() throws on an untrusted hostname');
  else fail('hiringroom.fetch() should throw on an untrusted hostname');

} catch (e) {
  fail(`hiringroom provider tests crashed: ${e.message}`);
}
