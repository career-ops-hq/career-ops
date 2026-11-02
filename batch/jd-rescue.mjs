#!/usr/bin/env node
/**
 * jd-rescue.mjs — recover a job description from a page whose *visible* text is
 * too thin to use, before the batch runner spends a worker on it.
 *
 * Usage:  node batch/jd-rescue.mjs <url> <raw-html-file> <out-file> [stripped-words]
 * Output: "<words>\t<method>" on stdout; exit 0 on success, 1 on failure.
 *         On success <out-file> is overwritten with clean plain text.
 *
 * WHY THIS EXISTS
 *
 * The runner strips <script> and <style> blocks before counting visible words,
 * so a JS-rendered board scores near zero and the JD file is emptied — the
 * worker is then told to WebFetch, which hits the same wall from the same kind
 * of address and fails. Observed in one batch run: 14 of 24 offers
 * (58% of the run's spend) died as "JD file empty/boilerplate; WebFetch
 * returned only title/company", and the failures clustered by ATS vendor, not
 * randomly — 6/7 Ashby (jobs.ashbyhq.com/acme/...) and 6/9 Greenhouse-embedded
 * (careers.example.com/job?gh_jid=...), while 7/7 plain boards.greenhouse.io
 * postings in the same run succeeded.
 *
 * The decisive finding: for those pages the description was *already in the
 * bytes curl downloaded*, inside the very <script> blocks the strip discards.
 * The same Ashby posting that stripped down to 13 words ("Data Scientist @ Acme
 * You need to enable JavaScript to run this app.") carries 898 words of clean
 * JD in its application/ld+json JobPosting. Nothing needs to be re-fetched and
 * no browser needs to run — the data just has to be read out of the right place.
 *
 * Strategies run in order, cheapest first. 1 and 3 are pure offline parsing of
 * bytes already on disk; only 2 makes a network request, a single
 * unauthenticated JSON GET to the ATS's public API. All three are zero-LLM-token.
 *
 * WHEN A RESCUE IS ACCEPTED
 *
 * A thin page is not the only failure shape, and the word count alone does not
 * separate them. The embed pages stripped to 126 words — above the
 * runner's 80-word floor — so they were never flagged as thin; the worker was
 * handed 126 words of the company's own page chrome and correctly reported that
 * it had no job description. What actually distinguishes those pages is not how
 * much text they have but *where the JD lives*: the posting is served from
 * the ATS's own API, a different origin than the document curl fetched,
 * so no amount of parsing that document can produce it.
 *
 * Hence two accept conditions rather than one:
 *   - the stripped page is thin (< minWords), or
 *   - the rescued text is longer than the stripped page, meaning the visible
 *     text was demonstrably missing content the structured source has.
 * A structured JobPosting is high-precision, so "longer" here means "more JD",
 * not "more navigation". Where the stripped page already wins — a canonical
 * Greenhouse board posting renders its own JD server-side — the rescue is
 * rejected and the existing text is kept untouched, so pages that work today
 * cannot regress.
 */

import fs from 'node:fs';

const HTML_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  '#160': ' ', '#xa0': ' ', '#x27': "'", '#38': '&', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
};

/** Strip HTML to visible text, matching the runner's own normalization. */
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style[^>]*>/gi, ' ')
    // Keep block boundaries as line breaks so requirement lists do not run
    // together into one unreadable paragraph for the worker.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (HTML_ENTITIES[k] !== undefined) return HTML_ENTITIES[k];
      const dec = /^#(\d+)$/.exec(k);
      if (dec) return String.fromCodePoint(Number(dec[1]));
      const hex = /^#x([0-9a-f]+)$/.exec(k);
      if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
      return ' ';
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;

/** Assemble a JD document from the structured fields an ATS exposes. */
function composeJd({ title, company, location, description, employmentType }) {
  const head = [
    title && `# ${title}`,
    company && `**Company:** ${company}`,
    location && `**Location:** ${location}`,
    employmentType && `**Employment type:** ${employmentType}`,
  ].filter(Boolean).join('\n');
  const body = htmlToText(description);
  return [head, body].filter(Boolean).join('\n\n').trim();
}

/* ---------------------------------------------------------------- strategy 1
 * schema.org JobPosting in <script type="application/ld+json">.
 *
 * This is the broadest single win available: Ashby, Lever, SmartRecruiters,
 * Workable, Recruitee and many bespoke career sites all emit it for Google Jobs
 * indexing, which means they emit it whether or not their UI needs JavaScript.
 * A page can carry several ld+json blocks (BreadcrumbList, Organization), and
 * a block may itself be an array or an @graph wrapper, so every shape is walked
 * and only JobPosting nodes are kept.
 */
