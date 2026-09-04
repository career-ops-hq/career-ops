/**
 * job-url.mjs — normalize a pasted job posting URL into the pair the pipeline needs.
 *
 * Two URLs, usually identical:
 *   url      the canonical link we RECORD (report header **URL:**, tracker row).
 *   fetchUrl the link the agent READS.
 *
 * They differ for LinkedIn only. https://www.linkedin.com/jobs/view/<id> served to a
 * headless agent is an authwall or a JS shell, so an evaluation run against it scores
 * a login page and still writes a confident-looking report. LinkedIn's public guest
 * endpoint returns the real posting body with no auth, so we fetch that and keep the
 * clickable link for the tracker.
 *
 * TWO DIFFERENT JOBS, DELIBERATELY NOT THE SAME FUNCTION:
 *   normalizeJobUrl  cleans a URL for the RECORD — the report header, the tracker
 *                    row, data/pipeline.md. The output is a link a human clicks,
 *                    so it keeps its own shape (trailing slash, param order, case).
 *   postingKey       answers "are these the same posting?" and delegates that to
 *                    core/url-key.mjs's normalizeUrl, the repo's one identity key
 *                    (parity-tested against the root url-key.mjs). This module
 *                    must never grow a second key: explore-ai.ts's canon() and
 *                    scan-history dedup both key with normalizeUrl, and a rival
 *                    key here would make the same posting look "new" on one
 *                    surface and "in your pipeline" on the next.
 *
 * LinkedIn URL parsing is a mirror of the core's liveness-api.mjs rung and lives
 * in core/linkedin-url.mjs — see that file's header for why a copy exists and
 * when to delete it.
 *
 * Plain .mjs, dependency-free (same pattern as pdf-paths.mjs / cv-envelope.mjs) so
 * test-all.mjs can import it under bare Node and its sibling suite is auto-gated.
 */

import { linkedInJobId, linkedInGuestUrl, linkedInCanonicalUrl } from "./core/linkedin-url.mjs";
import { normalizeUrl } from "./core/url-key.mjs";

/**
 * @typedef {Object} NormalizedJobUrl
 * @property {true} ok
 * @property {string} url       Canonical link, recorded in the report and tracker.
 * @property {string} fetchUrl  What the agent actually fetches.
 * @property {"linkedin"|"generic"} kind
 */

/**
 * @typedef {Object} JobUrlError
 * @property {false} ok
 * @property {string} error  User-facing, no em dashes (AGENTS.md house rule).
 */

/** @typedef {"greenhouse"|"lever"|"ashby"|"workday"} AtsSource */

// Share-sheet and campaign noise, dropped so the RECORDED url stays clean — this is
// not, and must not become, an identity key. url-key.mjs's normalizeUrl owns that
// (and carries its own core-parity denylist); postingKey below routes through it.
// The extra LinkedIn-flavored entries here are the ones a share sheet actually
// appends, and they matter for what the user ends up clicking in the tracker.
const TRACKING_PARAMS = [/^utm_/i, /^trk$/i, /^trkInfo$/i, /^refId$/i, /^trackingId$/i, /^originalSubdomain$/i, /^lipi$/i, /^eBP$/i];

/**
 * Host equality anchored at a dot boundary, so "greenhouse.io.evil.example" never
 * matches "greenhouse.io". The one host-matching rule shared by every caller that
 * needs to know what ATS (or what registrable domain) a URL belongs to.
 *
 * @param {string} host
 * @param {string} base
 * @returns {boolean}
 */
