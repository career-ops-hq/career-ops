// tests/providers/applitrack.test.mjs — Frontline AppliTrack provider.
// AppliTrack serves the whole board as one Output.asp script that document.write()s
// the vacancy HTML, so there is no pagination; the cases here are detect() host
// gating, the parser against a fixture in the real (backslash-escaped) shape, and
// the fetch() guards (redirect:'error', slug check before any request).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — applitrack');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/applitrack.mjs')).href);
  const applitrack = mod.default;
  const { parseApplitrackOutput } = mod;

  if (applitrack.id === 'applitrack') pass('applitrack.id is "applitrack"');
  else fail(`applitrack.id is ${JSON.stringify(applitrack.id)}`);

  // ── detect() ──────────────────────────────────────────────────────
  const OUT = 'https://www.applitrack.com/exampledistrict/onlineapp/jobpostings/Output.asp?all=1';
  for (const url of [
    'https://www.applitrack.com/exampledistrict/onlineapp/default.aspx?all=1',
    'https://www.applitrack.com/ExampleDistrict/onlineapp/jobpostings/view.asp',
    'https://applitrack.com/exampledistrict/onlineapp/',
  ]) {
    const hit = applitrack.detect({ name: 'Acme', careers_url: url });
    if (hit && hit.url === OUT) pass(`applitrack.detect() resolves ${url} → Output.asp`);
    else fail(`applitrack.detect(${url}) returned ${JSON.stringify(hit)}`);
  }
  const negatives = {
    'a non-applitrack host': { careers_url: 'https://example.com/exampledistrict/onlineapp/' },
    'a path-spoofed URL': { careers_url: 'https://evil.example/www.applitrack.com/exampledistrict/' },
    'a lookalike host': { careers_url: 'https://www.applitrack.com.evil.example/exampledistrict/' },
    'http': { careers_url: 'http://www.applitrack.com/exampledistrict/onlineapp/' },
    'no slug': { careers_url: 'https://www.applitrack.com/' },
    'a slug with illegal characters': { careers_url: 'https://www.applitrack.com/a%20b/onlineapp/' },
    'a malformed URL': { careers_url: 'not a url' },
    'null careers_url': { careers_url: null },
    'a non-string careers_url': { careers_url: 7 },
    'no careers_url': {},
  };
  for (const [label, extra] of Object.entries(negatives)) {
    let got;
    try { got = applitrack.detect({ name: 'X', ...extra }); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`applitrack.detect() returns null for ${label}`);
    else fail(`applitrack.detect() for ${label} returned ${JSON.stringify(got)}`);
  }

  // ── parser ────────────────────────────────────────────────────────
  // Real responses carry backslash-escaped quotes (the HTML is inside JS strings).
  const posting = (id, title, type, posted, site) =>
    `<table class=\\'title\\' style=\\'padding: 0px;\\'><tr><td id=\\'wrapword\\' style=\\'width: 950px;\\'>${title}</td>` +
    `<td><span class=\\'title2\\'> JobID: ${id} <input type=\\'button\\' value=\\' Apply \\' /></span></td></tr></table>` +
    `<div><li><span class=\\'label\\'>Position Type:</span><br/>&nbsp;&nbsp;<span class=\\'normal\\'>${type}</span><br/><br/></li>` +
    `<li><span class="label" >Date Posted:</span><br/>&nbsp;&nbsp;<span class="normal">${posted}</span><br/><br/></li>` +
    `<li><span class="label" >Location:</span><br/>&nbsp;&nbsp;<span class="normal">${site}</span><br/><br/></li></div>`;
  const prelude = 'function applyFor(posJobCode){ return true }\nvar VacanciesAreOnThisPage = true\n';
  const BASE = 'https://www.applitrack.com/exampledistrict/onlineapp';
  const body = prelude
    + posting(101, 'Math Teacher', 'Certificated', '9/8/2026', 'Example High School, Exampleville, WA')
    + posting(102, 'Custodian &amp; Grounds', 'Classified', '7/2/2026', 'District')
    + posting(103, 'Coach � Head Baseball', 'Athletics', '13/45/2026', 'Example High School')
    + posting(104, '', 'Classified', '1/1/2026', 'District')              // no title → dropped
    + posting(101, 'Math Teacher (duplicate id)', 'Certificated', '9/8/2026', 'District'); // repeated id → dropped

  const jobs = parseApplitrackOutput(body, 'Acme', BASE, 'Exampleville, WA');
  if (jobs.length === 3) pass('parseApplitrackOutput keeps rows with an id + title, drops blank-title and repeated-id rows');
  else fail(`parseApplitrackOutput returned ${jobs.length} jobs (expected 3)`);

  if (jobs[0]?.url === `${BASE}/default.aspx?AppliTrackJobId=101&AppliTrackLayoutMode=detail&AppliTrackViewPosting=1`
      && jobs[0]?.company === 'Acme') {
    pass('parseApplitrackOutput builds the detail URL from the JobID and sets company');
  } else fail(`parseApplitrackOutput url/company was ${JSON.stringify(jobs[0])}`);

  if (jobs[1]?.title === 'Custodian & Grounds') pass('parseApplitrackOutput decodes entities in the title before returning it (&amp; → &)');
  else fail(`parseApplitrackOutput title[1] was ${JSON.stringify(jobs[1]?.title)}`);

  if (jobs[2]?.title === 'Coach Head Baseball') pass('parseApplitrackOutput strips U+FFFD (a Windows-1252 byte decoded as UTF-8)');
  else fail(`parseApplitrackOutput title[2] was ${JSON.stringify(jobs[2]?.title)}`);

  if (jobs[0]?.location === 'Example High School, Exampleville, WA') pass('parseApplitrackOutput leaves a site that already names the default city as-is');
  else fail(`parseApplitrackOutput location[0] was ${JSON.stringify(jobs[0]?.location)}`);
  if (jobs[1]?.location === 'District - Exampleville, WA') pass('parseApplitrackOutput appends default_location when the site names no place');
  else fail(`parseApplitrackOutput location[1] was ${JSON.stringify(jobs[1]?.location)}`);
  const noDefault = parseApplitrackOutput(body, 'Acme', BASE);
  if (noDefault[1]?.location === 'District') pass('parseApplitrackOutput without a default_location keeps the raw site name');
  else fail(`parseApplitrackOutput no-default location was ${JSON.stringify(noDefault[1]?.location)}`);

  if (jobs[0]?.postedAt === Date.UTC(2026, 8, 8)) pass('parseApplitrackOutput reads m/d/yyyy Date Posted as UTC epoch ms');
  else fail(`parseApplitrackOutput postedAt[0] was ${jobs[0]?.postedAt}`);
  if (jobs[2] && !('postedAt' in jobs[2])) pass('parseApplitrackOutput omits postedAt for an unparseable date (NaN-safe)');
  else fail(`parseApplitrackOutput postedAt[2] was ${jobs[2]?.postedAt}`);

  // the same fixture with plain (unescaped) quotes parses identically
  const plain = parseApplitrackOutput(body.replace(/\\'/g, "'"), 'Acme', BASE, 'Exampleville, WA');
  if (plain.length === 3) pass('parseApplitrackOutput also accepts unescaped quotes');
  else fail(`parseApplitrackOutput unescaped fixture returned ${plain.length} jobs`);

  // empty / wrong-shape bodies
  for (const empty of ['', '   \n', null, undefined]) {
    if (parseApplitrackOutput(empty, 'X', BASE).length === 0) pass(`parseApplitrackOutput ${JSON.stringify(empty)} → []`);
    else fail(`parseApplitrackOutput ${JSON.stringify(empty)} should be []`);
  }
  if (parseApplitrackOutput(prelude, 'X', BASE).length === 0) pass('parseApplitrackOutput valid script with no postings → [] (an empty board)');
  else fail('parseApplitrackOutput should return [] for an empty board');
  try {
    parseApplitrackOutput('<html><body>Sign in to continue</body></html>', 'X', BASE);
    fail('parseApplitrackOutput should throw on a body that is not an Output.asp script');
  } catch (e) {
    if (/not an AppliTrack/i.test(e.message)) pass('parseApplitrackOutput throws a descriptive error on a non-Output.asp body');
    else fail(`parseApplitrackOutput threw an unhelpful error: ${e.message}`);
  }

  // ── fetch() ───────────────────────────────────────────────────────
  const calls = [];
  const ctx = {
    fetchText: async (url, opts) => { calls.push({ url, opts }); return body; },
    sleep: async () => {},
  };
  const entry = { name: 'Acme', careers_url: 'https://www.applitrack.com/exampledistrict/onlineapp/default.aspx', default_location: 'Exampleville, WA' };
  const fetched = await applitrack.fetch(entry, ctx);
  if (fetched.length === 3 && calls.length === 1 && calls[0].url === OUT) pass('applitrack.fetch() makes one Output.asp request and returns the parsed jobs');
  else fail(`applitrack.fetch() made ${calls.length} calls to ${calls[0]?.url}, ${fetched.length} jobs`);
  if (calls.every((c) => c.opts?.redirect === 'error')) pass("applitrack.fetch() passes redirect: 'error' on every request");
  else fail(`applitrack.fetch() redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);

  // an unusable entry is refused BEFORE any network call
  const before = calls.length;
  try {
    await applitrack.fetch({ name: 'Evil', careers_url: 'https://evil.example/exampledistrict/onlineapp/' }, ctx);
    fail('applitrack.fetch() should throw for a non-applitrack careers_url');
  } catch (e) {
    if (calls.length === before && /cannot derive district slug/.test(e.message)) pass('applitrack.fetch() throws on a bad careers_url before any request');
    else fail(`applitrack.fetch() bad-url: ${calls.length - before} calls, message ${e.message}`);
  }

  // a transient failure is retried; a non-transient one is not
  let attempts = 0;
  const flaky = { fetchText: async () => { attempts++; if (attempts < 2) { const e = new Error('HTTP 503'); e.status = 503; throw e; } return body; }, sleep: async () => {} };
  const recovered = await applitrack.fetch(entry, flaky);
  if (recovered.length === 3 && attempts === 2) pass('applitrack.fetch() retries a 503 and recovers');
  else fail(`applitrack.fetch() flaky: ${attempts} attempts, ${recovered.length} jobs`);
  let hard = 0;
  const notFound = { fetchText: async () => { hard++; const e = new Error('HTTP 404'); e.status = 404; throw e; }, sleep: async () => {} };
  try { await applitrack.fetch(entry, notFound); fail('applitrack.fetch() should throw on a 404'); }
  catch { if (hard === 1) pass('applitrack.fetch() does not retry a 404'); else fail(`applitrack.fetch() retried a 404 ${hard} times`); }
} catch (e) {
  fail(`applitrack provider tests crashed: ${e.stack || e.message}`);
}
