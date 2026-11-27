/**
 * batch/jd-rescue.mjs — recovering a JD from a page whose visible text is unusable.
 *
 * Context: the batch runner strips <script>/<style> before counting visible
 * words, which is precisely where a JS-rendered board keeps its job
 * description. In one observed batch run that cost 14 of 24 offers, each
 * failing as "JD file empty/boilerplate" after a worker had already been paid
 * for. Every case below is offline — the one network strategy (the ATS API
 * lookup) answers null for the example.com URLs used here without making a
 * request, so this suite makes no HTTP calls.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

const SCRIPT = join(ROOT, 'batch/jd-rescue.mjs');

/**
 * Run the rescue on an HTML fixture.
 * @returns {{ok:boolean, words:number, method:string, out:string|null}}
 */
function rescue(html, { url = 'https://jobs.example.com/co/abc123', strippedWords = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-'));
  const raw = join(dir, 'page.html');
  const out = join(dir, 'jd.txt');
  writeFileSync(raw, html);
  let stdout = '';
  let ok = true;
  try {
    stdout = execFileSync(NODE, [SCRIPT, url, raw, out, String(strippedWords)], {
      encoding: 'utf-8',
      timeout: 20000,
    });
  } catch (e) {
    ok = false;
    stdout = e.stdout ?? '';
  }
  const [wordsRaw, methodRaw] = String(stdout).trim().split('\t');
  const result = {
    ok,
    words: Number(wordsRaw) || 0,
    method: methodRaw ?? '',
    out: existsSync(out) ? readFileSync(out, 'utf-8') : null,
  };
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  return result;
}

/** Build a description long enough to clear the 80-word floor. */
const longDesc = (marker = 'requirement') =>
  `<p>About the role.</p><ul>${Array.from({ length: 40 }, (_, i) => `<li>${marker} number ${i}</li>`).join('')}</ul>`;

const ldJson = (obj) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head>` +
  `<body><div id="root">You need to enable JavaScript to run this app.</div></body></html>`;

const jobPosting = (over = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Data Scientist',
  description: longDesc(),
  hiringOrganization: { '@type': 'Organization', name: 'Acme' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'New York', addressRegion: 'NY' } },
  ...over,
});

console.log('\njd-rescue.mjs — JD recovery from structured page data');

/* -------------------------------------------------- strategy 1: ld+json */

{
  const r = rescue(ldJson(jobPosting()));
  if (r.ok && r.method === 'ld+json' && r.words >= 80) {
    pass(`ld+json JobPosting recovered (${r.words} words) from a page whose visible text is a JS notice`);
  } else {
    fail(`ld+json not recovered: ok=${r.ok} words=${r.words} method=${r.method}`);
  }
}

{
  const r = rescue(ldJson(jobPosting()));
  const t = r.out ?? '';
  if (t.includes('# Data Scientist') && t.includes('**Company:** Acme') && t.includes('New York, NY')) {
    pass('rescued JD carries title, company and location as a header the worker can read');
  } else {
    fail(`header fields missing from rescued JD: ${JSON.stringify((r.out ?? '').slice(0, 160))}`);
  }
}

{
  // Tags must not survive into the JD file — the worker is handed plain text.
  const r = rescue(ldJson(jobPosting()));
  if (r.out && !/<(p|li|ul|div)\b/i.test(r.out)) {
    pass('HTML inside the ld+json description is stripped to plain text');
  } else {
    fail(`raw HTML leaked into rescued JD: ${JSON.stringify((r.out ?? '').slice(0, 160))}`);
  }
}

{
  // Google-Jobs pages routinely wrap several nodes; only JobPosting counts.
  const html = ldJson([
    { '@type': 'BreadcrumbList', itemListElement: [] },
    { '@type': 'Organization', name: 'Not The Job' },
    jobPosting({ title: 'ML Engineer' }),
  ]);
  const r = rescue(html);
  if (r.ok && (r.out ?? '').includes('# ML Engineer')) {
    pass('JobPosting is selected out of a multi-node ld+json array');
  } else {
    fail(`multi-node ld+json not handled: ok=${r.ok} method=${r.method}`);
  }
}

{
  const r = rescue(ldJson({ '@context': 'https://schema.org', '@graph': [jobPosting({ title: 'Quant Researcher' })] }));
  if (r.ok && (r.out ?? '').includes('# Quant Researcher')) {
    pass('JobPosting nested inside an @graph wrapper is found');
  } else {
    fail(`@graph wrapper not handled: ok=${r.ok} method=${r.method}`);
  }
}

{
  // A broken block is normal (trailing commas, wrapping comments). It must not
  // abort the strategy, or one malformed script tag costs the whole rescue.
  const html =
    '<html><head>' +
    '<script type="application/ld+json">{ "@type": "JobPosting", oops }</script>' +
    `<script type="application/ld+json">${JSON.stringify(jobPosting({ title: 'Second Block' }))}</script>` +
    '</head><body>shell</body></html>';
  const r = rescue(html);
  if (r.ok && (r.out ?? '').includes('# Second Block')) {
    pass('a malformed ld+json block is skipped and a later valid one is still used');
  } else {
    fail(`malformed block aborted the scan: ok=${r.ok} method=${r.method}`);
  }
}

{
  const r = rescue(ldJson(jobPosting({ description: '<p>Ben &amp; Jerry&#39;s &mdash; R&amp;D ' + longDesc() + '</p>' })));
  const t = r.out ?? '';
  if (t.includes('Ben & Jerry\'s') && t.includes('R&D') && !t.includes('&amp;')) {
    pass('HTML entities in the description are decoded, not passed through as &amp;');
  } else {
    fail(`entities not decoded: ${JSON.stringify(t.slice(0, 160))}`);
  }
}

/* ------------------------------------------- acceptance / rejection rules */

{
  // The server-rendered shape: a board that renders its own JD server-side already has
  // more text than the rescue would produce. Overwriting it would be a
  // regression, so the rescue must decline and leave the file alone.
  const r = rescue(ldJson(jobPosting()), { strippedWords: 5000 });
  if (!r.ok && r.method.endsWith(':not-better') && r.out === null) {
    pass('rescue declines when the stripped page already had more JD (out-file untouched)');
  } else {
    fail(`should have declined as not-better: ok=${r.ok} method=${r.method} wrote=${r.out !== null}`);
  }
}

{
  // Same page, but the visible text is thin: now the rescue is the only source
  // of a JD and must win regardless of relative length.
  const r = rescue(ldJson(jobPosting()), { strippedWords: 13 });
  if (r.ok && r.out && r.out.includes('# Data Scientist')) {
    pass('rescue is accepted for a thin page even though the same content was declined for a rich one');
  } else {
    fail(`thin page not rescued: ok=${r.ok} method=${r.method}`);
  }
}

{
  // A rescue that yields another unusable page is not a rescue; reporting
  // success would put the worker back where it started.
  const r = rescue(ldJson(jobPosting({ description: '<p>Apply now.</p>' })));
  if (!r.ok && r.method.endsWith(':thin') && r.out === null) {
    pass('a rescue yielding under 80 words is reported as failure, not success');
  } else {
    fail(`short description wrongly accepted: ok=${r.ok} words=${r.words} method=${r.method}`);
  }
}

/* ------------------------------- strategy 3: embedded hydration payload */

{
  // Ashby ships window.__appData even where ld+json is absent.
  const desc = longDesc('bullet').replace(/"/g, '');
  const html =
    '<html><body><div id="root">You need to enable JavaScript to run this app.</div>' +
    `<script>window.__appData = {"posting":{"title":"DS","descriptionHtml":${JSON.stringify(desc)}}};</script>` +
    '</body></html>';
  const r = rescue(html);
  if (r.ok && r.method === 'embedded-description' && r.words >= 80) {
    pass(`descriptionHtml in a hydration payload is recovered (${r.words} words) when no ld+json exists`);
  } else {
    fail(`embedded description not recovered: ok=${r.ok} words=${r.words} method=${r.method}`);
  }
}

{
  // The JD is the largest such field on the page; a short sibling must not win.
  const big = longDesc('detail').replace(/"/g, '');
  const html =
    '<html><body><script>window.__d = {"description":"Short teaser.",' +
    `"descriptionHtml":${JSON.stringify(big)}};</script></body></html>`;
  const r = rescue(html);
  if (r.ok && r.words >= 80) {
    pass('the longest description-like field is chosen over a short sibling teaser');
  } else {
    fail(`short sibling won: ok=${r.ok} words=${r.words} method=${r.method}`);
  }
}

/* ------------------------------------------------------------- failures */

{
  const r = rescue('<html><body><p>Careers at Example. See our openings.</p></body></html>');
  if (!r.ok && r.method === 'none' && r.out === null) {
    pass('a page with no structured job data fails cleanly (caller routes it to Playwright)');
  } else {
    fail(`expected a clean "none" failure: ok=${r.ok} method=${r.method}`);
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-missing-'));
  let out = '';
  try {
    execFileSync(NODE, [SCRIPT, 'https://x.test/j', join(dir, 'absent.html'), join(dir, 'jd.txt'), '0'], { encoding: 'utf-8' });
  } catch (e) { out = e.stdout ?? ''; }
  if (out.trim().split('\t')[1] === 'no-raw-file') {
    pass('a missing raw-HTML file is reported as no-raw-file rather than crashing');
  } else {
    fail(`missing raw file not handled: ${JSON.stringify(out)}`);
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

{
  let out = '';
  try {
    execFileSync(NODE, [SCRIPT], { encoding: 'utf-8' });
  } catch (e) { out = e.stdout ?? ''; }
  if (out.trim().split('\t')[1] === 'usage') {
    pass('invocation with no arguments reports usage and a non-zero exit');
  } else {
    fail(`missing-args path not handled: ${JSON.stringify(out)}`);
  }
}

// ── review follow-ups: end-tag spelling, ambiguity, chain order, key choice ──
{
  // `</script >` (a space before `>`) is a valid end tag; the strip must treat it as one.
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(jobPosting({ description: longDesc('spaced') }))}</script ></head><body>shell</body></html>`;
  const r = rescue(html);
  if (r.ok && r.method === 'ld+json') pass('a JobPosting block closed with "</script >" is still read');
  else fail(`"</script >" not handled: ${JSON.stringify(r)}`);
}