export function domainIs(host, base) {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Host -> ATS source, for every ATS host any caller in this app recognizes.
 * Single list (#F6): `sourceFromUrl` in inbox.ts and `companyFromJobUrl` below both
 * used to keep their own copy of this list, which meant they could silently drift
 * on which hosts count as an ATS. Workday ships two live hostnames: the tenant
 * subdomain (`{tenant}.myworkdayjobs.com`) and the bare `workday.com` some postings
 * use directly; both resolve to the same source.
 *
 * @type {ReadonlyArray<[string, AtsSource]>}
 */
export const ATS_HOSTS = [
  ["greenhouse.io", "greenhouse"],
  ["lever.co", "lever"],
  ["ashbyhq.com", "ashby"],
  ["myworkdayjobs.com", "workday"],
  ["workday.com", "workday"],
];

/**
 * Which ATS a host belongs to, matched with the same dot-boundary rule as
 * `domainIs`. Returns null for a host that isn't one of ATS_HOSTS (including
 * linkedin.com, which is handled separately since it isn't an ATS).
 *
 * @param {string} host
 * @returns {AtsSource|null}
 */
export function atsSourceFromHost(host) {
  for (const [base, source] of ATS_HOSTS) {
    if (domainIs(host, base)) return source;
  }
  return null;
}

/**
 * Strip artifacts a job URL picks up when copied out of a sentence (email, Slack
 * message, chat) rather than off an address bar: a single layer of wrapping
 * <angle brackets> or (parentheses) around the whole string, then trailing
 * sentence punctuation. A trailing "/" is left alone, since it is meaningful in a
 * URL path rather than incidental to the prose around it. Runs on the already-
 * trimmed input, before the scheme check, so both a bare host and a full URL
 * benefit.
 *
 * The two strips don't commute on their own: "<url>." needs the trailing "." gone
 * before the ">" is the last character, so the wrapper check can see it. Composed
 * pastes ("<url>.", "(url),") are the common case, since a Markdown or email link
 * is usually both wrapped AND sitting at the end of a sentence. So this runs both
 * strips to a fixed point rather than once each.
 *
 * @param {string} s
 * @returns {string}
 */
function stripPasteNoise(s) {
  const WRAPPERS = [
    ["<", ">"],
    ["(", ")"],
  ];
  // Guard against an unbounded loop: a pass that changes anything removes at
  // least one character (a wrapper strips two, a punctuation run strips one or
  // more), so the string's own length is a hard ceiling on how many passes a
  // fixed point can take. The caller already bounds `s` at MAX_URL_LENGTH before
  // this runs, so this is a small, fixed amount of work either way, not a
  // reintroduction of the quadratic behavior the backwards scan below replaced.
  const maxPasses = s.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    const before = s;
    for (const [open, close] of WRAPPERS) {
      if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
        s = s.slice(1, -1).trim();
      }
    }
    // Only sentence-ending punctuation a URL never legitimately ends with. Not "/",
    // "]", ")", "%", or "=", any of which can be a real trailing path/query byte.
    //
    // Scanned backwards rather than matched with /[.,;!?]+$/. That regex is
    // polynomial on this input: for a paste like "!!!!!!…x" the engine consumes the
    // whole run, fails on $, restarts one character right and does it again, which is
    // O(n^2) on a string the user controls the length of (CodeQL js/polynomial-redos).
    // A backwards walk is linear and states the intent more plainly anyway.
    let end = s.length;
    while (end > 0 && TRAILING_PUNCTUATION.includes(s[end - 1])) end--;
    s = s.slice(0, end);
    if (s === before) break;
  }
  return s;
}

const TRAILING_PUNCTUATION = ".,;!?";

/** Generous next to any real posting URL, small enough to bound the work below. */
const MAX_URL_LENGTH = 2048;

/**
 * @param {string} raw
 * @returns {NormalizedJobUrl|JobUrlError}
 */
