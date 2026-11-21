// tests/providers/workable-feed.test.mjs — providers/workable.mjs reads
// Workable's XML job feed one <job> at a time and keeps only what a reverse
// scan wants.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — workable XML job feed');

const {
  loadWorkableFeed, readFeedField: readField, feedCountryName: countryName, createFeedJobSplitter: createJobSplitter, feedRowToWidgetRow,
  WORKABLE_FEED_URL, WORKABLE_FEED_TIMEOUT_MS: FEED_TIMEOUT_MS, WORKABLE_FEED_MAX_BYTES: FEED_MAX_BYTES,
} = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);

const check = (ok, label, detail) => (ok ? pass(label) : fail(detail ? `${label} — ${detail}` : label));
const cdata = (v) => `<![CDATA[${v}]]>`;

/** One <job> element in the feed's own layout. */
function job({ title, code, company = 'Acme GmbH', city = 'Berlin', state = 'Berlin', country = 'DE', remote = 'false', date = 'Mon, 09 Nov 2026 10:00:00 UTC', description = '<p>Build &amp; test.</p>', website = 'https://acme.example', url }) {
  const href = url ?? `https://apply.workable.com/j/${code}`;
  return `  <job>
    <title>
      ${cdata(title)}
    </title>
    <date>
      ${cdata(date)}
    </date>
    <referencenumber>
      ${cdata(code)}
    </referencenumber>
    <url>
      ${cdata(href)}
    </url>
    <company>
      ${cdata(company)}
    </company>
    <city>
      ${cdata(city)}
    </city>
    <state>
      ${cdata(state)}
    </state>
    <country>
      ${cdata(country)}
    </country>
    <remote>
      ${cdata(remote)}
    </remote>
    <description>
      ${cdata(description)}
    </description>
    <website>
      ${cdata(website)}
    </website>
  </job>
`;
}
const feed = (...jobs) => `<?xml version="1.0" encoding="utf-8"?>\n<source>\n  <publisher>Workable</publisher>\n  <publisherurl>https://www.workable.com</publisherurl>\n${jobs.join('')}</source>\n`;

/** A fetchStream stub that hands the document over in small pieces. */
function streamOf(text, piece = 37) {
  const calls = [];
  const fn = async (url, opts, onText) => {
    calls.push({ url, opts });
    for (let i = 0; i < text.length; i += piece) await onText(text.slice(i, i + piece));
    return { bytes: Buffer.byteLength(text), complete: true };
  };
  fn.calls = calls;
  return fn;
}

const CUTOFF = Date.parse('2026-11-06T00:00:00Z');
const all = () => true;

// ── fields ──────────────────────────────────────────────────────────────
{
  check(readField(`<t>\n  ${cdata(' Senior QA ')}\n</t>`, 't') === 'Senior QA', 'readField reads a CDATA value and trims it');
  check(readField(`<t>${cdata('a]]')}${cdata('>b')}</t>`, 't') === 'a]]>b', 'readField joins split CDATA sections');
  check(readField('<t>Tom &amp; Jerry</t>', 't') === 'Tom & Jerry', 'readField decodes entities in a value outside CDATA');
  check(readField('<a>x</a>', 't') === '', 'readField returns empty for an absent element');
  check(readField(`<d>${cdata('<p>a</d> b</p>')}</d>`, 'd') === '<p>a</d> b</p>', 'readField does not stop at a closing-tag lookalike inside CDATA');
}
{
  check(countryName('DE') === 'Germany' && countryName('gb') === 'United Kingdom' && countryName('US') === 'United States', 'countryName turns ISO codes into the English names location_filter uses');
  check(countryName('') === '' && countryName('Remote') === 'Remote', 'countryName leaves anything that is not a two-letter code as given');
}
{
  const row = feedRowToWidgetRow(job({ title: 'QA Engineer', code: 'ABC123', remote: 'true' }));
  check(row?.shortlink === 'https://apply.workable.com/j/ABC123' && row.country === 'Germany' && row.telecommuting === true && row.company === 'Acme GmbH', 'a feed row becomes a widget-shaped row');
  check(feedRowToWidgetRow(job({ title: '', code: 'X1' })) === null, 'a row with no title is dropped');
}

