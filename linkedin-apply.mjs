#!/usr/bin/env node
/**
 * linkedin-apply.mjs - resolve a LinkedIn posting to the employer's real ATS application URL.
 *
 * WHY THIS EXISTS
 * A LinkedIn posting URL is not applyable. `openSession()` in the web app opens a
 * fresh, cookie-less browser context, so linkedin.com/jobs/view/<id> serves the
 * authwall and the apply flow dead-ends (issue #7).
 *
 * The obvious fix does not work. LinkedIn's public guest endpoint returns the full
 * posting with no auth, and it does say WHETHER a job applies offsite, but it does
 * not expose WHERE: the destination sits behind the contextual sign-in modal, and
 * the page carries no JSON-LD. So the apply URL has to be reconstructed, not read.
 *
 * This module reconstructs it from the two things the guest page does give us, the
 * employer and the job title, by reusing machinery career-ops already ships:
 *   1. guest endpoint            -> company, title, location, offsite-apply flag
 *   2. discover-ats resolveCompany -> the employer's live Greenhouse/Ashby/Lever board
 *   3. that board's provider       -> its current job list
 *   4. title matching here         -> the one posting that corresponds
 * Zero LLM tokens, zero auth, no browser.
 *
 * MATCHING IS DELIBERATELY CONSERVATIVE. A false match sends a real application to
 * the wrong role, which is worse than not resolving at all. This never auto-picks a
 * merely-plausible candidate: it returns `ambiguous` with a ranked list and lets a
 * human choose. See pickMatch() for the exact policy.
 *
 * Run: node linkedin-apply.mjs <linkedin-job-url> [--json|--summary]
 *      node linkedin-apply.mjs --self-test
 *
 * Issue #7 - github.com/EliRobinson/career-ops
 */

import { readFileSync, writeFileSync } from 'fs';

import { isMainModule } from './lib/is-main-module.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { resolveCompany, deriveSlug, SLUG_RE } from './discover-ats.mjs';
import { jaccardSimilarity, hardMismatch } from './jd-similarity.mjs';
import greenhouse from './providers/greenhouse.mjs';
import ashby from './providers/ashby.mjs';
import lever from './providers/lever.mjs';
import workday from './providers/workday.mjs';

/** vendor id (as returned by resolveCompany) -> the provider that reads its board. */
const PROVIDERS = {
  greenhouse,
  ashby,
  lever,
  workday,
};

/** Guest endpoint for one posting. `id` is digits-only by construction (see
 *  linkedInJobId), so nothing user-supplied is ever spliced into the host. */
const GUEST_POSTING_URL = (id) => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;

/** A posting page is ~80KB; this bounds a hostile or runaway response. */
const MAX_GUEST_BYTES = 2_000_000;

// ── Matching thresholds ───────────────────────────────────────────────
// Tuned to refuse rather than guess. ACCEPT is the floor for calling a match
// resolved; MARGIN is how far clear of the runner-up the winner must be, so a
// board listing "Senior Engineer, Payments" and "Senior Engineer, Risk" against a
// LinkedIn title of "Senior Engineer" stays ambiguous instead of coin-flipping.
const ACCEPT_THRESHOLD = 0.75;
const ACCEPT_MARGIN = 0.15;
/** Below this a candidate is not even worth showing the user. */
const CANDIDATE_FLOOR = 0.3;

// ── Guest page parsing (pure) ─────────────────────────────────────────

/**
 * The numeric LinkedIn job id, or null when the URL is not one posting.
 *
 * Mirrors `linkedInJobId` in web/src/lib/job-url.mjs. Kept as its own copy on
 * purpose: root scripts and the Next app cannot share a module (Next's bundler
 * statically traces root .mjs literals and fails the production build), and this
 * is small enough that a duplicated regex beats a build-breaking import. The
 * self-test below pins the shared cases so the two cannot drift silently.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function linkedInJobId(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.match(/\/jobs\/view\/([^/]+)/i);
  if (seg) {
    if (/^\d+$/.test(seg[1])) return seg[1];
    // "senior-ai-engineer-at-acme-4434693435": the id is the trailing number.
    // 6+ digits so a title ending in "-2" cannot be read as a job id.
    const tail = seg[1].match(/-(\d{6,})$/);
    if (tail) return tail[1];
  }
  // Collections and search views carry the id only in the query string.
  const cur = u.searchParams.get('currentJobId');
  return cur && /^\d+$/.test(cur) ? cur : null;
}

/** The named entities LinkedIn actually emits in topcard text. */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Decode HTML entities in ONE pass.
 *
 * Deliberately a single regex rather than a chain of .replace() calls. Chaining
 * double-unescapes: decoding `&amp;` first rewrites `&amp;lt;` to `&lt;`, which
 * the next replacement then turns into `<`, so a company literally named
 * "A&lt;B" would come out as "A<B" (CodeQL js/double-escaping). One pass
 * consumes each entity exactly once and never re-scans its own output.
 *
 * An unrecognized or out-of-range entity is left verbatim: this text becomes a
 * company name and a job title used for matching, where a wrong character is
 * worse than an undecoded one.
 *
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return String(s ?? '').replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (match, dec, hex, name) => {
      if (dec !== undefined || hex !== undefined) {
        const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
        // Valid Unicode scalar values only; surrogates and out-of-range are left as-is.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
        return String.fromCodePoint(code);
      }
      const named = NAMED_ENTITIES[name.toLowerCase()];
      return named === undefined ? match : named;
    },
  );
}