{
  // Two different postings on one page: taking the first would hand the worker another job's JD.
  const two = `<html><head><script type="application/ld+json">${JSON.stringify([
    jobPosting({ title: 'Role A', description: longDesc('alpha') }),
    jobPosting({ title: 'Role B', description: longDesc('beta') }),
  ])}</script></head><body><div>Loading</div></body></html>`;
  const r = rescue(two);
  if (!r.ok && r.out === null) pass('two distinct JobPostings on one page are ambiguous: no rescue');
  else fail(`ambiguous page was rescued: ${JSON.stringify(r)}`);
}

{
  // The same posting repeated in two blocks is not ambiguous.
  const one = jobPosting({ description: longDesc('dup') });
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(one)}</script><script type="application/ld+json">${JSON.stringify(one)}</script></head><body>x</body></html>`;
  const r = rescue(html);
  if (r.ok && r.method === 'ld+json') pass('the same posting repeated in two blocks is still rescued');
  else fail(`duplicate block not rescued: ${JSON.stringify(r)}`);
}

{
  // A thin first candidate must not stop the chain when a later strategy holds the real JD.
  const thinLd = jobPosting({ description: '<p>Short blurb only.</p>' });
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(thinLd)}</script></head>` +
    `<body><script>window.__appData={"descriptionHtml":${JSON.stringify(longDesc('embedded'))}}</script></body></html>`;
  const r = rescue(html);
  if (r.ok && r.method === 'embedded-description') pass('a thin ld+json candidate does not hide a full embedded description');
  else fail(`chain stopped at the thin candidate: ${JSON.stringify(r)}`);
}