// ── splitting ───────────────────────────────────────────────────────────
{
  const blocks = [];
  const s = createJobSplitter((b) => blocks.push(b));
  const text = feed(job({ title: 'A', code: 'A1' }), job({ title: 'B', code: 'B1' }));
  for (let i = 0; i < text.length; i += 3) s.push(text.slice(i, i + 3)); // splits every tag
  check(blocks.length === 2 && blocks[0].startsWith('<job>') && blocks[1].endsWith('</job>') && s.sawSource, 'jobs are cut out whole even when every tag is split across pieces');
  const runaway = createJobSplitter(() => {});
  let err = null;
  try { runaway.push(`<source><job>${'x'.repeat(1024 * 1024 + 10)}`); } catch (e) { err = e; }
  check(/without a closing tag/.test(err?.message ?? ''), 'a <job> that never closes throws instead of growing without bound');
}

// ── loadWorkableFeed ────────────────────────────────────────────────────
{
  const text = feed(
    // one posting, two locations, the Munich row published first
    job({ title: 'QA Engineer', code: 'QA1', city: 'Berlin', date: 'Mon, 09 Nov 2026 10:00:00 UTC' }),
    job({ title: 'QA Engineer', code: 'QA1', city: 'Munich', state: 'Bavaria', date: 'Sat, 07 Nov 2026 08:00:00 UTC', remote: 'true' }),
    // a fresh row of a posting whose other row is older than the window
    job({ title: 'Test Lead', code: 'TL1', date: 'Mon, 09 Nov 2026 10:00:00 UTC' }),
    job({ title: 'Test Lead', code: 'TL1', city: 'Hamburg', date: 'Mon, 02 Nov 2026 10:00:00 UTC' }),
    // filtered out by title
    job({ title: 'Office Manager', code: 'OM1' }),
    // another employer
    job({ title: 'SDET', code: 'SD1', company: 'ExampleCo', website: '', city: 'Paris', state: '', country: 'FR' }),
    // a URL off the Workable host
    job({ title: 'QA Analyst', code: 'EV1', url: 'https://evil.example/j/EV1' }),
    // no usable date
    job({ title: 'QA Intern', code: 'UD1', date: 'soon' }),
  );
  const stream = streamOf(text);
  const titles = [];
  const { companies, stats } = await loadWorkableFeed({
    cutoffMs: CUTOFF,
    titleFilter: (t, company) => { titles.push(company); return t !== 'Office Manager'; },
    fetchStream: stream,
  });
  const acme = companies.find((c) => c.company === 'Acme GmbH');
  const qa = acme?.jobs.find((j) => j.title === 'QA Engineer');
  check(stream.calls.length === 1 && stream.calls[0].url === WORKABLE_FEED_URL
    && stream.calls[0].opts.redirect === 'error' && stream.calls[0].opts.timeoutMs === FEED_TIMEOUT_MS && stream.calls[0].opts.maxBytes === FEED_MAX_BYTES,
  'the feed is read once, from its URL, with redirect: error, the feed deadline and the decoded-size ceiling');
  check(qa?.url === 'https://apply.workable.com/j/QA1', "a posting keeps the feed's URL exactly");
  check(qa?.location === 'Munich, Germany · Berlin, Germany · Remote', 'per-location rows fold into one posting, oldest row first, Remote added once', qa?.location);
  check(qa?.postedAt === Date.parse('2026-11-07T08:00:00Z'), "a posting's date is its oldest row");
  check(qa?.description === 'Build & test.' && qa.company === 'Acme GmbH', 'the description is plain text and the company is the employer');
  check(!acme?.jobs.some((j) => j.title === 'Test Lead'), 'a posting with any row older than the window is dropped, fresh rows included');
  check(!acme?.jobs.some((j) => j.title === 'Office Manager') && titles.includes('ExampleCo'), 'the title filter drops rows and is called with the employer name');
  check(!companies.some((c) => c.jobs.some((j) => j.url.includes('evil.example'))), 'a posting URL off apply.workable.com is dropped');
  check(!companies.some((c) => c.jobs.some((j) => j.title === 'QA Intern')) && stats.undatedRows === 1, 'an undated row is dropped by default and counted');
  check(companies.map((c) => c.company).join('|') === 'Acme GmbH|ExampleCo' && acme.website === 'https://acme.example', 'postings are grouped per employer, sorted, with the website kept');
  check(stats.rows === 8 && stats.staleRows === 1 && stats.postings === 2, 'stats count rows read, stale rows and postings kept', JSON.stringify(stats));

  const none = await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: () => false, fetchStream: streamOf(text) });
  check(none.companies.map((c) => `${c.company}:${c.jobs.length}`).join('|') === 'Acme GmbH:0|ExampleCo:0' && none.companies[0].website === 'https://acme.example',
    'every employer in the feed is returned, with no postings when none passed', JSON.stringify(none.companies));

  const withUndated = await loadWorkableFeed({ cutoffMs: CUTOFF, includeUndated: true, titleFilter: all, fetchStream: streamOf(text) });
  check(withUndated.companies.some((c) => c.jobs.some((j) => j.title === 'QA Intern' && j.postedAt === undefined)), 'includeUndated keeps an undated posting, with no date');
}
{
  const { companies } = await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: streamOf(feed()) });
  check(Array.isArray(companies) && companies.length === 0, 'a feed with no <job> is an empty result');
  let err = null;
  try { await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: streamOf('<html>Attention Required</html>') }); } catch (e) { err = e; }
  check(/no <source> element/.test(err?.message ?? ''), 'a response without the feed root throws instead of reading as empty');
  // A body cut short after some jobs: no </source>, so it must not read as a smaller feed.
  const full = feed(job({ title: 'QA Engineer', code: 'CUT1' }), job({ title: 'QA Lead', code: 'CUT2' }));
  const cut = full.slice(0, full.indexOf('<job>', full.indexOf('</job>')));
  let err3 = null;
  try { await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: streamOf(cut) }); } catch (e) { err3 = e; }
  check(/ended before <\/source>/.test(err3?.message ?? ''), 'a feed that ends before </source> throws instead of reading as a smaller feed', err3?.message);
  // A "</source>" inside a posting's text is not the end of the document.
  const inside = feed(job({ title: 'QA Engineer', code: 'IN1', description: 'see </source> tag' })).replace(/<\/source>\n$/, '');
  let err4 = null;
  try { await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: streamOf(inside) }); } catch (e) { err4 = e; }
  check(/ended before <\/source>/.test(err4?.message ?? ''), 'a </source> inside a posting does not count as the end of the feed');
  // More kept rows than the ceiling: fail with what to narrow, and stop reading.
  const many = feed(...Array.from({ length: 5 }, (_, i) => job({ title: `QA ${i}`, code: `M${i}` })));
  const manyStream = streamOf(many);
  let err5 = null;
  try { await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: manyStream, maxKeptRows: 3 }); } catch (e) { err5 = e; }
  check(/more than 3 feed rows .*narrow --since or title_filter/.test(err5?.message ?? ''), 'more kept rows than maxKeptRows throws and names what to narrow', err5?.message);
  const underCap = await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: (t) => t === 'QA 0', fetchStream: streamOf(many), maxKeptRows: 3 });
  check(underCap.stats.postings === 1, 'rows the title filter drops do not count against maxKeptRows');
  const boom = new Error('HTTP 503');
  let err2 = null;
  try { await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: all, fetchStream: async () => { throw boom; } }); } catch (e) { err2 = e; }
  check(err2 === boom, 'a failed download propagates to the caller');
}