function collapse(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/**
 * Strip em dashes from text that reaches the user.
 *
 * `reason` strings are passed through from discover-ats, whose own messages use
 * em dashes. They surface verbatim in --summary output and in the web UI later,
 * and AGENTS.md bans the em dash in anything the user reads. Sanitizing here at
 * the boundary keeps the rule without editing a shared system-layer file.
 *
 * @param {string} s
 * @returns {string}
 */
function noEmDash(s) {
  return String(s ?? '').replace(/\s*—\s*/g, ': ').replace(/:\s*:/g, ':');
}

/**
 * Pull the fields we need out of a guest posting page.
 *
 * Selectors verified against live guest responses: the title is an <h2> carrying
 * `topcard__title`, the employer is the `topcard__org-name-link` anchor (whose
 * href carries the company slug), the location is the `topcard__flavor--bullet`
 * span, and an offsite apply is marked by `apply-button__offsite-apply-icon-svg`
 * / a `public_jobs_apply-link-offsite` impression id.
 *
 * Regex rather than a DOM parser because the repo has no HTML-parsing dependency
 * and these four anchors are stable, well-delimited attributes. Every field is
 * independently optional: a layout change degrades one field rather than throwing.
 *
 * @param {string} html
 * @returns {{title: string, company: string, companySlug: string, location: string, offsiteApply: boolean}}
 */
export function parseGuestPosting(html) {
  const h = String(html ?? '');
  const title = collapse((h.match(/<h2[^>]*\btopcard__title\b[^>]*>([\s\S]{0,300}?)<\/h2>/i) || [])[1] || '');
  const orgAnchor = h.match(/<a[^>]*\btopcard__org-name-link\b[^>]*>([\s\S]{0,200}?)<\/a>/i);
  const company = collapse((orgAnchor || [])[1] || '');
  const slugMatch = h.match(/linkedin\.com\/company\/([A-Za-z0-9._-]+)/i);
  const companySlug = slugMatch ? slugMatch[1] : '';
  const location = collapse(
    (h.match(/<span[^>]*\btopcard__flavor--bullet\b[^>]*>([\s\S]{0,200}?)<\/span>/i) || [])[1] || '',
  );
  const offsiteApply = /apply-button__offsite-apply-icon-svg|public_jobs_apply-link-offsite/i.test(h);
  return { title, company, companySlug, location, offsiteApply };
}

// ── Title matching (pure) ─────────────────────────────────────────────

/**
 * Strip the decoration that differs between how LinkedIn renders a title and how
 * the employer's own board does, so the two become comparable:
 * bracketed asides ("(Remote)", "(m/w/d)"), a trailing req id, and separator
 * noise. What survives is the role words.
 *
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return decodeEntities(String(title ?? ''))
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // (Remote), (m/w/d), (Contract)
    .replace(/\[[^\]]*\]/g, ' ')      // [Amsterdam]
    .replace(/\b(?:req|job|posting|ref)[\s#:-]*[a-z0-9-]*\d[a-z0-9-]*\b/g, ' ')
    .replace(/[^a-z0-9+#./ ]+/g, ' ') // keep c++, .net, ci/cd
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How well two titles correspond, in [0, 1].
 *
 * Exact match after normalization scores 1. Otherwise this is token Jaccard, which
 * handles the common real difference (a board title carrying an extra team or
 * location word) without treating word order as meaningful.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function titleScore(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return jaccardSimilarity(na, nb);
}

/**
 * Choose the board posting that corresponds to a LinkedIn title, or refuse.
 *
 * Policy, in order:
 *  - A seniority difference (jd-similarity's hardMismatch) DISQUALIFIES a candidate
 *    outright. "Senior Data Engineer" must never resolve to "Staff Data Engineer";
 *    that is the single most damaging wrong answer this function could give.
 *  - Candidates below CANDIDATE_FLOOR are dropped as noise.
 *  - `resolved` requires BOTH a score at or above ACCEPT_THRESHOLD AND a lead of at
 *    least ACCEPT_MARGIN over the runner-up. A strong score alone is not enough,
 *    because two sibling postings can both match a vague LinkedIn title well.
 *  - Anything else is `ambiguous`: ranked candidates, no pick.
 *
 * Location breaks a near-tie only. It never disqualifies, because LinkedIn and the
 * employer's board routinely disagree about how to spell the same place ("Remote"
 * vs "Seattle, WA" vs "United States").
 *
 * @param {string} linkedInTitle
 * @param {Array<{title: string, url: string, location?: string}>} jobs
 * @param {{location?: string}} [opts]
 * @returns {{status: 'resolved'|'ambiguous'|'unresolved', match: object|null, candidates: object[], reason: string}}
 */
export function pickMatch(linkedInTitle, jobs, opts = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!linkedInTitle || list.length === 0) {
    return { status: 'unresolved', match: null, candidates: [], reason: 'no board postings to match against' };
  }

  const wantLoc = normalizeTitle(opts.location || '');
  const scored = list
    .filter((j) => j && j.title && j.url)
    .map((j) => {
      const score = titleScore(linkedInTitle, j.title);
      // A shared location token is worth a nudge, never a verdict.
      const jl = normalizeTitle(j.location || '');
      const locBonus = wantLoc && jl && (jl.includes(wantLoc) || wantLoc.includes(jl)) ? 0.05 : 0;
      return {
        title: j.title,
        url: j.url,
        location: j.location || '',
        score: Math.min(1, score + locBonus),
        levelMismatch: hardMismatch(linkedInTitle, j.title),
      };
    })
    .filter((c) => !c.levelMismatch && c.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: 'unresolved', match: null, candidates: [], reason: 'no posting on the board resembles this title' };
  }

  const [best, runnerUp] = scored;
  const margin = best.score - (runnerUp ? runnerUp.score : 0);
  if (best.score >= ACCEPT_THRESHOLD && margin >= ACCEPT_MARGIN) {
    return { status: 'resolved', match: best, candidates: scored.slice(0, 5), reason: 'unique high-confidence title match' };
  }
  return {
    status: 'ambiguous',
    match: null,
    candidates: scored.slice(0, 5),
    reason:
      best.score < ACCEPT_THRESHOLD
        ? 'closest posting is below the confidence floor, so it is listed rather than chosen'
        : 'several postings match this title closely, so none was chosen automatically',
  };
}

