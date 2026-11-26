// tests/providers/netempregos.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — netempregos');

// A listing page in the shape measured on 2026-11-26 (names fictional). The
// title link's href is unquoted, as on the real pages.
function card({ id, slug = 'role', title, place = 'Lisboa', category = 'Informática ( Programação )', employer, date = '26-11-2026', featured = false }) {
  return `<div class="job-item${featured ? ' job-item-destaque' : ''} media">\n`
    + (featured ? '<label>&nbsp;Oferta em Destaque&nbsp;</label>\n' : '')
    + '<div class="media-body align-self-center" style="padding-left: 5px;">\n'
    + `<h2 style="font-size:20px;margin: 0px -5x; padding-right: 25px;"><a class="oferta-link" style="font-weight:bold" href=/${id}/${slug}/>${title}</a></h2>\n`
    + '<div class="row"><div class="col-2"><div class="net-div-logo"><div>\n'
    + `<a class="oferta-link" href="/${id}/${slug}/"><img alt="${employer ?? ''}" src="https://upload.net-empregos.com/uploads/x/logo.jpg" class="net-img-logo"></a>\n`
    + '</div></div></div><div class="col-10"><div class="job-ad-item"><ul>\n'
    + `<li><i class="flaticon-calendar" style="color: #f19d35;"></i> ${date}</li>\n`
    + `<li><i class="flaticon-pin" style="color: #d81e1e;"></i>  ${place}</li>\n<br>\n`
    + `<li><i class="fa fa-tags" style="color: #4da95d;"></i> ${category}</li>\n<br>\n`
    + (employer !== undefined ? `<li style="font-weight:bold"><i class="flaticon-work" style="color: #007bff;"></i> ${employer}</li>\n` : '')
    + '</ul></div></div></div>\n'
    + `<div class="div-right"><a href=/${id}/${slug}/ class="apply-button oferta-link">Ver Oferta</a></div>\n`
    + `<a data-id="${id}" class="adiciona-fav" title="Favorito"><i class='fa fa-star-o ml-2'></i></a>\n`
    + '</div>\n</div>\n<!-- GAM 1026826/NTMPRGS_netempregos/pl_incontent_1_job -->\n<div data-fuse="1"></div>\n';
}

function listing(cards, { total = cards.length, similar = [], pagination = true } = {}) {
  return '<!DOCTYPE html><html lang="pt-pt"><head><meta charset="ISO-8859-1"><title>Net-Empregos</title></head><body>\n'
    + `<h3 style="font-size:18px;font-weight:100; color:#808080;">${total} ofertas encontradas </h3>\n`
    + cards.join('')
    + (pagination ? '<div class="pagination-box pb text-center"><nav aria-label="Pagina"><ul class="pagination">'
      + '<li class="page-item"><a class="page-link oferta-link" href="?page=2&categoria=5&zona=0">2</a></li></ul></nav></div>\n' : '')
    + (similar.length ? `<h3 class="heading-2" style="color:#ca0000">Ofertas de Emprego Semelhantes:</h3>\n${similar.join('')}` : '')
    + '<footer>2026 Net-Empregos</footer></body></html>\n';
}

