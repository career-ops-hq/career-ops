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