{
  // A bare "description" key labels unrelated content and must not be taken as the JD.
  const html = `<html><body><script>window.x={"description":${JSON.stringify(longDesc('unrelated'))}}</script></body></html>`;
  const r = rescue(html);
  if (!r.ok && r.out === null) pass('a bare "description" key is not treated as the job description');
  else fail(`bare description key was used: ${JSON.stringify(r)}`);
}

{
  // Output is written via a temp file and renamed: nothing is left beside the target.
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-atomic-'));
  const raw = join(dir, 'page.html');
  const out = join(dir, 'jd.txt');
  writeFileSync(raw, ldJson(jobPosting({ description: longDesc('atomic') })));
  writeFileSync(out, 'previous contents');
  execFileSync(NODE, [SCRIPT, 'https://x.test/j', raw, out, '0'], { encoding: 'utf-8', timeout: 20000 });
  const leftovers = readdirSync(dir).filter((f) => f.includes('.rescue-'));
  if (readFileSync(out, 'utf-8') !== 'previous contents' && leftovers.length === 0) pass('the rescue replaces the JD file atomically and leaves no temp file');
  else fail(`atomic write wrong: leftovers=${JSON.stringify(leftovers)}`);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── review round 2: chain continues past a candidate that cannot replace the page ──
{
  // A non-thin page whose first candidate is long enough to clear the floor but NOT longer than
  // the page text must not end the search when a later source holds a fuller JD.
  const mid = jobPosting({ description: longDesc('short').replace(/(<li>.*?<\/li>){0,10}/, '') });
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(jobPosting({ description: `<p>${Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ')}</p>` }))}</script></head>` +
    `<body><script>window.__appData={"descriptionHtml":${JSON.stringify(`<p>${Array.from({ length: 400 }, (_, i) => `full${i}`).join(' ')}</p>`)}}</script></body></html>`;
  const r = rescue(html, { strippedWords: 150 });
  if (r.ok && r.method === 'embedded-description' && r.words >= 400) pass('on a non-thin page, a candidate not longer than the page does not stop the chain');
  else fail(`chain stopped at a candidate that could not replace the page: ${JSON.stringify(r)}`);
}

{
  // End tags may carry attributes or spaces: "</script foo>" closes a script block.
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(jobPosting({ description: longDesc('attr') }))}</script data-x="1"></head><body>shell</body></html>`;
  const r = rescue(html);
  if (r.ok && r.method === 'ld+json') pass('a block closed with "</script data-x>" is still read');
  else fail(`attribute end tag not handled: ${JSON.stringify(r)}`);
}