// ── Live resolution ───────────────────────────────────────────────────

/**
 * Fetch a guest posting page.
 * @param {string} jobId digits only
 * @param {object} ctx makeHttpCtx()
 * @returns {Promise<string>}
 */
export async function fetchGuestPosting(jobId, ctx) {
  const text = await ctx.fetchText(GUEST_POSTING_URL(jobId));
  return String(text ?? '').slice(0, MAX_GUEST_BYTES);
}

/**
 * Corporate-form suffixes LinkedIn appends to disambiguate a company vanity URL
 * ("whatnot-inc"). Safe to strip because they denote legal form rather than brand.
 * Deliberately NOT stripping things like "ai" or "hq": those are part of the brand
 * (assembledhq IS the Ashby board slug), so removing them loses real matches.
 */
const CORPORATE_SUFFIX = /-(?:inc|llc|ltd|limited|corp|gmbh|bv|ag|sa|plc)$/i;

/**
 * Slugs worth probing for one posting, most likely first, deduped.
 *
 * Two independent sources, and each one wins cases the other loses:
 *  - the display name ("Gradial" -> "gradial") resolves boards whose LinkedIn
 *    vanity URL carries a suffix ("gradialai")
 *  - the LinkedIn company slug resolves boards the display name cannot
 *    ("Assembled" -> "assembled" 404s, but "assembledhq" is the live Ashby board)
 * Trying only one of them, which is all `resolveCompany` does per call, silently
 * loses whichever half the other would have caught.
 *
 * @param {{company: string, companySlug?: string}} posting
 * @returns {string[]}
 */
export function candidateSlugs(posting) {
  const out = [];
  const add = (s) => {
    if (s && SLUG_RE.test(s) && !out.includes(s)) out.push(s);
  };
  add(deriveSlug(posting.company || ''));
  const li = String(posting.companySlug || '').toLowerCase();
  add(li);
  if (CORPORATE_SUFFIX.test(li)) add(li.replace(CORPORATE_SUFFIX, ''));
  return out;
}

/**
 * Find the employer's live board, trying each candidate slug in turn.
 *
 * @param {{company: string, companySlug?: string}} posting
 * @param {object} ctx
 * @returns {Promise<{resolved: object|null, reason: string}>}
 */