export function normalizeJobUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Paste a job posting URL." };
  // Bound the input before any per-character work touches it. A posting URL is
  // never anywhere near this long, and the whole prompt is passed to the CLI as a
  // single argv element, so an unbounded paste is wasted tokens at best.
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: "That is too long to be a job posting URL." };
  const trimmed = stripPasteNoise(raw.trim());
  // A paste with no scheme is the common case; anything that already declares one
  // keeps it, so javascript: and file: reach the protocol check below and are refused.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let u;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, error: `That does not look like a URL: ${trimmed.slice(0, 60)}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `Only http and https links work here, not ${u.protocol.replace(":", "")}.` };
  }
  if (!u.hostname.includes(".")) return { ok: false, error: `That does not look like a job posting URL: ${trimmed.slice(0, 60)}` };

  // Collect first: deleting while iterating searchParams skips entries.
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }

  if (domainIs(u.hostname.toLowerCase(), "linkedin.com")) {
    const id = linkedInJobId(u);
    if (!id) {
      return {
        ok: false,
        error: "That LinkedIn link does not point at a single job posting. Open the job, then copy the URL from the address bar.",
      };
    }
    return { ok: true, kind: "linkedin", url: linkedInCanonicalUrl(id), fetchUrl: linkedInGuestUrl(id) };
  }

  const clean = u.toString();
  return { ok: true, kind: "generic", url: clean, fetchUrl: clean };
}

/**
 * Split a paste into normalized entries plus per-line errors. Whitespace separated,
 * so one URL per line and several on one line both work. Deduped on the canonical
 * url, which collapses the two LinkedIn spellings of the same job.
 *
 * @param {string} text
 * @returns {{entries: NormalizedJobUrl[], errors: Array<{raw: string, error: string}>}}
 */
export function parsePastedUrls(text) {
  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const token of String(text ?? "").split(/\s+/)) {
    if (!token) continue;
    const r = normalizeJobUrl(token);
    if (!r.ok) {
      errors.push({ raw: token, error: r.error });
      continue;
    }
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    entries.push(r);
  }
  return { entries, errors };
}

/**
 * Best-effort company name from the URL alone, for the free "add to inbox" path
 * (pipeline.md rows read badly with an empty company). Zero network, zero tokens.
 * Returns "" when the URL genuinely does not carry it, rather than guessing.
 *
 * @param {string} url
 * @returns {string}
 */
export function companyFromJobUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const source = atsSourceFromHost(host);
  // Of ATS_HOSTS, only these three ATS layouts put the company first in the path.
  // Workday's tenant subdomain carries the company instead (acme.myworkdayjobs.com),
  // so it falls through to the registrable-name branch below like any other host.
  if (source === "greenhouse" || source === "lever" || source === "ashby") {
    return seg[0] ?? "";
  }
  // LinkedIn's URL carries the job id and nothing about the employer.
  if (domainIs(host, "linkedin.com")) return "";
  // Otherwise the registrable name: careers.example.com -> example.
  const parts = host.replace(/^www\./, "").split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

/**
 * Canonical identity key for a pasted URL: the thing several UI surfaces (inbox,
 * tracker, dedup) compare to decide whether two strings point at the same posting.
 *
 * TWO STAGES, and the order is the whole point:
 *   1. normalizeJobUrl collapses LinkedIn's several spellings of one posting
 *      (/jobs/view/{id}, /jobs/view/{slug}-{id}, ?currentJobId={id}) onto one
 *      canonical link. normalizeUrl cannot do this: it is host-agnostic by
 *      design, so those three shapes key three different ways to it.
 *   2. normalizeUrl then produces the actual key. It is the ONE identity key in
 *      this repo (parity-tested against the root url-key.mjs, and already what
 *      explore-ai.ts's canon() and scan-history dedup use), so a card that reads
 *      "in your pipeline" here means the same thing it means on Explore.
 *
 * Must never throw and never return undefined, so a caller can use the result as
 * a Map/Set key or a React list key with no null check.
 *
 * NOT '' FOR AN UNPARSEABLE INPUT, unlike normalizeUrl. '' is normalizeUrl's NO
 * KEY sentinel, and its own header is explicit that callers must never let two
 * ''s match, which is exactly what a Set membership test does. Handing back the
 * raw string instead keeps two different unparseable inputs distinct, the safe
 * answer for the comparison this function exists to serve.
 *
 * @param {string} url
 * @returns {string} The url-key identity for a normalizable posting, else the
 *   input unchanged.
 */
export function postingKey(url) {
  const r = normalizeJobUrl(url);
  const raw = String(url ?? "");
  if (!r.ok) return raw;
  return normalizeUrl(r.url) || raw;
}