{
  // The ATS lookup is reused from browser-extract.mjs; an unknown host must cost nothing.
  const r = rescue('<html><body><div>Loading</div></body></html>', { url: 'https://jobs.example.com/co/abc123' });
  if (!r.ok && r.method === 'none') pass('an unrecognised host falls through the ATS lookup without a rescue');
  else fail(`unknown host not handled: ${JSON.stringify(r)}`);
}

/* -------------------------------------------------- escaped markup and entities */

{
  // Phenom ships the description as entity-ESCAPED markup. The tags must be decoded and stripped,
  // and prose entities next to them must survive: a global &lt;/&gt; decode turned "latency &lt; 50 ms"
  // into "<" and the tag strip then ate the prose up to the next ">".
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `&lt;div&gt;&lt;p&gt;${words} Latency must stay &lt; 50 ms &amp; fast. Next sentence stays.&lt;/p&gt;&lt;/div&gt;` })));
  const t = r.out ?? '';
  if (r.ok && !/[<>]/.test(t.replace(/Latency must stay < 50 ms/, '')) && t.includes('Latency must stay < 50 ms & fast. Next sentence stays.')) {
    pass('escaped tags are stripped and prose entities beside them are preserved');
  } else {
    fail(`escaped markup mishandled: ${JSON.stringify(t.slice(-120))}`);
  }
}

