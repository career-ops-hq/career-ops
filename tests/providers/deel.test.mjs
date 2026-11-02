// tests/providers/deel.test.mjs — direct provider-contract tests.
// jobs.deel.com tenant boards are server-rendered by Next.js: the whole inventory
// rides in the RSC flight payload, and each description is a `$<hex>` reference to a
// length-prefixed text row. The parser must fail CLOSED on a missing container (a
// silent zero would look like an empty board) while a present-and-empty one is [].
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — deel');

/** Wrap an RSC stream the way the page does: one push per chunk, JSON-string escaped. */
function pageWith(stream, { title = 'Acme Careers' } = {}) {
  const chunks = [];
  for (let i = 0; i < stream.length; i += 400) chunks.push(stream.slice(i, i + 400));
  const pushes = chunks.map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`).join('');
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${pushes}</body></html>`;
}

/** A text row: `<id>:T<hex byte length>,<payload>` (length is UTF-8 bytes). */
function textRow(id, html) {
  return `${id}:T${Buffer.byteLength(html, 'utf8').toString(16)},${html}`;
}

function posting(over = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Solutions Engineer',
    richtextDescription: '$1a',
    createdAt: '2026-09-01T10:00:00.000Z',
    job: {
      workArrangementEnum: 'HYBRID',
      jobLocations: [{ location: { name: 'New York', country: { name: 'United States' } } }],
      currentCompensation: { currencyIsoCode: 'USD', minAmount: 150000, maxAmount: 190000 },
    },
    jobPostingPublications: [{ currentState: { stateSlug: 'published_basic', createdAt: '2026-09-03T10:00:00.000Z' } }],
    ...over,
  };
}