/** n distinct cards, for pagination tests. */
function page(n, offset = 0) {
  const cards = [];
  for (let i = 0; i < n; i++) cards.push(card({ id: 1000 + offset + i, title: `Engineer ${offset + i}`, employer: 'Acme' }));
  return listing(cards, { total: 9999 });
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/netempregos.mjs')).href);
  const netempregos = mod.default;
  const { parseNetEmpregosPage, buildPageUrl } = mod;

  if (netempregos.id === 'netempregos') pass('netempregos.id is "netempregos"');
  else fail(`netempregos.id is ${JSON.stringify(netempregos.id)}`);

  // ── detect ──
  const category = 'https://www.net-empregos.com/empregos-portugal-informatica-programacao.asp?categoria=5&zona=0';
  const hit = netempregos.detect({ careers_url: category });
  if (hit && hit.url === category) pass('detect() claims a Net-Empregos category page');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (netempregos.detect({ careers_url: 'https://net-empregos.com/pesquisa-empregos.asp?chaves=python' })) pass('detect() claims a search URL on the bare host');
  else fail('detect() should claim https://net-empregos.com/pesquisa-empregos.asp');
  for (const careers_url of [
    'http://www.net-empregos.com/pesquisa-empregos.asp',
    'https://www.net-empregos.com.evil.example/pesquisa-empregos.asp',
    'https://evilnet-empregos.com/pesquisa-empregos.asp',
    'not a url',
    '',
    42,
    null,
    undefined,
  ]) {
    try {
      const out = netempregos.detect({ careers_url });
      if (out === null) pass(`detect() returns null for ${JSON.stringify(careers_url)}`);
      else fail(`detect() claimed ${JSON.stringify(careers_url)}`);
    } catch (err) {
      fail(`detect() threw on ${JSON.stringify(careers_url)}: ${err.message}`);
    }
  }
  if (netempregos.detect({}) === null && netempregos.detect(undefined) === null) pass('detect() returns null for an entry without careers_url');
  else fail('detect() should return null for an entry without careers_url');

  // ── buildPageUrl ──
  if (buildPageUrl(category, 1) === category) pass('buildPageUrl keeps the listing URL as page 1');
  else fail(`buildPageUrl page 1: ${buildPageUrl(category, 1)}`);
  const third = new URL(buildPageUrl(`${category}&page=7`, 3));
  if (third.searchParams.get('page') === '3' && third.searchParams.get('categoria') === '5' && third.searchParams.getAll('page').length === 1) {
    pass('buildPageUrl replaces any page in the configured URL');
  } else {
    fail(`buildPageUrl page 3: ${third.href}`);
  }
  const search = new URL(buildPageUrl('https://net-empregos.com/pesquisa-empregos.asp?chaves=data+engineer&categoria=&cidade=', 2));
  if (search.origin === 'https://www.net-empregos.com' && search.searchParams.get('chaves') === 'data engineer' && search.searchParams.get('page') === '2') {
    pass('buildPageUrl keeps a search query and reads it on www.net-empregos.com');
  } else {
    fail(`buildPageUrl search: ${search.href}`);
  }
  for (const path of ['/', '/16250392/lab-technician/', '/loginc.asp', '/empregos-../x.asp']) {
    try {
      buildPageUrl(`https://www.net-empregos.com${path}`, 1);
      fail(`buildPageUrl should refuse ${path}`);
    } catch (err) {
      if (/is not a listing page/.test(err.message)) pass(`buildPageUrl refuses ${path} with a usable message`);
      else fail(`buildPageUrl ${path}: ${err.message}`);
    }
  }

  // ── parseNetEmpregosPage ──
  const sample = listing([
    card({ id: 16300001, slug: 'programador-a-java', title: 'Programador(a) Java &amp; Spring', place: 'Lisboa', employer: 'Acme &amp; Filhos, Lda', featured: true }),
    card({ id: 16300002, slug: 'tecnico-de-redes', title: 'Técnico de Redes – Ação Local', place: 'Porto', employer: 'ExampleCo', date: '4-11-2026' }),
    card({ id: 16300003, slug: 'analista', title: 'Analista', employer: 'Anónimo' }),
    card({ id: 16300004, slug: 'consultor', title: 'Consultor', employer: 'CONFIDENCIAL' }),
    card({ id: 16300005, slug: 'gestor', title: 'Gestor' }),
    card({ id: 16300006, slug: 'sem-titulo', title: '  ', employer: 'BigCo' }),
    card({ id: 16300007, slug: 'data', title: 'Data Engineer', employer: 'BigCo', date: '31-02-2026' }),
  ].concat([card({ id: 0, slug: 'x', title: 'Off site', employer: 'BigCo' }).replace('href=/0/x/>', 'href=https://evil.example.com/1/x/>')]), {
    // One page of results has no pagination: the similar offers follow the
    // last card directly, as on the real search pages.
    total: 8,
    pagination: false,
    similar: [card({ id: 16399999, slug: 'similar', title: 'Similar Role', employer: 'BigCo' })],
  });
  const parsed = parseNetEmpregosPage(sample);
  const [first, second, third7] = parsed.jobs;
  if (parsed.rawCount === 8 && parsed.jobs.length === 3 && parsed.noEmployer === 3 && parsed.unrecognised === 2) {
    pass('parseNetEmpregosPage keeps named employers, counts unnamed ones as noEmployer and cards without a link or title as unrecognised');
  } else {
    fail(`parseNetEmpregosPage counts: ${JSON.stringify({ rawCount: parsed.rawCount, jobs: parsed.jobs.length, noEmployer: parsed.noEmployer, unrecognised: parsed.unrecognised })}`);
  }
  if (first?.title === 'Programador(a) Java & Spring' && first.company === 'Acme & Filhos, Lda' && first.location === 'Lisboa'
    && first.url === 'https://www.net-empregos.com/16300001/programador-a-java/' && first.postedAt === Date.UTC(2026, 10, 26)) {
    pass('parseNetEmpregosPage reads title, employer, place, posting URL and date, entities decoded, a featured card like any other');
  } else {
    fail(`parseNetEmpregosPage first: ${JSON.stringify(first)}`);
  }
  if (second?.title === 'Técnico de Redes – Ação Local' && second.postedAt === Date.UTC(2026, 10, 4)) pass('parseNetEmpregosPage keeps accents and reads a day without a leading zero');
  else fail(`parseNetEmpregosPage second: ${JSON.stringify(second)}`);
  if (third7 && third7.title === 'Data Engineer' && !('postedAt' in third7)) pass('parseNetEmpregosPage leaves postedAt out for an impossible date');
  else fail(`parseNetEmpregosPage bad date: ${JSON.stringify(third7)}`);
  if (!parsed.jobs.some((j) => /similar|evil/.test(j.url))) pass('parseNetEmpregosPage reads neither the similar offers below the results nor an off-site link');
  else fail(`parseNetEmpregosPage read outside the results: ${parsed.jobs.map((j) => j.url).join(' ')}`);

  {
    const empty = '<html><body><p class="text-danger"><i class="fa fa-exclamation-triangle mr-2"></i>Não encontrámos nenhuma oferta de emprego para a sua pesquisa.</p>\n'
      + `<h3 class="heading-2">Ofertas de Emprego Semelhantes:</h3>\n${card({ id: 1, title: 'Similar', employer: 'Acme' })}</body></html>`;
    const out = parseNetEmpregosPage(empty);
    if (out.jobs.length === 0 && out.rawCount === 0) pass('parseNetEmpregosPage returns no jobs for a search with no results, ignoring the similar offers');
    else fail(`parseNetEmpregosPage empty search: ${JSON.stringify(out)}`);
  }
  {
    const out = parseNetEmpregosPage(listing([], { total: 0, pagination: false }));
    if (out.jobs.length === 0 && out.rawCount === 0) pass('parseNetEmpregosPage returns no jobs for a listing with 0 offers');
    else fail(`parseNetEmpregosPage 0 offers: ${JSON.stringify(out)}`);
  }
  {
    const out = parseNetEmpregosPage(listing([card({ id: 7, title: 'Analista', employer: 'Anónimo' })]));
    if (out.jobs.length === 0 && out.noEmployer === 1) pass('parseNetEmpregosPage does not throw for a page whose only card names no employer');
    else fail(`parseNetEmpregosPage only no-employer: ${JSON.stringify(out)}`);
  }
  {
    // What the site served in place of every listing for ~26 minutes after a
    // fast walk (2026-11-26): its login page, HTTP 200.
    const login = '<!DOCTYPE html><html lang="pt-pt"><head><title>Net-Empregos - Login de Candidato</title></head>'
      + '<body><h3>Login de Candidato</h3><form action="/loginc.asp"></form></body></html>';
    try {
      parseNetEmpregosPage(login);
      fail('parseNetEmpregosPage should throw on the login page');
    } catch (err) {
      if (/login page instead of the listing/.test(err.message)) pass('parseNetEmpregosPage names the login page the site serves when it limits requests');
      else fail(`parseNetEmpregosPage login page: ${err.message}`);
    }
  }
  for (const [label, body] of [
    ['an empty body', ''],
    ['a page with no results header', '<html><body><h1>Erro</h1></body></html>'],
    ['a non-string body', 42],
  ]) {
    try {
      parseNetEmpregosPage(/** @type {any} */ (body));
      fail(`parseNetEmpregosPage should throw on ${label}`);
    } catch (err) {
      if (/no results header/.test(err.message)) pass(`parseNetEmpregosPage throws on ${label}`);
      else fail(`parseNetEmpregosPage ${label}: ${err.message}`);
    }
  }
  try {
    const changed = listing([card({ id: 8, title: 'Role', employer: 'Acme' }).replace(/<h2\b[\s\S]*?<\/h2>/, '<h3>Role</h3>')]);
    parseNetEmpregosPage(changed);
    fail('parseNetEmpregosPage should throw when cards exist but none parses');
  } catch (err) {
    if (/none recognised/.test(err.message)) pass('parseNetEmpregosPage throws when cards exist but none parses');
    else fail(`parseNetEmpregosPage none parsed: ${err.message}`);
  }

  // ── fetch ──
  const entry = { name: 'Net-Empregos test', careers_url: category };
  const noSleep = async () => {};

  {
    const calls = [];
    const pages = [page(18, 0), page(18, 18), page(5, 36)];
    const out = await netempregos.fetch(entry, {
      sleep: noSleep,
      fetchText: async (url, opts) => { calls.push({ url, opts }); return pages[calls.length - 1]; },
    });
    if (out.length === 41 && calls.length === 3 && out.truncated === undefined) pass('fetch() walks pages until a short page and marks nothing');
    else fail(`fetch() walk: ${out.length} jobs, ${calls.length} calls, truncated=${JSON.stringify(out.truncated)}`);
    if (calls.every((c) => c.opts && c.opts.redirect === 'error')) pass('fetch() passes redirect: "error" on every request');
    else fail('fetch() must pass redirect: "error" on every request');
    if (calls.every((c) => c.opts && c.opts.charset === 'windows-1252')) pass('fetch() reads every page as windows-1252');
    else fail(`fetch() charset: ${calls.map((c) => c.opts?.charset).join(' ')}`);
    if (new URL(calls[2].url).searchParams.get('page') === '3' && new URL(calls[0].url).searchParams.get('categoria') === '5') {
      pass('fetch() requests the listing with its query and page numbers');
    } else {
      fail(`fetch() URLs: ${calls.map((c) => c.url).join(' ')}`);
    }
  }

  {
    // An ad posted during the walk pushes a card one page on: it comes twice
    // and is kept once, and the walk still ends on the short page.
    const pages = [page(18, 0), page(18, 17), page(2, 35)];
    let n = 0;
    const out = await netempregos.fetch(entry, { sleep: noSleep, fetchText: async () => pages[n++] });
    if (n === 3 && out.length === 37 && new Set(out.map((j) => j.url)).size === 37) pass('fetch() keeps a card that moved to the next page once');
    else fail(`fetch() shifted card: ${n} calls, ${out.length} jobs`);
  }

  {
    const body = listing([
      card({ id: 1, title: 'Own', employer: 'Acme' }),
      card({ id: 2, title: 'Hidden', employer: 'Confidencial' }),
      card({ id: 3, title: '', employer: 'Acme' }),
    ]);
    const out = await netempregos.fetch(entry, { sleep: noSleep, fetchText: async () => body });
    if (out.length === 1 && out.providerStats?.dropped?.no_employer === 1 && out.providerStats?.dropped?.unrecognised === 1
      && !Object.keys(out).includes('providerStats')) {
      pass('fetch() reports dropped cards in a non-enumerable providerStats');
    } else {
      fail(`fetch() providerStats: ${out.length} jobs, ${JSON.stringify(out.providerStats)}`);
    }
  }

  {
    let n = 0;
    const out = await netempregos.fetch(entry, { sleep: noSleep, fetchText: async () => page(18, 18 * n++) });
    if (n === 50 && out.length === 900 && out.truncated?.reason === 'page-cap') pass('fetch() stops at its own DEFAULT_MAX_PAGES and marks the board page-cap');
    else fail(`fetch() cap: ${n} calls, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    let n = 0;
    const out = await netempregos.fetch({ ...entry, max_pages: 2 }, { sleep: noSleep, fetchText: async () => page(18, 18 * n++) });
    if (n === 2 && out.truncated?.reason === 'page-cap') pass('fetch() honours entry.max_pages');
    else fail(`fetch() max_pages: ${n} calls`);
  }

  {
    let n = 0;
    await netempregos.fetch({ ...entry, max_pages: 100000 }, { sleep: noSleep, fetchText: async () => page(18, 18 * n++) });
    if (n === 200) pass('fetch() caps a configured max_pages at MAX_PAGES_CAP');
    else fail(`fetch() MAX_PAGES_CAP: ${n} calls`);
  }

  {
    let n = 0;
    const out = await netempregos.fetch(entry, { maxPages: 1, sleep: noSleep, fetchText: async () => { n++; return page(18); } });
    if (n === 1 && out.length === 18 && out.truncated === undefined) pass('fetch() makes exactly one list request under ctx.maxPages: 1 and marks nothing');
    else fail(`fetch() probe: ${n} calls, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    class FakeSentinel extends Error {}
    const sentinel = Object.assign(new FakeSentinel('budget'), { status: 404 }); // not retryable
    let n = 0;
    try {
      await netempregos.fetch(entry, {
        maxPages: 2,
        sleep: noSleep,
        fetchText: async () => { n++; if (n === 2) throw sentinel; return page(18); },
      });
      fail('fetch() should propagate a page error while probing');
    } catch (err) {
      if (err === sentinel) pass('fetch() propagates a ctx.fetchText rejection unwrapped while probing');
      else fail(`fetch() probe error was rewrapped: ${err && err.message}`);
    }
  }

  {
    let n = 0;
    const notFound = Object.assign(new Error('HTTP 404'), { status: 404 });
    const out = await netempregos.fetch(entry, {
      sleep: noSleep,
      fetchText: async () => { n++; if (n === 2) throw notFound; return page(18); },
    });
    if (out.length === 18 && out.truncated?.reason === 'fetch-error') pass('fetch() keeps page 1 and marks fetch-error when a later page fails, without the max_pages advice');
    else fail(`fetch() later-page failure: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    let n = 0;
    const out = await netempregos.fetch(entry, { sleep: noSleep, fetchText: async () => (++n === 1 ? page(18) : '<html>Erro</html>') });
    if (n === 2 && out.length === 18 && out.truncated?.reason === 'fetch-error') pass('fetch() keeps the pages read before a broken page and marks the board fetch-error');
    else fail(`fetch() broken later page: n=${n}, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // The login page arriving mid-walk ends it like a broken page, and the
    // warning says why.
    let n = 0;
    const login = '<html><head><title>Net-Empregos - Login de Candidato</title></head><body></body></html>';
    const errors = [];
    const realError = console.error;
    console.error = (msg) => { errors.push(String(msg)); };
    let out;
    try {
      out = await netempregos.fetch(entry, { sleep: noSleep, fetchText: async () => (++n === 1 ? page(18) : login) });
    } finally {
      console.error = realError;
    }
    if (out.length === 18 && out.truncated?.reason === 'fetch-error' && errors.some((e) => /login page instead of the listing/.test(e))) {
      pass('fetch() keeps the pages read before the login page, marks fetch-error and names the login page in the warning');
    } else {
      fail(`fetch() login mid-walk: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}, warnings=${JSON.stringify(errors)}`);
    }
  }

  for (const [label, impl, check] of [
    ['fails', async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); }, (err) => err?.status === 404],
    ['is broken', async () => '<html>Erro</html>', (err) => /no results header/.test(err?.message)],
  ]) {
    try {
      await netempregos.fetch(entry, { sleep: noSleep, fetchText: impl });
      fail(`fetch() should throw when the first page ${label}`);
    } catch (err) {
      if (check(err)) pass(`fetch() throws when the first page ${label}`);
      else fail(`fetch() first page ${label}: ${err && err.message}`);
    }
  }

  for (const careers_url of [
    'https://evil.example.com/pesquisa-empregos.asp',
    'https://www.net-empregos.com/16250392/lab-technician/',
    'http://www.net-empregos.com/pesquisa-empregos.asp',
    undefined,
  ]) {
    let n = 0;
    try {
      await netempregos.fetch({ name: 'bad', careers_url }, { sleep: noSleep, fetchText: async () => { n++; return page(1); } });
      fail(`fetch() should refuse careers_url ${careers_url}`);
    } catch {
      if (n === 0) pass(`fetch() refuses careers_url ${careers_url} before any request`);
      else fail(`fetch() made ${n} request(s) before refusing ${careers_url}`);
    }
  }
} catch (err) {
  fail(`netempregos tests crashed: ${err && err.stack}`);
}