export async function resolveBoard(posting, ctx) {
  const slugs = candidateSlugs(posting);
  let lastReason = 'no usable company slug could be derived';
  for (const slug of slugs) {
    // `ctx` is required, not optional: resolveCompany has no default for it (only
    // runDiscovery supplies one), and omitting it fails every probe with an opaque
    // "cannot read properties of undefined" rather than a network error.
    const { resolved, unresolved } = await resolveCompany({ name: posting.company, slug }, { ctx });
    if (resolved) return { resolved, reason: `resolved via slug "${slug}"` };
    lastReason = unresolved?.reason ?? lastReason;
  }
  return { resolved: null, reason: noEmDash(`tried slug(s) ${slugs.map((s) => `"${s}"`).join(', ') || '(none)'}: ${lastReason}`) };
}

/**
 * Read the employer's live board through the same provider `scan.mjs` uses, so a
 * URL resolved here is one the rest of the pipeline already knows how to handle.
 *
 * @param {{name: string, vendor: string, slug: string, careers_url: string, api?: string}} board
 * @param {object} ctx
 * @returns {Promise<Array<{title: string, url: string, location?: string}>>}
 */
export async function fetchBoardJobs(board, ctx) {
  const provider = PROVIDERS[board.vendor];
  if (!provider) return [];
  const entry = { name: board.name, careers_url: board.careers_url };
  if (board.api) entry.api = board.api;
  const jobs = await provider.fetch(entry, ctx);
  return Array.isArray(jobs) ? jobs : [];
}

/**
 * Full pipeline: LinkedIn URL -> the employer's real application URL.
 *
 * Never throws for an expected failure; every outcome is a status the caller can
 * render. `status` is one of:
 *   resolved   applyUrl is set and safe to use
 *   ambiguous  candidates[] is set, a human should pick
 *   unresolved nothing usable, `reason` says why
 *
 * @param {string} url a linkedin.com job posting URL
 * @param {{ctx?: object}} [opts]
 */
export async function resolveApplyUrl(url, opts = {}) {
  const ctx = opts.ctx || makeHttpCtx();
  const jobId = linkedInJobId(url);
  if (!jobId) {
    return { ok: false, status: 'unresolved', reason: 'that is not a single LinkedIn job posting URL', posting: null, board: null, applyUrl: null, candidates: [] };
  }

  let html;
  try {
    html = await fetchGuestPosting(jobId, ctx);
  } catch (error) {
    return { ok: false, status: 'unresolved', reason: `could not read the LinkedIn guest posting: ${error.message}`, posting: null, board: null, applyUrl: null, candidates: [] };
  }

  const posting = { jobId, ...parseGuestPosting(html) };
  if (!posting.company || !posting.title) {
    return { ok: false, status: 'unresolved', reason: 'the guest posting did not carry a company and title (LinkedIn may have changed its markup)', posting, board: null, applyUrl: null, candidates: [] };
  }

  const { resolved, reason: boardReason } = await resolveBoard(posting, ctx);
  if (!resolved) {
    return {
      ok: false,
      status: 'unresolved',
      reason: `no Greenhouse, Ashby or Lever board found for ${posting.company}: ${boardReason}`,
      posting,
      board: null,
      applyUrl: null,
      candidates: [],
    };
  }

  let jobs;
  try {
    jobs = await fetchBoardJobs(resolved, ctx);
  } catch (error) {
    return { ok: false, status: 'unresolved', reason: `found ${posting.company}'s ${resolved.vendor} board but could not read it: ${error.message}`, posting, board: resolved, applyUrl: null, candidates: [] };
  }

  const picked = pickMatch(posting.title, jobs, { location: posting.location });
  return {
    ok: picked.status === 'resolved',
    status: picked.status,
    reason: picked.reason,
    posting,
    board: { vendor: resolved.vendor, slug: resolved.slug, careers_url: resolved.careers_url, jobCount: resolved.jobCount },
    applyUrl: picked.match ? picked.match.url : null,
    confidence: picked.match ? Number(picked.match.score.toFixed(3)) : 0,
    candidates: picked.candidates.map((c) => ({ title: c.title, url: c.url, location: c.location, score: Number(c.score.toFixed(3)) })),
  };
}

// ── Report persistence ────────────────────────────────────────────────

export const APPLY_URL_LABEL = 'Apply URL';

/**
 * Upsert `**Apply URL:** <url>` into a report's HEADER block.
 *
 * Separate from the existing `**URL:**` on purpose. `**URL:**` keeps its meaning
 * as the canonical, human-clickable posting link that the tracker and report
 * header record; `**Apply URL:**` is where the fillable form actually lives. For
 * a LinkedIn posting those are two different places, which is the whole reason
 * this module exists, and collapsing them would lose the link the user recognizes.
 *
 * Header-only by construction: the scan stops at the first `---` or `## `, so a
 * body that happens to mention a URL is never rewritten. Idempotent, and it
 * preserves every other byte of the report (reports are user-layer).
 *
 * @param {string} md report markdown
 * @param {string} applyUrl
 * @returns {string} the updated markdown
 */