function boardStream(postings, texts = { 1: 'a' }) {
  const rows = [
    '0:["$","$L1",null,{}]',
    ':HL["/_next/static/css/x.css","style"]',
    `2:{"orgSlug":"acme","jobPostings":${JSON.stringify(postings)},"orgSlug":"acme"}`,
  ];
  for (const [, html] of Object.entries(texts)) rows.push(textRow('1a', html));
  return rows.join('\n') + '\n';
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/deel.mjs')).href);
  const deel = mod.default;
  const { parseDeelBoard, readFlightStream, readTextRows } = mod;

  if (deel.id === 'deel') pass('deel.id is "deel"');
  else fail(`deel.id is ${JSON.stringify(deel.id)}`);

  // ── detect ──────────────────────────────────────────────────────────────
  if (deel.detect({ name: 'A', careers_url: 'https://jobs.deel.com/acme' })?.url === 'https://jobs.deel.com/acme') {
    pass('deel.detect() claims a jobs.deel.com/<slug> careers_url');
  } else fail('deel.detect() should claim jobs.deel.com/<slug>');

  if (deel.detect({ name: 'A', careers_url: 'https://jobs.deel.com/acme/job-details/abc/overview?x=1' })?.url === 'https://jobs.deel.com/acme') {
    pass('deel.detect() reduces a posting permalink to the board root (input path is not inspected)');
  } else fail('deel.detect() should rebuild the board root from a deeper URL');

  if (deel.detect({ name: 'A', api: 'https://jobs.deel.com/acme', careers_url: 'https://example.com' })?.url === 'https://jobs.deel.com/acme') {
    pass('deel.detect() honours an explicit api: URL');
  } else fail('deel.detect() api: not honoured');

  const rejects = [
    ['path-spoofed', 'https://evil.example/jobs.deel.com/acme'],
    ['suffix-spoofed host', 'https://jobs.deel.com.evil.example/acme'],
    ['prefix-spoofed host', 'https://evil-jobs.deel.com/acme'],
    ['other deel host', 'https://www.deel.com/careers/'],
    ['http', 'http://jobs.deel.com/acme'],
    ['bare host', 'https://jobs.deel.com/'],
    ['unsafe slug', 'https://jobs.deel.com/%2e%2e%2fadmin'],
    ['malformed', 'not a url'],
  ];
  const leaked = rejects.filter(([, u]) => deel.detect({ name: 'X', careers_url: u }) !== null).map(([n]) => n);
  if (leaked.length === 0) pass('deel.detect() rejects spoofed, non-HTTPS, slug-less and malformed URLs');
  else fail(`deel.detect() wrongly claimed: ${leaked.join(', ')}`);

  if (deel.detect({ name: 'X', careers_url: null }) === null && deel.detect({ name: 'X', careers_url: 7 }) === null && deel.detect({ name: 'X' }) === null) {
    pass('deel.detect() returns null for null / non-string / missing careers_url (no throw)');
  } else fail('deel.detect() should treat junk careers_url as missing');

  // ── flight stream + text rows ───────────────────────────────────────────
  const multi = 'Café ’résumé’ — 日本語';
  const stream = boardStream([posting()], { 1: `<p>${multi}</p>` });
  const texts = readTextRows(readFlightStream(pageWith(stream)));
  if (texts.get('1a') === `<p>${multi}</p>`) pass('readTextRows() honours the UTF-8 byte length of a text row (multi-byte payload intact)');
  else fail(`readTextRows() 1a = ${JSON.stringify(texts.get('1a'))}`);

  // Two text rows back to back, with and without the newline between them: the
  // second row's id must not swallow the separator, and a posting that points at
  // the second row must get its description.
  for (const [label, sep] of [['newline-separated', '\n'], ['adjacent', '']]) {
    const two = readTextRows(`${textRow('1a', '<p>first</p>')}${sep}${textRow('1b', `<p>${multi}</p>`)}${sep}`);
    if (two.get('1a') === '<p>first</p>' && two.get('1b') === `<p>${multi}</p>`) pass(`readTextRows() reads two ${label} text rows`);
    else fail(`readTextRows() ${label}: ${JSON.stringify([...two])}`);
  }
  const twoRowBoard = pageWith([
    `2:{"orgSlug":"acme","jobPostings":${JSON.stringify([posting({ richtextDescription: '$1b' })])}}`,
    textRow('1a', '<p>first</p>'),
    textRow('1b', '<p>second</p>'),
  ].join('\n') + '\n');
  const [second] = parseDeelBoard(twoRowBoard, { slug: 'acme', company: 'Acme' });
  if (second?.description === 'second') pass('parseDeelBoard() resolves a description stored in the second of two text rows');
  else fail(`second-row description = ${JSON.stringify(second?.description)}`);

  // ── parseDeelBoard ──────────────────────────────────────────────────────
  const html = pageWith(boardStream([
    posting(),
    posting({
      id: '22222222-2222-4222-8222-222222222222',
      title: '  Remote Presales Engineer  ',
      richtextDescription: '<b>inline</b>',
      job: { workArrangementEnum: 'REMOTE', jobLocations: [{ location: { name: 'Ohio', country: { name: 'United States' } } }, { location: { name: 'Austin, United States', country: { name: 'United States' } } }] },
      jobPostingPublications: [{ currentState: { stateSlug: 'draft', createdAt: '2026-01-01T00:00:00.000Z' } }],
    }),
    posting({ id: '33333333-3333-4333-8333-333333333333', title: '   ' }), // blank title → dropped
    posting({ id: undefined, title: 'No id' }),                              // no id → dropped
    null,                                                                    // junk row → dropped
  ], { 1: `<p>${multi}</p>` }));
  const jobs = parseDeelBoard(html, { slug: 'acme', company: 'Acme' });

  if (jobs.length === 2) pass('parseDeelBoard() drops rows missing a title or id and keeps the rest');
  else fail(`parseDeelBoard() kept ${jobs.length} rows`);

  const [a, b] = jobs;
  if (a.url === 'https://jobs.deel.com/acme/job-details/11111111-1111-4111-8111-111111111111/overview'
      && a.company === 'Acme' && a.title === 'Solutions Engineer'
      && a.externalId === '11111111-1111-4111-8111-111111111111') {
    pass('parseDeelBoard() builds the canonical posting URL, company, title and externalId');
  } else fail(`parseDeelBoard() row 0 = ${JSON.stringify(a)}`);

  if (a.location === 'New York, United States') pass('parseDeelBoard() appends the country to a location that lacks it');
  else fail(`location = ${JSON.stringify(a.location)}`);

  if (b.location === 'Ohio, United States; Austin, United States; Remote') {
    pass('parseDeelBoard() does not repeat a country already in the name and marks REMOTE arrangements');
  } else fail(`remote location = ${JSON.stringify(b.location)}`);

  if (b.title === 'Remote Presales Engineer') pass('parseDeelBoard() trims the title');
  else fail(`title = ${JSON.stringify(b.title)}`);

  if (a.postedAt === Date.parse('2026-09-03T10:00:00.000Z')) pass('parseDeelBoard() prefers the publication timestamp for postedAt');
  else fail(`postedAt = ${a.postedAt}`);
  if (b.postedAt === Date.parse('2026-09-01T10:00:00.000Z')) pass('parseDeelBoard() falls back to createdAt when no published state exists');
  else fail(`fallback postedAt = ${b.postedAt}`);

  if (a.description === `${multi}`) pass('parseDeelBoard() resolves a $-reference description from the text rows (HTML → text)');
  else fail(`description = ${JSON.stringify(a.description)}`);
  if (b.description === 'inline') pass('parseDeelBoard() accepts an inline description string');
  else fail(`inline description = ${JSON.stringify(b.description)}`);

  if (!('salary' in a)) pass('parseDeelBoard() leaves salary off (amounts carry no pay interval)');
  else fail('salary must not be inferred without an interval');

  // unresolvable description reference → posting kept, no description
  const dangling = parseDeelBoard(pageWith(boardStream([posting({ richtextDescription: '$ff' })])), { slug: 'acme', company: 'Acme' });
  if (dangling.length === 1 && !('description' in dangling[0])) pass('parseDeelBoard() keeps a posting whose description reference is missing');
  else fail(`dangling ref row = ${JSON.stringify(dangling)}`);

  // ── empty vs broken ─────────────────────────────────────────────────────
  const empty = parseDeelBoard(pageWith(boardStream([])), { slug: 'acme', company: 'Acme' });
  if (Array.isArray(empty) && empty.length === 0) pass('parseDeelBoard() returns [] for a present-and-empty jobPostings container');
  else fail(`empty board = ${JSON.stringify(empty)}`);

  const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  if (throwsWith(() => parseDeelBoard(pageWith('0:["x"]\n', { title: 'Job Board Not Found' }), { slug: 'ghost', company: 'G' }), /no board at jobs\.deel\.com\/ghost/)) {
    pass('parseDeelBoard() throws a named error on the "Job Board Not Found" shell');
  } else fail('Job Board Not Found should throw');
  if (throwsWith(() => parseDeelBoard('<html><body>hi</body></html>', { slug: 'acme', company: 'A' }), /no Next\.js flight data/)) {
    pass('parseDeelBoard() throws when the page carries no flight payload (markup change)');
  } else fail('missing flight payload should throw');
  if (throwsWith(() => parseDeelBoard(pageWith('0:["x"]\n2:{"jobs":[]}\n'), { slug: 'acme', company: 'A' }), /no jobPostings/)) {
    pass('parseDeelBoard() throws when the payload has no jobPostings container (does not read as an empty board)');
  } else fail('missing jobPostings should throw');
  if (throwsWith(() => parseDeelBoard('', { slug: 'acme', company: 'A' }), /empty response/)) pass('parseDeelBoard() throws on an empty body');
  else fail('empty body should throw');

  // ── fetch(): redirect:'error', allowlist-before-fetch, redirects, probe ──
  const entry = { name: 'Acme', careers_url: 'https://jobs.deel.com/acme' };
  const seen = [];
  const fetched = await deel.fetch(entry, {
    fetchText: async (url, opts) => { seen.push({ url, opts }); return html; },
  });
  if (fetched.length === 2 && seen.length === 1 && seen[0].url === 'https://jobs.deel.com/acme' && seen[0].opts?.redirect === 'error') {
    pass('deel.fetch() issues exactly one request, to the board root, with redirect:"error"');
  } else fail(`deel.fetch() requests = ${JSON.stringify(seen)}`);

  let touched = 0;
  let guardErr = null;
  try {
    await deel.fetch({ name: 'Evil', careers_url: 'https://evil.example/acme' }, { fetchText: async () => { touched++; return html; } });
  } catch (e) { guardErr = e; }
  if (guardErr && touched === 0) pass('deel.fetch() rejects an off-host entry before any network call');
  else fail(`off-host entry: err=${guardErr?.message} fetches=${touched}`);

  // A refused redirect (company serves careers elsewhere) is named, not a bare network error.
  const refusal = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
  let redirErr = null;
  try { await deel.fetch(entry, { fetchText: async () => { throw refusal; } }); } catch (e) { redirErr = e; }
  if (redirErr && /redirects away from the board/.test(redirErr.message)) pass('deel.fetch() reports a refused redirect by name');
  else fail(`refused redirect error = ${redirErr?.message}`);

  // Probe cooperation: ctx.maxPages set → still one request; a rejection propagates unwrapped.
  let probeCalls = 0;
  await deel.fetch(entry, { maxPages: 1, fetchText: async () => { probeCalls++; return html; } });
  if (probeCalls === 1) pass('deel.fetch() makes a single list request under ctx.maxPages (probe)');
  else fail(`probe requests = ${probeCalls}`);

  class FakeSentinel extends Error {}
  let probeErr = null;
  try { await deel.fetch(entry, { maxPages: 1, fetchText: async () => { throw new FakeSentinel(); } }); } catch (e) { probeErr = e; }
  if (probeErr instanceof FakeSentinel) pass('deel.fetch() propagates a ctx.fetch* rejection unwrapped while probing');
  else fail(`probe error identity lost: ${probeErr?.constructor?.name}`);
} catch (e) {
  fail(`deel provider test crashed: ${e.stack || e.message}`);
}