{
  // "&lt;b and c&gt;" is not a tag with name=value attributes; it is text.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `&lt;p&gt;${words} Compare &lt;b and c&gt; carefully.&lt;/p&gt;` })));
  if (r.ok && (r.out ?? '').includes('Compare <b and c> carefully.')) pass('a malformed escaped "tag" stays text instead of being stripped');
  else fail(`malformed escaped tag mishandled: ${JSON.stringify((r.out ?? '').slice(-100))}`);
}

{
  // Escaped tags with quoted attributes are still tags.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `&lt;p&gt;${words} See &lt;a href=&quot;https://example.com/x&quot;&gt;the benefits page&lt;/a&gt;.&lt;/p&gt;` })));
  if (r.ok && /See\s+the benefits page/.test(r.out ?? '') && !/[<>]|href/.test(r.out ?? '')) pass('an escaped tag with attributes is stripped to its text');
  else fail(`escaped attribute tag mishandled: ${JSON.stringify((r.out ?? '').slice(-100))}`);
}

{
  // An out-of-range numeric entity used to throw RangeError out of String.fromCodePoint, which
  // ended the whole run with "error" instead of a rescue.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `<p>${words} bad &#99999999; and &#xD800; and &#x110000; entities, then real text.</p>` })));
  if (r.ok && (r.out ?? '').includes('then real text.')) pass('invalid numeric entities read as spaces and do not abort the extraction');
  else fail(`invalid numeric entity aborted the rescue: ${JSON.stringify(r)}`);
}

{
  // An escaped link whose URL carries `&amp;` used to miss the tag pattern, so the raw tag
  // reached the JD text. The `&lt; 50 ms` prose case must still survive.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `<p>${words} See &lt;a href="https://x.example/p?a=1&amp;b=2"&gt;the benefits page&lt;/a&gt;. Latency is &lt; 50 ms.</p>` })));
  const out = r.out ?? '';
  if (r.ok && /See\s+the benefits page/.test(out) && !/<\/?a[\s>]|href|&amp;/.test(out) && /(?:&lt;|<) 50 ms/.test(out)) pass('an escaped link with &amp; in its URL is stripped, and prose "< 50 ms" is kept');
  else fail(`escaped &amp; attribute mishandled: ${JSON.stringify(out.slice(-140))}`);
}

{
  // An unclosed <script>/<style> inside a description is payload, not prose: the
  // rest of the description must not leak into the JD text.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const r = rescue(ldJson(jobPosting({ description: `<p>${words}</p><script>var leaked = "SECRET-PAYLOAD"; never closed` })));
  const out = r.out ?? '';
  if (r.ok && out.includes('w99') && !/SECRET-PAYLOAD|leaked/.test(out)) pass('an unclosed script in a description drops its payload instead of leaking it as text');
  else fail(`unclosed script payload leaked: ${JSON.stringify(out.slice(-120))}`);
}