export function upsertApplyUrl(md, applyUrl) {
  const url = String(applyUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('an http(s) apply URL is required');
  // A URL is ONE line, and this writes into a line-oriented header block. Without
  // this check a newline inside `url` emits a second header line, which can forge
  // a `**URL:**` and overwrite the canonical posting link the whole point of this
  // function is to leave alone. Control characters go for the same reason.
  if (/[\s\u0000-\u001f\u007f]/.test(url)) throw new Error('an apply URL must be a single line with no whitespace');
  const lines = String(md ?? '').split('\n');
  const line = `**${APPLY_URL_LABEL}:** ${url}`;

  // The header ends at the first horizontal rule or the first `## ` section.
  let end = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (end === -1) end = Math.min(lines.length, 10);

  const existing = lines.findIndex((l, i) => i < end && new RegExp(`^\\s*\\*\\*${APPLY_URL_LABEL}:\\*\\*`, 'i').test(l));
  if (existing !== -1) {
    lines[existing] = line;
    return lines.join('\n');
  }

  // Prefer sitting directly under **URL:**, so the two links read as a pair.
  const afterUrl = lines.findIndex((l, i) => i < end && /^\s*\*\*URL:\*\*/i.test(l));
  const at = afterUrl !== -1 ? afterUrl + 1 : Math.max(0, end);
  lines.splice(at, 0, line);
  return lines.join('\n');
}

/**
 * Read the `**Apply URL:**` already recorded on a report, or "".
 * @param {string} md
 * @returns {string}
 */
export function readApplyUrl(md) {
  const lines = String(md ?? '').split('\n');
  let end = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (end === -1) end = Math.min(lines.length, 10);
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(new RegExp(`^\\s*\\*\\*${APPLY_URL_LABEL}:\\*\\*\\s*(\\S+)`, 'i'));
    if (m) return m[1];
  }
  return '';
}

// ── Output ────────────────────────────────────────────────────────────

function printSummary(result) {
  const p = result.posting;
  console.log(`\n${'='.repeat(72)}`);
  console.log('  LinkedIn apply URL resolution');
  console.log(`${'='.repeat(72)}`);
  if (p) {
    console.log(`  Posting   : ${p.title || '(unknown title)'}`);
    console.log(`  Company   : ${p.company || '(unknown)'}${p.location ? ` (${p.location})` : ''}`);
    console.log(`  Applies   : ${p.offsiteApply ? 'offsite (employer ATS)' : 'on LinkedIn (Easy Apply)'}`);
  }
  if (result.board) console.log(`  Board     : ${result.board.vendor} / ${result.board.slug} (${result.board.jobCount} open)`);
  console.log(`  Status    : ${result.status}`);
  console.log(`  Why       : ${result.reason}`);
  if (result.applyUrl) console.log(`\n  Apply URL : ${result.applyUrl}  [confidence ${result.confidence}]`);
  if (result.candidates?.length && !result.applyUrl) {
    console.log('\n  Candidates (pick one yourself):');
    for (const c of result.candidates) console.log(`    ${String(c.score).padStart(5)}  ${c.title}${c.location ? ` (${c.location})` : ''}\n           ${c.url}`);
  }
  console.log('');
}

const HELP = `
linkedin-apply.mjs - resolve a LinkedIn posting to the employer's real application URL

Usage:
  node linkedin-apply.mjs <linkedin-job-url>            JSON (default)
  node linkedin-apply.mjs <linkedin-job-url> --summary  human-readable
  node linkedin-apply.mjs <url> --report <report.md>    resolve, then record **Apply URL:**
  node linkedin-apply.mjs --report <report.md> --set <url>   record a URL you chose
  node linkedin-apply.mjs --self-test                   inline test suite
  node linkedin-apply.mjs --help

--report writes only on a confident resolve; an ambiguous run records nothing, so
a guess never lands in the report where it would be acted on later.

LinkedIn's guest endpoint says whether a posting applies offsite but not where.
This reconstructs the destination from the employer plus the job title, using the
same ATS providers scan.mjs reads, so the result is a URL the apply flow can fill.

Matching refuses rather than guesses: a posting only resolves on a unique
high-confidence title match, and a seniority difference disqualifies outright.
Anything less comes back as ranked candidates for you to choose from.
`;