function fromLdJson(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script[^>]*>/gi;
  // Collect every distinct JobPosting on the page. A listing page can carry
  // several, and taking the first would hand the worker some other job's JD, so
  // a rescue is only offered when exactly one posting qualifies.
  const candidates = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    let parsed;
    // A malformed block is normal (trailing commas, HTML comments wrapping the
    // JSON). Skip it and keep looking rather than aborting the whole strategy.
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }

    const queue = [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);

      const type = node['@type'];
      const isJobPosting = Array.isArray(type)
        ? type.includes('JobPosting')
        : type === 'JobPosting';
      if (!isJobPosting || !node.description) continue;

      const loc = node.jobLocation;
      const locNode = Array.isArray(loc) ? loc[0] : loc;
      const addr = locNode?.address ?? locNode;
      const location = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
        .map((v) => (typeof v === 'object' ? v?.name : v))
        .filter(Boolean).join(', ');

      const text = composeJd({
        title: node.title,
        company: node.hiringOrganization?.name ?? node.hiringOrganization,
        location: location || undefined,
        description: node.description,
        employmentType: Array.isArray(node.employmentType)
          ? node.employmentType.join(', ') : node.employmentType,
      });
      if (wordCount(text) > 0) candidates.set(text, { text, method: 'ld+json' });
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

/* ---------------------------------------------------------------- strategy 2
 * The ATS's own public API, through upstream's fetchJdViaKnownApi().
 *
 * A company that embeds Greenhouse on its own careers domain
 * (careers.example.com/job?gh_jid=1234567) serves a host page with no JD text
 * in it, and the posting lives on another origin, so no amount of parsing the
 * downloaded document can produce it. browser-extract.mjs already knows how to
 * ask the right API for every ATS in JD_TEXT_API_ATS (the same dispatch
 * fetch-jd.mjs and the `jd` mode use), so this strategy calls it rather than
 * carrying a second copy of the per-ATS code. A URL it does not recognise
 * answers null without any network request.
 */
async function fromKnownApi(url) {
  try {
    const { fetchJdViaKnownApi } = await import('../browser-extract.mjs');
    const result = await fetchJdViaKnownApi(url, 20_000, 15_000);
    if (!result?.text) return null;
    const text = result.title ? `${result.title}\n\n${result.text}` : result.text;
    return { text, method: `ats-api:${result.ats}` };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- strategy 3
 * Ashby's hydration payload.
 *
 * Fallback for the case where Ashby ships window.__appData but no ld+json.
 * Rather than parse the whole bootstrap object (its shape is not contractual),
 * pull the descriptionHtml/descriptionPlainText/jobDescriptionHtml string values
 * directly (a bare `description` key is too generic: it also labels unrelated
 * page content) and take the longest — the JD is by a wide margin the biggest such field on the page.
 */
function fromEmbeddedDescription(html) {
  const re = /"(descriptionHtml|descriptionPlainText|jobDescriptionHtml)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let best = '';
  let m;
  while ((m = re.exec(html)) !== null) {
    let raw;
    try { raw = JSON.parse(`"${m[2]}"`); } catch { continue; }
    const text = htmlToText(raw);
    if (text.length > best.length) best = text;
  }
  if (!best) return null;
  return { text: best, method: 'embedded-description' };
}

async function main() {
  const [url, rawFile, outFile, strippedArg] = process.argv.slice(2);
  const minWords = Number(process.env.JD_RESCUE_MIN_WORDS || 80);
  const timeoutMs = Number(process.env.JD_RESCUE_TIMEOUT_MS || 12000);
  const strippedWords = Number.isFinite(Number(strippedArg)) ? Number(strippedArg) : 0;
  const thin = strippedWords < minWords;

  if (!url || !rawFile || !outFile) {
    process.stdout.write('0\tusage\n');
    process.exit(1);
  }

  let html = '';
  try { html = fs.readFileSync(rawFile, 'utf-8'); } catch {
    process.stdout.write('0\tno-raw-file\n');
    process.exit(1);
  }

  // First strategy whose text clears the word floor AND, when the page is not
  // thin, is longer than the page's own text, wins. A candidate that fails
  // either test must not stop the chain: a later source may hold the full JD.
  let found = null;
  let thinFound = null;
  let notBetter = null;
  for (const run of [
    () => fromLdJson(html),
    () => fromKnownApi(url),
    () => fromEmbeddedDescription(html),
  ]) {
    const candidate = await run();
    if (!candidate) continue;
    const w = wordCount(candidate.text);
    if (w < minWords) { thinFound ??= candidate; continue; }
    // Never replace a page that already had more JD than the rescue found —
    // see "WHEN A RESCUE IS ACCEPTED" above.
    if (!thin && w <= strippedWords) { notBetter ??= candidate; continue; }
    found = candidate;
    break;
  }

  if (!found) {
    // A rescue that yields another thin page is not a rescue. Reporting it as
    // one would put the worker back in exactly the position this module exists
    // to avoid, so it is a failure and the caller routes the offer to Playwright.
    if (notBetter) process.stdout.write(`${wordCount(notBetter.text)}\t${notBetter.method}:not-better\n`);
    else if (thinFound) process.stdout.write(`${wordCount(thinFound.text)}\t${thinFound.method}:thin\n`);
    else process.stdout.write('0\tnone\n');
    process.exit(1);
  }

  const words = wordCount(found.text);
  // Write beside the target and rename, so a failed write leaves the existing
  // JD file intact for the fallbacks that follow.
  const tmp = `${outFile}.rescue-${process.pid}`;
  try {
    fs.writeFileSync(tmp, found.text);
    fs.renameSync(tmp, outFile);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
  process.stdout.write(`${words}\t${found.method}\n`);
}

main().catch(() => {
  process.stdout.write('0\terror\n');
  process.exit(1);
});