{
  // Control flow: a closed ATS result ends the chain, whatever the other sources hold,
  // and the runner turns the CLI's exit 3 into a terminal skip.
  const { runRescueChain } = await import(pathToFileURL(join(ROOT, 'batch/jd-rescue.mjs')).href);
  const long = { text: Array.from({ length: 200 }, (_, n) => `w${n}`).join(' '), method: 'embedded' };
  const opts = { minWords: 80, strippedWords: 500, thin: false };
  const closed = await runRescueChain([() => null, () => ({ closed: true, evidence: 'Ashby isListed: false' }), () => long], opts);
  if (closed.closed === true && closed.evidence === 'Ashby isListed: false' && !closed.found) pass('a closed ATS result stops the rescue chain before later sources are used');
  else fail(`closed result did not end the chain: ${JSON.stringify(closed)}`);
  const thinClosed = await runRescueChain([() => long, () => ({ closed: true, evidence: 'x' })], { ...opts, strippedWords: 0, thin: true });
  if (thinClosed.found) pass('without a closure signal the first adequate source still wins');
  else fail('a normal rescue stopped working');
  const { fromKnownApi, rescueDecision, runRescueChain: chainFn } = await import(pathToFileURL(join(ROOT, 'batch/jd-rescue.mjs')).href);
  {
    // A closed ATS answer wins over an adequate JSON-LD description on the same page.
    const words = Array.from({ length: 200 }, (_, n) => `w${n}`).join(' ');
    const pageHtml = ldJson(jobPosting({ description: `<p>${words}</p>` }));
    const o = { minWords: 80, strippedWords: 0, thin: true };
    const closedApi = await rescueDecision('https://jobs.ashbyhq.com/a/1', pageHtml, { ...o, fetchJd: async () => ({ text: 'x y z', closed: true, evidence: 'Ashby isListed: false', ats: 'ashby' }) });
    const openApi = await rescueDecision('https://jobs.ashbyhq.com/a/1', pageHtml, { ...o, fetchJd: async () => null });
    if (closedApi.closed === true && !closedApi.found && openApi.found?.method === 'ld+json') pass('a closed ATS result beats adequate JSON-LD; an open or missing one keeps JSON-LD priority');
    else fail(`ATS closure vs JSON-LD wrong: ${JSON.stringify({ closedApi, openApi: openApi.found?.method })}`);
    const survives = await chainFn([() => { throw new TypeError('toString is not a function'); }, () => ({ text: words, method: 'embedded' })], o);
    if (survives.found?.method === 'embedded') pass('a source that throws does not stop the rescue chain');
    else fail(`a throwing source broke the chain: ${JSON.stringify(survives)}`);
  }
  const viaClosed = await fromKnownApi('https://jobs.ashbyhq.com/a/1', async () => ({ text: 'x y z', closed: true, evidence: 'Ashby isListed: false', ats: 'ashby' }));
  const viaOpen = await fromKnownApi('https://jobs.ashbyhq.com/a/1', async () => ({ text: 'x y z', ats: 'ashby' }));
  const viaCapped = await fromKnownApi('https://jobs.ashbyhq.com/a/1', async () => ({ text: 'x'.repeat(20_000) + '\u2026', ats: 'ashby' }));
  if (viaCapped === null) pass('fromKnownApi treats a capped (truncated) ATS result as a miss'); else fail(`fromKnownApi accepted a capped result: ${JSON.stringify(viaCapped)?.slice(0, 80)}`);
  if (viaClosed?.closed === true && !viaClosed.text && viaOpen?.method === 'ats-api:ashby') pass('fromKnownApi reports a closed ATS result as closure and still returns an open one');
  else fail(`fromKnownApi closure handling wrong: ${JSON.stringify({ viaClosed, viaOpen })}`);
  const src = readFileSync(join(ROOT, 'batch/jd-rescue.mjs'), 'utf8');
  const runner = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8');
  if (/return \{ closed: true, evidence: result\.evidence \}/.test(src) && /process\.exit\(3\)/.test(src)
      && /_rs_rc" -eq 3/.test(runner) && /jd_closed_note="\$jd_rescue_closed_note"/.test(runner)) pass('jd-rescue exits 3 on closure and the runner skips the offer on it');
  else fail('closure is not propagated from jd-rescue to the runner');
}

{
  // The static fetch's own text can be a full JD for a closed role: the CLI must exit 3, not rescue.
  const body = Array.from({ length: 150 }, (_, n) => `w${n}`).join(' ');
  const run = (html) => {
    const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-closed-'));
    writeFileSync(join(dir, 'p.html'), html);
    try {
      execFileSync(NODE, [SCRIPT, 'https://jobs.example.com/co/abc123', join(dir, 'p.html'), join(dir, 'out.txt'), '150'], { encoding: 'utf-8', timeout: 20000 });
      return { code: 0, out: existsSync(join(dir, 'out.txt')) };
    } catch (e) { return { code: e.status, stdout: String(e.stdout) }; }
    finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const expired = run(ldJson(jobPosting({ description: `<p>${body}</p>`, validThrough: '2020-01-01T00:00:00Z' })) + `<p>${body}</p>`);
  if (expired.code === 3 && /^0\tclosed:/.test(expired.stdout)) pass('an expired validThrough on the downloaded page exits 3 even when the page text is a full JD');
  else fail(`expired validThrough not terminal: ${JSON.stringify(expired)}`);
  const banner = run(`${ldJson(jobPosting({ description: `<p>${body}</p>` }))}<p>This job is no longer available.</p><p>${body}</p>`);
  if (banner.code === 3) pass('a closure banner in the downloaded page exits 3');
  else fail(`closure banner not terminal: ${JSON.stringify(banner)}`);
  const open = run(ldJson(jobPosting({ description: `<p>${body}</p>` })) + `<p>${body}</p>`);
  if (open.code !== 3) pass('an open page is not reported as closed');
  else fail('open page exited 3');
  // Named Latin-1 entities decode (and are not turned into spaces).
  const ent = rescue(ldJson(jobPosting({ description: `<p>Caf&eacute; and M&uuml;nchen &Eacute;cole ${body}</p>` })));
  if (ent.ok && ent.out.includes('Café and München École')) pass('named Latin-1 entities (&eacute; &uuml; &Eacute;) decode in a rescued JD');
  else fail(`Latin-1 entities not decoded: ${JSON.stringify((ent.out ?? '').slice(0, 60))}`);
}

{
  // CLI-level: a stubbed closed ATS result makes the real CLI exit 3, even though the page's own
  // JSON-LD is an adequate JD. browser-extract.mjs is replaced through a module resolve hook.
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-cli-ats-'));
  try {
    const hooks = join(dir, 'hooks.mjs');
    writeFileSync(hooks, `export async function resolve(spec, ctx, next) {
  if (spec.endsWith('browser-extract.mjs')) return { url: 'data:text/javascript,' + encodeURIComponent("export async function fetchJdViaKnownApi(){ return process.env.STUB_ATS === 'closed' ? { text: 'a b c', closed: true, evidence: 'Ashby isListed: false', ats: 'ashby' } : null; }"), shortCircuit: true };
  return next(spec, ctx);
}`);
    const reg = join(dir, 'register.mjs');
    writeFileSync(reg, `import { register } from 'node:module'; import { pathToFileURL } from 'node:url'; register(pathToFileURL(${JSON.stringify(hooks)}));`);
    const body = Array.from({ length: 150 }, (_, n) => `w${n}`).join(' ');
    const raw = join(dir, 'p.html');
    writeFileSync(raw, ldJson(jobPosting({ description: `<p>${body}</p>` })));
    const go = (mode) => {
      try {
        const out = execFileSync(NODE, ['--import', pathToFileURL(reg).href, SCRIPT, 'https://jobs.ashbyhq.com/acme/1', raw, join(dir, `o-${mode}.txt`), '0'], { encoding: 'utf-8', timeout: 20000, env: { ...process.env, STUB_ATS: mode } });
        return { code: 0, out };
      } catch (e) { return { code: e.status, out: String(e.stdout) }; }
    };
    const closed = go('closed');
    const open = go('open');
    if (closed.code === 3 && /closed:Ashby isListed: false/.test(closed.out) && !existsSync(join(dir, 'o-closed.txt'))) pass('CLI: a closed ATS result exits 3 and writes no JD even when the page has an adequate JSON-LD');
    else fail(`CLI ATS closure not terminal: ${JSON.stringify(closed)}`);
    if (open.code === 0 && existsSync(join(dir, 'o-open.txt'))) pass('CLI: with the ATS open or missing the JSON-LD JD is still rescued');
    else fail(`CLI open ATS case broke: ${JSON.stringify(open)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

{
  // Off-document download: its HTML is not this posting's. Nothing is rescued from the page, and the
  // CLI tells the runner (exit 4) to drop the other page's text. A redirect to an error URL still closes.
  const body = Array.from({ length: 150 }, (_, n) => `w${n}`).join(' ');
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-offdoc-'));
  try {
    const raw = join(dir, 'p.html');
    writeFileSync(raw, ldJson(jobPosting({ description: `<p>${body}</p>` })));
    const go = (finalUrl) => {
      try { return { code: 0, out: execFileSync(NODE, [SCRIPT, 'https://jobs.example.com/co/abc123', raw, join(dir, 'o.txt'), '0', finalUrl], { encoding: 'utf-8', timeout: 20000 }) }; }
      catch (e) { return { code: e.status, out: String(e.stdout) }; }
    };
    const same = go('https://jobs.example.com/co/abc123');
    const off = go('https://jobs.example.com/co/other-listing');
    const err = go('https://jobs.example.com/co/abc123?error=true');
    if (same.code === 0) pass('same-document final URL: the page JD is rescued as before');
    else fail(`same-document case broke: ${JSON.stringify(same)}`);
    if (off.code === 4 && /page-unusable/.test(off.out)) pass('off-document final URL: nothing is rescued from the page and the CLI exits 4');
    else fail(`off-document not terminal: ${JSON.stringify(off)}`);
    if (err.code === 3 || err.code === 4) pass('a redirect to an error-style URL is never rescued as this posting');
    else fail(`error redirect was rescued: ${JSON.stringify(err)}`);
    const { rescueDecision } = await import(pathToFileURL(join(ROOT, 'batch/jd-rescue.mjs')).href);
    const two = ldJson(jobPosting({ description: `<p>${body}</p>` })) + ldJson(jobPosting({ title: 'Another role', description: `<p>${body} extra</p>` }));
    const apiJd = async () => ({ text: Array.from({ length: 120 }, (_, n) => `a${n}`).join(' '), ats: 'ashby' });
    const ambApi = await rescueDecision('https://jobs.example.com/co/abc123', two, { minWords: 80, strippedWords: 900, thin: false, fetchJd: apiJd });
    if (ambApi.found?.method === 'ats-api:ashby') pass('on an unusable page the discarded text size cannot reject a valid API JD');
    else fail(`API JD rejected by the discarded page's word count: ${JSON.stringify(ambApi)}`);
    const amb = await rescueDecision('https://jobs.example.com/co/abc123', two, { minWords: 80, strippedWords: 0, thin: true, fetchJd: async () => null });
    if (!amb.found && amb.pageUnusable) pass('an ambiguous page (several postings) yields no page-derived JD and is flagged unusable');
    else fail('ambiguous page was rescued');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

{
  // A page over the inspection cap cannot be checked whole: unusable, ATS API still allowed.
  const { rescueDecision } = await import(pathToFileURL(join(ROOT, 'batch/jd-rescue.mjs')).href);
  const words = Array.from({ length: 200 }, (_, n) => `w${n}`).join(' ');
  const big = `"descriptionHtml":"${words}"` + ' '.repeat(3_100_000) + `"descriptionHtml":"${words} other and longer ${words}"`;
  const o = { minWords: 80, strippedWords: 0, thin: true };
  const none = await rescueDecision('https://jobs.example.com/co/abc123', big, { ...o, fetchJd: async () => null });
  const api = await rescueDecision('https://jobs.example.com/co/abc123', big, { ...o, fetchJd: async () => ({ text: words, ats: 'ashby' }) });
  if (!none.found && none.pageUnusable && api.found?.method === 'ats-api:ashby') pass('an oversized page is unusable but the ATS API can still supply the JD');
  else fail(`oversize handling wrong: ${JSON.stringify({ none, api: api.found?.method })}`);
}