// ── Self-test ─────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // linkedInJobId - shared cases pinned against web/src/lib/job-url.mjs
  check(linkedInJobId('https://www.linkedin.com/jobs/view/4446829641/') === '4446829641', 'jobId from a canonical view URL');
  check(linkedInJobId('https://www.linkedin.com/jobs/view/senior-software-engineer-at-gradial-4446829641') === '4446829641', 'jobId from a slugged view URL');
  check(linkedInJobId('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4446829641') === '4446829641', 'jobId from a collections URL');
  check(linkedInJobId('https://www.linkedin.com/jobs/view/some-role-at-acme-2') === null, 'a 1-digit tail is not a job id');
  check(linkedInJobId('https://example.com/jobs/view/4446829641') === null, 'non-LinkedIn host rejected');
  check(linkedInJobId('not a url') === null, 'garbage input rejected');

  // parseGuestPosting - markup shaped like the live guest response
  const html = `
    <a class="topcard__link"><h2 class="top-card-layout__title topcard__title">Senior Software Engineer</h2></a>
    <span class="topcard__flavor">
      <a class="topcard__org-name-link topcard__flavor--black-link" href="https://www.linkedin.com/company/gradialai?trk=x">
        Gradial
      </a>
    </span>
    <span class="topcard__flavor topcard__flavor--bullet">Seattle, WA</span>
    <icon data-svg-class-name="apply-button__offsite-apply-icon-svg"></icon>`;
  const parsed = parseGuestPosting(html);
  check(parsed.title === 'Senior Software Engineer', 'parseGuestPosting reads the title');
  check(parsed.company === 'Gradial', 'parseGuestPosting reads the company');
  check(parsed.companySlug === 'gradialai', 'parseGuestPosting reads the company slug');
  check(parsed.location === 'Seattle, WA', 'parseGuestPosting reads the location');
  check(parsed.offsiteApply === true, 'parseGuestPosting detects an offsite apply');
  const easy = parseGuestPosting('<h2 class="topcard__title">Analyst</h2>');
  check(easy.offsiteApply === false, 'parseGuestPosting reports Easy Apply as not offsite');
  check(parseGuestPosting('').title === '' && parseGuestPosting(null).company === '', 'parseGuestPosting never throws on empty input');
  check(parseGuestPosting('<h2 class="topcard__title">R&amp;D Engineer</h2>').title === 'R&D Engineer', 'parseGuestPosting decodes entities');
  // Entity decoding must not re-scan its own output (CodeQL js/double-escaping).
  // Chained .replace() calls turned "&amp;lt;" into "<"; one pass yields "&lt;".
  check(parseGuestPosting('<h2 class="topcard__title">A&amp;lt;B</h2>').title === 'A&lt;B', 'decodeEntities does not double-unescape');
  check(parseGuestPosting('<h2 class="topcard__title">A&amp;amp;B</h2>').title === 'A&amp;B', 'decodeEntities decodes a doubled ampersand exactly once');
  check(parseGuestPosting('<h2 class="topcard__title">caf&#233; Lead</h2>').title === 'café Lead', 'decodeEntities decodes a decimal entity');
  check(parseGuestPosting('<h2 class="topcard__title">caf&#xE9; Lead</h2>').title === 'café Lead', 'decodeEntities decodes a hex entity');
  check(parseGuestPosting('<h2 class="topcard__title">100&#37; Remote</h2>').title === '100% Remote', 'decodeEntities handles a numeric entity mid-string');
  check(parseGuestPosting('<h2 class="topcard__title">Sales &amp;lt;3 Ops</h2>').title === 'Sales &lt;3 Ops', 'decodeEntities leaves an escaped entity escaped');
  check(parseGuestPosting('<h2 class="topcard__title">R&nosuchentity; Dev</h2>').title === 'R&nosuchentity; Dev', 'decodeEntities leaves an unknown entity verbatim');
  check(parseGuestPosting('<h2 class="topcard__title">Bad&#xD800; Dev</h2>').title === 'Bad&#xD800; Dev', 'decodeEntities refuses a surrogate code point');

  // candidateSlugs - each source rescues cases the other loses (verified live:
  // "Gradial"/gradialai resolves from the name, "Assembled"/assembledhq only
  // from the LinkedIn slug).
  check(JSON.stringify(candidateSlugs({ company: 'Gradial', companySlug: 'gradialai' })) === '["gradial","gradialai"]', 'candidateSlugs tries the name slug then the LinkedIn slug');
  check(JSON.stringify(candidateSlugs({ company: 'Assembled', companySlug: 'assembledhq' })) === '["assembled","assembledhq"]', 'candidateSlugs keeps a branded LinkedIn slug intact');
  check(candidateSlugs({ company: 'Whatnot', companySlug: 'whatnot-inc' }).includes('whatnot-inc'), 'candidateSlugs keeps the raw LinkedIn slug');
  check(JSON.stringify(candidateSlugs({ company: 'Acme', companySlug: 'acme' })) === '["acme"]', 'candidateSlugs dedupes identical slugs');
  check(candidateSlugs({ company: 'Acme', companySlug: 'bad/slug' }).length === 1, 'candidateSlugs rejects an unsafe slug');
  check(candidateSlugs({ company: '' }).length === 0, 'candidateSlugs handles a missing company');

  // upsertApplyUrl - reports are user-layer, so this must be surgical.
  const report = [
    '# Evaluation: Acme',
    '**Date:** 2026-08-13',
    '**Score:** 4.2/5',
    '**URL:** https://www.linkedin.com/jobs/view/123/',
    '**PDF:** ✅',
    '',
    '---',
    '',
    '## A) Role Summary',
    'Body text mentioning **URL:** style prose.',
  ].join('\n');
  const written = upsertApplyUrl(report, 'https://job-boards.greenhouse.io/acme/jobs/1');
  check(written.includes('**Apply URL:** https://job-boards.greenhouse.io/acme/jobs/1'), 'upsertApplyUrl writes the field');
  check(written.split('\n')[4] === '**Apply URL:** https://job-boards.greenhouse.io/acme/jobs/1', 'upsertApplyUrl places it directly under **URL:**');
  check(written.includes('## A) Role Summary') && written.includes('Body text mentioning'), 'upsertApplyUrl leaves the body untouched');
  const twice = upsertApplyUrl(written, 'https://job-boards.greenhouse.io/acme/jobs/2');
  check((twice.match(/\*\*Apply URL:\*\*/g) || []).length === 1, 'upsertApplyUrl replaces rather than duplicating');
  check(twice.includes('/jobs/2') && !twice.includes('/jobs/1'), 'upsertApplyUrl updates the value');
  check(upsertApplyUrl(report, 'https://x/1').split('\n').length === report.split('\n').length + 1, 'upsertApplyUrl adds exactly one line');
  let threw = false;
  try { upsertApplyUrl(report, 'javascript:alert(1)'); } catch { threw = true; }
  check(threw, 'upsertApplyUrl refuses a non-http URL');
  // A newline would emit a SECOND header line and could forge a **URL:**, which
  // is the one field this module promises never to overwrite.
  let injected = false;
  try { upsertApplyUrl(report, 'https://evil.test/x\n**URL:** https://evil.test/phish'); } catch { injected = true; }
  check(injected, 'upsertApplyUrl refuses a URL carrying a newline');
  check((() => { try { upsertApplyUrl(report, 'https://evil.test/x **URL:** https://evil.test/p'); return false; } catch { return true; } })(), 'upsertApplyUrl refuses a URL carrying a space');
  check((() => { try { upsertApplyUrl(report, 'https://evil.test/x\ty'); return false; } catch { return true; } })(), 'upsertApplyUrl refuses a URL carrying a tab');
  check(upsertApplyUrl(report, '  https://x/1  ').includes('**Apply URL:** https://x/1'), 'upsertApplyUrl still trims surrounding whitespace');
  const noUrlField = upsertApplyUrl('# Evaluation: Acme\n**Score:** 4.0/5\n\n---\n\n## A) X\n', 'https://x/1');
  check(noUrlField.includes('**Apply URL:**') && noUrlField.indexOf('**Apply URL:**') < noUrlField.indexOf('## A)'), 'upsertApplyUrl still lands in the header when **URL:** is absent');

  // readApplyUrl
  check(readApplyUrl(written) === 'https://job-boards.greenhouse.io/acme/jobs/1', 'readApplyUrl reads the field back');
  check(readApplyUrl(report) === '', 'readApplyUrl returns empty when unset');
  check(readApplyUrl('# X\n\n---\n\n## A\n**Apply URL:** https://body/1\n') === '', 'readApplyUrl ignores a body line outside the header');

  // House rule: no em dash reaches the user, including pass-through upstream text.
  check(!noEmDash('board found — but empty').includes('—'), 'noEmDash strips a pass-through em dash');
  check(noEmDash('a — b') === 'a: b', 'noEmDash reads cleanly as a colon');

  // normalizeTitle
  check(normalizeTitle('Senior Engineer (Remote)') === 'senior engineer', 'normalizeTitle drops bracketed asides');
  check(normalizeTitle('Data Engineer (m/w/d)') === 'data engineer', 'normalizeTitle drops gender markers');
  check(normalizeTitle('  Staff   SRE  ') === 'staff sre', 'normalizeTitle collapses whitespace');
  check(normalizeTitle('C++ Developer') === 'c++ developer', 'normalizeTitle keeps c++');

  // titleScore
  check(titleScore('Senior Software Engineer', 'senior software engineer') === 1, 'titleScore is case-insensitive');
  check(titleScore('Senior Software Engineer', 'Senior Software Engineer (Remote)') === 1, 'titleScore ignores a bracketed aside');
  check(titleScore('Senior Software Engineer', 'Account Executive') < 0.2, 'titleScore separates unrelated roles');
  check(titleScore('', 'Anything') === 0, 'titleScore handles an empty side');

  // pickMatch - the safety-critical policy
  const unique = pickMatch('Senior Software Engineer', [
    { title: 'Senior Software Engineer', url: 'https://job-boards.greenhouse.io/acme/jobs/1' },
    { title: 'Account Executive', url: 'https://job-boards.greenhouse.io/acme/jobs/2' },
  ]);
  check(unique.status === 'resolved' && unique.match.url.endsWith('/1'), 'pickMatch resolves a unique exact match');

  const siblings = pickMatch('Senior Engineer', [
    { title: 'Senior Engineer, Payments', url: 'https://x/1' },
    { title: 'Senior Engineer, Risk', url: 'https://x/2' },
  ]);
  check(siblings.status === 'ambiguous' && siblings.match === null, 'pickMatch refuses to choose between sibling postings');
  check(siblings.candidates.length === 2, 'pickMatch still lists the siblings as candidates');

  const levels = pickMatch('Senior Data Engineer', [{ title: 'Staff Data Engineer', url: 'https://x/1' }]);
  check(levels.status === 'unresolved', 'pickMatch disqualifies a seniority mismatch outright');

  const nothing = pickMatch('Senior Software Engineer', [{ title: 'Office Manager', url: 'https://x/1' }]);
  check(nothing.status === 'unresolved' && nothing.candidates.length === 0, 'pickMatch reports no resemblance rather than a weak pick');
  check(pickMatch('Anything', []).status === 'unresolved', 'pickMatch handles an empty board');
  check(pickMatch('', [{ title: 'X', url: 'https://x/1' }]).status === 'unresolved', 'pickMatch handles a missing LinkedIn title');

  // Location is a tiebreaker, never a disqualifier.
  const loc = pickMatch('Senior Software Engineer', [{ title: 'Senior Software Engineer', url: 'https://x/1', location: 'Remote' }], { location: 'Seattle, WA' });
  check(loc.status === 'resolved', 'pickMatch does not reject a match on a location disagreement');

  // A candidate missing a url is not offerable.
  const noUrl = pickMatch('Senior Software Engineer', [{ title: 'Senior Software Engineer', url: '' }]);
  check(noUrl.status === 'unresolved', 'pickMatch drops a posting with no URL');

  console.log(`\n  linkedin-apply self-test: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

// ── CLI ───────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--json', '--summary', '--self-test', '--help', '-h', '--report', '--set'];

/** Read `--flag value`, or "" when absent. Rejects a missing value loudly. */
function optValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return '';
  const v = args[i + 1];
  if (!v || v.startsWith('-')) {
    console.error(`${flag} needs a value.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(', ')}\n${HELP}`);
    process.exit(1);
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const reportPath = optValue(args, '--report');
  const setUrl = optValue(args, '--set');

  // `--set` records a URL the user chose (an ambiguous pick, or one they pasted)
  // without re-resolving anything. Separate path because there is nothing to
  // resolve: the answer is already known and only needs persisting.
  if (setUrl) {
    if (!reportPath) {
      console.error('--set needs --report <path> to write to.');
      process.exit(1);
    }
    const md = readFileSync(reportPath, 'utf8');
    writeFileSync(reportPath, upsertApplyUrl(md, setUrl));
    console.log(JSON.stringify({ ok: true, status: 'resolved', applyUrl: setUrl, written: reportPath, source: 'manual' }, null, 2));
    return;
  }

  // A value-carrying flag's value must not be mistaken for the positional URL.
  const consumed = new Set([reportPath, setUrl].filter(Boolean));
  const url = args.find((a) => !a.startsWith('-') && !consumed.has(a));
  if (!url) {
    console.error(`A LinkedIn job posting URL is required.\n${HELP}`);
    process.exit(1);
  }

  const result = await resolveApplyUrl(url);

  // Persist only a confident answer. An ambiguous or failed run must not write a
  // guess into the report: a wrong Apply URL is silently acted on later.
  if (reportPath && result.status === 'resolved' && result.applyUrl) {
    try {
      writeFileSync(reportPath, upsertApplyUrl(readFileSync(reportPath, 'utf8'), result.applyUrl));
      result.written = reportPath;
    } catch (error) {
      result.writeError = error.message;
    }
  }

  if (args.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
  // Exit non-zero only when nothing usable came back, so a caller can branch on it.
  // `ambiguous` exits 0: candidates ARE a useful result.
  if (result.status === 'unresolved') process.exit(2);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`linkedin-apply: ${error.message}`);
    process.exit(1);
  });
}
