#!/usr/bin/env node
/**
 * invite-match.mjs — Interview-Invite / Rejection → Tracker Matcher for career-ops
 *
 * Recruiter calendar/ATS invite emails frequently name only the company
 * (generic subject lines like "Schedule Your Phone Screen") with no job
 * title or req number. Finding which `data/applications.md` row an invite
 * belongs to otherwise means a manual grep every time. Rejection emails —
 * the single most common ATS-generated email — have the exact same problem,
 * and are the more frequent case in practice (#2098).
 *
 * This script extracts a company name (and, if present, a date, a
 * req/job-ID-looking token, and a call platform/medium) from pasted invite
 * text, fuzzy-matches it against the tracker's Company column, and ranks
 * candidates when the same company has multiple applications — which is
 * common. A silent wrong guess is worse than showing a short ranked list,
 * so ambiguous input always returns all plausible candidates rather than
 * picking one. The text is also classified as `invite` / `rejection` /
 * `unknown` (see classifyEmail) — informational only, never a gate on
 * matching.
 *
 * Despite the filename, this now recognizes more than interview invites
 * (#2098). Kept as-is rather than renamed: a rename would break any doc or
 * script that already references `invite-match.mjs` (e.g. #1495's own
 * history) — left as a maintainer call, not blocking.
 *
 * Also reports interview rules found in the invite (`constraints`, #5732):
 * read-only tags like [constraint:no-ai]; --apply never writes them.
 *
 * Run: node invite-match.mjs < invite.txt          (JSON to stdout)
 *      node invite-match.mjs --file invite.txt
 *      echo "..." | node invite-match.mjs --summary
 *      node invite-match.mjs --apply [--id N]      (rejection-classified matches only; advances status to Rejected)
 *      node invite-match.mjs --no-clarification-draft   (omit the pre-interview clarification draft)
 *      node invite-match.mjs --self-test
 *
 * Issue #1495, #2098 — github.com/career-ops-hq/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { resolveColumns, parseTrackerRow, extractReqNumber } from './tracker-parse.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { LEGAL_SUFFIXES, GENERIC_DESCRIPTORS } from './tracker-utils.mjs';

const CAREER_OPS = getCareerOpsRoot();
// Sibling scripts live next to this file in the *code* checkout, which is a
// different directory from CAREER_OPS whenever the data root is external
// (CAREER_OPS_ROOT / a .career-ops-data marker). Resolving them off the data
// root made --apply die with `Cannot find module <data-root>/set-status.mjs`.
// Same split, and the same constant name, as merge-tracker.mjs (#3761).
const CAREER_OPS_CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = resolveTrackerPath(CAREER_OPS);

// --- CLI args ---
const args = process.argv.slice(2);

// #2854: --help was never checked and an unrecognized/mistyped flag (e.g.
// `--sumary`) silently fell through instead of failing fast — same shape as
// scan-ats-full.mjs (#1633/#1635), reply-watch.mjs (#2743/#2745) and
// dedup-tracker.mjs (#2744/#2746), shared via lib/cli-flags.mjs's
// validateFlags() (#2775). Order matters: the unrecognized-flag check runs
// BEFORE the --help check, so `--help --bogus` still errors instead of
// printing usage and exiting 0.
const KNOWN_FLAGS = ['--summary', '--self-test', '--file', '--apply', '--id', '--no-clarification-draft', '--help', '-h'];
const USAGE = `Usage:
  node invite-match.mjs < invite.txt          # JSON to stdout
  node invite-match.mjs --file invite.txt     # read invite text from a file
  node invite-match.mjs --summary             # human-readable summary instead of JSON
  node invite-match.mjs --apply [--id N]      # rejection-classified matches only; advances status to Rejected
  node invite-match.mjs --no-clarification-draft  # invites only: omit the pre-interview clarification email draft
  node invite-match.mjs --self-test           # run the built-in self-test suite
  node invite-match.mjs --help                # print this usage block and exit
  node invite-match.mjs -h                    # same as --help`;

// Only when invoked as a CLI, not when another script (scan.mjs,
// detect-reposts.mjs) imports a helper like normalizeCompanyName — otherwise
// invite-match's flag vocabulary would be validated against the IMPORTING
// script's own process.argv and reject its perfectly valid flags (e.g.
// detect-reposts.mjs --window). Same condition as the "Run" guard at the
// bottom of this file.
//
// --file/--id are NOT listed as valueFlags: both are read below via the
// existing hand-rolled `args.indexOf(...)` lookups (untouched — including
// their deliberate "a following recognized flag counts as a missing value"
// guard), which only understand the space-separated `--flag value` form.
// Declaring them as valueFlags would make validateFlags silently accept
// `--file=x`/`--id=5` as known, but that form would then fall straight
// through the untouched indexOf lookups below and be dropped — the same
// silent-ignore failure mode this issue exists to close, just moved to a
// different spelling. Leaving them out means that form is rejected loudly
// as an unrecognized flag instead.
if (isMainModule(import.meta.url)) {
  validateFlags(args, KNOWN_FLAGS, USAGE);
}

const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const noClarificationDraft = args.includes('--no-clarification-draft');
const fileIdx = args.indexOf('--file');
// Treat a following recognized flag (e.g. `--file --summary`) the same as a
// missing value — otherwise it's silently accepted as the path and produces
// a confusing "file not found: --summary" instead of the clearer error below.
if (fileIdx !== -1 && (args[fileIdx + 1] === undefined || args[fileIdx + 1].startsWith('--'))) {
  console.error('invite-match: --file requires a path argument');
  process.exit(1);
}
const filePathArg = fileIdx !== -1 ? args[fileIdx + 1] : null;

// --apply advances a matched tracker row's status to Rejected — scoped to
// that transition only (see issue #2098). It is deliberately NOT the general
// #1960 "advance to Interview" flag: that issue is unclaimed and unimplemented
// here, so an invite-classified match is never auto-applied by this flag.
const applyMode = args.includes('--apply');
const idIdx = args.indexOf('--id');
if (idIdx !== -1 && (args[idIdx + 1] === undefined || args[idIdx + 1].startsWith('--'))) {
  console.error('invite-match: --id requires a tracker # argument');
  process.exit(1);
}
const idArgRaw = idIdx !== -1 ? args[idIdx + 1] : null;
if (idArgRaw !== null && !/^\d+$/.test(idArgRaw)) {
  console.error('invite-match: --id must be a tracker # (integer)');
  process.exit(1);
}
const idArg = idArgRaw !== null ? parseInt(idArgRaw, 10) : null;

// Statuses ranked above others when disambiguating same-company candidates —
// an active application is a far more likely invite match than one already
// rejected or discarded, even if the rejected row is textually a closer date.
const STATUS_PRIORITY = {
  interview: 0,
  responded: 1,
  applied: 2,
  evaluated: 3,
  offer: 4,
  rejected: 5,
  discarded: 6,
  skip: 7,
};

function normalizeStatusKey(status) {
  return String(status ?? '')
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim()
    .toLowerCase();
}

// Legal-entity suffixes and generic business descriptors live in
// tracker-utils.mjs next to companiesMatchIgnoringCorporateForm(), which shares
// the vocabulary. Re-exported here so `import { LEGAL_SUFFIXES } from
// './invite-match.mjs'` keeps working for existing callers while there is a
// single definition. normalizeCompanyName() below chain-strips LEGAL_SUFFIXES.
export { LEGAL_SUFFIXES, GENERIC_DESCRIPTORS };

/**
 * Normalize a company name for matching: lowercase, strip punctuation and
 * parentheticals, collapse whitespace, chain-strip trailing legal-entity
 * suffixes (so "Acme Technologies Inc." reduces to "acme technologies"),
 * then strip at most one trailing generic descriptor word. Deliberately
 * stricter than dedup-tracker.mjs's normalizeCompany (which only lowercases
 * and strips punctuation): invite emails quote company names more loosely
 * than tracker rows quote each other, so matching across the two sources
 * needs the extra suffix-stripping that same-source dedup does not.
 *
 * Generic descriptors are deliberately stripped only once (not chained) and
 * only after legal suffixes, so two distinct companies that happen to both
 * end in a generic word (e.g. "Data Solutions" vs "Data Corp") don't
 * collapse to the same "data" key — see issue discussion on PR #1497.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCompanyName(name) {
  let key = String(name ?? '')
    // NFKC before folding so full-width and half-width spellings of the same
    // name compare equal, matching the shared normalizeTextKey() contract.
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    // Letters and digits of ANY script, not just [a-z0-9]: the Latin-only
    // class DELETED every non-Latin name, so アクメ株式会社 and Яндекс both
    // produced '' — and matchInvite() bails on an empty key, so pasting an
    // invite from any company in the ja/ko/zh/zh-TW/ru/ua/ar/hi markets that
    // modes/ ships returned ZERO candidates even when the row was right
    // there. Combining marks are kept for the same reason normalizeTextKey
    // keeps them: Indic matras have no precomposed form (#2517).
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      const re = new RegExp(`\\s${suffix}$`);
      if (re.test(key)) {
        key = key.replace(re, '').trim();
        changed = true;
      }
    }
  }

  for (const word of GENERIC_DESCRIPTORS) {
    const re = new RegExp(`\\s${word}$`);
    if (re.test(key)) {
      key = key.replace(re, '').trim();
      break;
    }
  }

  return key;
}

/**
 * Token-overlap similarity between two normalized company-name strings.
 * Returns 1 for an exact match, otherwise the fraction of the shorter name's
 * tokens found in the longer name (order-independent), and 0 when there is
 * no overlap at all. Deliberately simple — this is a "does this look like
 * the same company" check, not a general string-distance metric.
 *
 * @param {string} a - Already-normalized name.
 * @param {string} b - Already-normalized name.
 * @returns {number} 0..1
 */
export function companySimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const longerSet = new Set(longer);
  const overlap = shorter.filter(t => longerSet.has(t)).length;
  if (overlap === 0) return 0;

  // Dice coefficient (2 * overlap / total tokens), not overlap/shorter-length:
  // a full-containment match ("acme" inside "acme corp") still scores below
  // an exact match, so when the tracker has both an exact-name row and a
  // longer-name row for the same company, the exact match ranks first.
  return (2 * overlap) / (tokensA.length + tokensB.length);
}

// --- Extract signals from invite text ---

// Matches the first "Company: X" / "at X" / "with X" style line, and falls
// back to the invite subject-style first line otherwise. Invite emails vary
// too much for one regex to be authoritative, so this is a best-effort
// extraction — the fuzzy match against the tracker is what actually decides
// the result, not this heuristic alone.
//
// The name class is Unicode, not `[A-Z][\w…]`: `\w` is ASCII-only in JS, so a
// lazy `[\w…]{1,60}?` cannot cross the `é` in Nestlé and the terminator it is
// looking for never arrives — the whole pattern fails and the invite yields no
// company at all. `[A-Z]` refused a non-Latin first letter for the same reason,
// so Яндекс and 株式会社 never even started matching. `\p{Lo}` covers
// scripts with no case distinction; the body class is the one
// normalizeCompanyName() already uses (#2517), plus the punctuation company
// names carry, plus `_`: `\w` included it, and dropping it reproduces the
// exact same failure mode this fix is for (a lazy class with no reachable
// terminator fails the whole pattern, not just the one character) for any
// ASCII company name that happens to contain an underscore. The first
// pattern captures `(.+)` and was never script-bound.
const COMPANY_LINE_PATTERNS = [
  /(?:^|\n)\s*company\s*[:\-]\s*(.+)/i,
  /interview(?:ing)?\s+(?:with|at)\s+([\p{Lu}\p{Lo}][\p{L}\p{M}\p{N}_.,&' -]{1,60}?)(?:[.,\n]|\s+for\s|\s+regarding\s|$)/iu,
  /(?:phone screen|screening|interview)\s*[-–—:]\s*([\p{Lu}\p{Lo}][\p{L}\p{M}\p{N}_.,&' -]{1,60}?)(?:\s+opportunity)?(?:[.,\n]|$)/iu,
  /schedule your (?:phone screen|interview)\s*(?:[-–—:]\s*)?([\p{Lu}\p{Lo}][\p{L}\p{M}\p{N}_.,&' -]{1,60}?)\s*opportunity/iu,
];

/**
 * Best-effort extraction of the company name from raw invite email text.
 * Tries a handful of common invite phrasings; returns null if nothing
 * plausible is found (caller should surface that to the user rather than
 * guessing further).
 *
 * @param {string} text - Raw pasted invite email text.
 * @returns {string|null}
 */
export function extractCompany(text) {
  if (!text) return null;
  for (const pattern of COMPANY_LINE_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/[.,;:]+$/, '');
      if (candidate.length >= 2 && candidate.length <= 60) return candidate;
    }
  }
  return null;
}

/**
 * Best-effort extraction of a date mentioned in the invite (interview date,
 * not necessarily the email send date). Only matches unambiguous ISO or
 * "Month D, YYYY" forms — anything else is left for the human to read.
 *
 * @param {string} text
 * @returns {string|null} YYYY-MM-DD or null.
 */
export function extractDate(text) {
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const named = text.match(new RegExp(`\\b(${months})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i'));
  if (named) {
    const monthIdx = new Date(`${named[1]} 1, 2000`).getMonth() + 1;
    const day = String(named[2]).padStart(2, '0');
    const month = String(monthIdx).padStart(2, '0');
    return `${named[3]}-${month}-${day}`;
  }
  return null;
}

// The req branch's optional `id` carries its own leading `\s*` INSIDE the
// optional group, so exactly one unbounded class follows it.
//
// The earlier shape, `\s*(?:id)?[:\s#]*`, let two unbounded quantifiers compete
// for the same spaces whenever `id` was absent: a run of N spaces can be divided
// between `\s*` and `[:\s#]*` in N+1 ways, and every division is retried before
// the match finally fails. That is quadratic on input that never matches —
// measured on Node 22 with "Requisition " followed by spaces and a non-matching
// character: 36ms at 8K, 157ms at 16K, 669ms at 32K, ~2.8s at 64K.
//
// It is reachable rather than theoretical: analyzeInvite() runs this over whole
// pasted emails, including `--file` input, so the length is chosen by whoever
// wrote the message.
//
// `(?:\s*id)?[\s:#]*` accepts the same language as `\s*(?:id)?[:\s#]*` — both are
// "optionally whitespace then `id`, then any run of space/colon/hash", since the
// id-absent path `\s*[:\s#]*` and a bare `[\s:#]*` accept exactly the same
// strings — but it has no competing pair: with `id` absent there is a single
// class scan, and with `id` present the group's `\s*` backtracks against a
// literal, which is linear. Measured after: 0.25ms at 64K.
//
// The `job` branch is upstream's verbatim: `job\s*id[:\s#]*` was never ambiguous
// (the literal `id` separates its two quantifiers), so it is deliberately left
// alone. Rewriting it once looked harmless and silently widened what may precede
// `id` — `job#id 43683` began matching where it had not before.
//
// Equivalence was established by differential-testing this against the previous
// patterns out-of-tree, comparing match index, full match and capture. What is
// committed here is the distilled result: the guards in the self-test below pin
// the colon- and hash-before-`id` shapes specifically, because an earlier draft
// of this fix diverged on exactly those.
const REQ_ID_LABELLED = /\b(?:req(?:uisition)?\.?(?:\s*id)?[\s:#]*|job\s*id[:\s#]*)([A-Z]{0,3}\d{3,10})\b/i;
const REQ_ID_PREFIXED = /\b([A-Z]{1,3}\d{5,10})\b/;

/**
 * Best-effort extraction of a req/job-ID-looking token (e.g. "R260013984",
 * "Req 32807", "Job ID: 43683", "JR12352") — present in a minority of
 * invites but a strong disambiguator when it is, since it can be cross-
 * checked against the tracker's notes column.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractReqId(text) {
  if (!text) return null;
  const m = text.match(REQ_ID_LABELLED) || text.match(REQ_ID_PREFIXED);
  return m ? m[1] : null;
}

// A meeting-platform URL is unambiguous, so these are checked in a fixed
// order and the first hit wins — no scoring needed, unlike company-name
// matching where several candidates can plausibly overlap.
//
// Each pattern requires a proper URL/host boundary, not just a substring
// match: an optional scheme + single subdomain label ahead of the host, a
// real host-boundary character (or start-of-string) before that, and a
// path/query/fragment/whitespace delimiter (or end-of-string) after the
// host. This rejects lookalike hosts (`notzoom.us`, `teams.microsoft.com.evil.
// example`) and email addresses (`support@zoom.us`) that merely contain the
// host string as a substring — "silence stays silence" per this file's
// extractDate/extractReqId convention, so a lookalike is never reported as
// a real meeting platform.
//
// The prefix boundary also excludes URL-structure characters (`/ ? = & #`)
// so a platform host is only recognized at the true start of a URL
// authority, not when it's actually a path segment or query value on a
// *different* host: `https://example.com/zoom.us` (path segment) and
// `https://example.com?next=zoom.us` (query value) must NOT match, since
// `zoom.us` is not the URL's actual host in either case.
//
// An optional explicit port (`:443`, `:8443`, etc.) is permitted between
// the host and the following delimiter, since a URL authority may legally
// include one (`https://zoom.us:443/j/123456789`) and rejecting it would
// silently drop otherwise-legitimate invite links.
// The `isAIInterviewer` flag distinguishes AI-interviewer platforms (#2673)
// — where the candidate talks live to an AI system instead of a human —
// from the human-mediated platforms above. It does NOT change
// extractPlatform()'s return contract (still a plain platform-name string);
// it's read separately by isAIInterviewerPlatform() below so existing
// extractPlatform() callers are unaffected.
//
// This flag is a best-effort heuristic tied to extractPlatform()'s own
// first-match resolution, NOT a guarantee that the host is exclusively
// AI-led: isAIInterviewerPlatform() below derives its answer from whichever
// pattern actually wins the same ordered scan extractPlatform() runs, so the
// two agree by construction. Alex/Apriora is flagged `true` for a clean
// single-link Alex match, but Alex is itself multi-modal in practice — it
// also sells a "Coordinator" product that schedules and sends calendar
// invites for human-conducted rounds, so an alex.com link can legitimately
// appear on an invite to a human interview (#2676 review, santifer). When a
// human-platform link (Zoom, Teams, etc.) is also present and wins the scan,
// the match resolves to that human platform and this flag is `false` for
// that invite, even though alex.com appears somewhere in the text. HireVue
// is flagged `false` unconditionally: its `hirevue.com` hosts serve
// on-demand recorded screening, live human-conducted interviews scheduled
// through the platform, and a separate "AI Interviewer" product, all under
// the same domain, with no public discriminator (subdomain, path) that
// reliably distinguishes which modality a given hirevue.com invite link is
// for — HireVue is still detected and named by extractPlatform(), it just
// isn't asserted as confirmed-AI. If HireVue later exposes a reliable
// discriminator, promote its entry then.
const PLATFORM_URL_PATTERNS = [
  { name: 'Zoom', pattern: /(?:^|[^\w@./?=&#-])(?:https?:\/\/)?(?:[\w-]+\.)?zoom\.us(?::\d{1,5})?(?:[/?#\s]|$)/i, isAIInterviewer: false },
  { name: 'Microsoft Teams', pattern: /(?:^|[^\w@./?=&#-])(?:https?:\/\/)?(?:[\w-]+\.)?teams\.(?:microsoft|live)\.com(?::\d{1,5})?(?:[/?#\s]|$)/i, isAIInterviewer: false },
  { name: 'Google Meet', pattern: /(?:^|[^\w@./?=&#-])(?:https?:\/\/)?(?:[\w-]+\.)?meet\.google\.com(?::\d{1,5})?(?:[/?#\s]|$)/i, isAIInterviewer: false },
  // Alex/Apriora — AI-interviewer platform, post-rebrand from a 2024 public
  // glitch incident. `meet.alex.com` and bare `alex.com` are both real
  // invite hosts; the optional-subdomain shape already covers both, same as
  // the Zoom pattern above. Always AI-led by product design.
  { name: 'Alex', pattern: /(?:^|[^\w@./?=&#-])(?:https?:\/\/)?(?:[\w-]+\.)?alex\.com(?::\d{1,5})?(?:[/?#\s]|$)/i, isAIInterviewer: true },
  // HireVue — multi-modal video-screening platform (on-demand recorded,
  // live human-conducted, and a separate AI Interviewer product all share
  // this domain). Detected and named, but NOT asserted as confirmed-AI —
  // see the comment above the array.
  { name: 'HireVue', pattern: /(?:^|[^\w@./?=&#-])(?:https?:\/\/)?(?:[\w-]+\.)?hirevue\.com(?::\d{1,5})?(?:[/?#\s]|$)/i, isAIInterviewer: false },
];

// A plain phone number, used only when no meeting-platform URL was found —
// deliberately simple (not a full E.164/i18n validator), since this is a
// "does this look like a call-in number" heuristic, not a phone-format
// validator. Requires a separator between digit groups so it doesn't fire
// on unrelated long digit runs (req IDs, zip+4, order numbers, etc.).
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

/**
 * Best-effort extraction of the call platform/medium from raw invite or
 * scheduling text — distinct from the round *type* (recruiter screen vs.
 * onsite, etc.), this is specifically about whether the candidate will be
 * on a video call and which one, or on a plain phone call. A meeting-
 * platform URL is checked first (Zoom / Microsoft Teams / Google Meet); if
 * none is present, falls back to a phone-number pattern. Returns null when
 * nothing plausible is found — never guessed, consistent with this
 * project's "silence stays silence" convention (see extractDate/extractReqId
 * above and the title/location filters in scan.mjs).
 *
 * @param {string} text - Raw pasted invite/scheduling text.
 * @returns {'Zoom'|'Microsoft Teams'|'Google Meet'|'Alex'|'HireVue'|'Phone'|null}
 */
export function extractPlatform(text) {
  if (!text) return null;
  for (const { name, pattern } of PLATFORM_URL_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  if (PHONE_PATTERN.test(text)) return 'Phone';
  return null;
}

/**
 * Whether the call platform detected in `text` is a CONFIRMED AI-interviewer
 * platform (#2673) — the candidate has a live conversation with an AI
 * system rather than a human panel. Currently true only for Alex/Apriora,
 * and only when Alex is the pattern that WINS the same ordered scan
 * extractPlatform() runs: the host is not exclusively AI-led, since Alex also
 * sells a "Coordinator" product that sends invites for human-conducted rounds,
 * so an invite carrying both a human link and an alex.com link resolves to the
 * human platform and answers false here. See the comment above
 * PLATFORM_URL_PATTERNS, which this line used to contradict by calling the
 * host "single-purpose and always AI-led by product design" (#2676).
 * HireVue is deliberately excluded even though it's detected by
 * extractPlatform(): it's a multi-modal platform (on-demand recorded,
 * live human-conducted, and a separate AI Interviewer product all share the
 * `hirevue.com` domain) with no public discriminator that reliably tells
 * which modality a given invite link is for, so asserting AI-led for every
 * HireVue match would be a guess, not a detection — see the comment above
 * PLATFORM_URL_PATTERNS. Deliberately a separate boolean helper rather than
 * a change to extractPlatform()'s return contract, so existing callers
 * (interview-prep.md's Platform field, analyzeInvite() below) keep working
 * unmodified. Same "never guessed" discipline as extractPlatform(): pure
 * pattern matching against the same PLATFORM_URL_PATTERNS table, false when
 * nothing plausible — or nothing *confirmed* — is found.
 *
 * @param {string} text - Raw pasted invite/scheduling text.
 * @returns {boolean}
 */
export function isAIInterviewerPlatform(text) {
  if (!text) return false;
  // Must use the SAME first-match iteration as extractPlatform() (#2676
  // review, santifer): scanning independently for any AI-flagged pattern
  // anywhere in the text — regardless of which platform extractPlatform()
  // actually resolves to — let a body containing both a human-platform link
  // (Zoom, Teams) AND an alex.com link flag as AI even though the platform
  // that wins is the human one. Deriving from the same match means the two
  // functions agree by construction: whichever pattern extractPlatform()
  // would report is exactly the one whose isAIInterviewer flag decides this.
  for (const { pattern, isAIInterviewer } of PLATFORM_URL_PATTERNS) {
    if (pattern.test(text)) return isAIInterviewer === true;
  }
  return false;
}

// --- Email-type classification (#2098) ---

// Phrasings that suggest a rejection email. Case-insensitive substring match
// against the raw text — small, documented, and extensible, same discipline
// as COMPANY_LINE_PATTERNS above: this is "does this look like a rejection",
// not an exhaustive NLP classifier. Ordered roughly by how common each
// phrasing is in real ATS-generated rejection templates.
//
// Split into a strong tier and a corroborating-only tier (mirrors the
// strong-marker / corroborating-only-marker distinction modes/oferta.md
// already uses for its jurisdiction-mismatch signal, and the "single
// instance vs. corroborated" framing in modes/interview-redflag.md) — the
// asymmetry matters because `--apply` performs an irreversible tracker write
// gated on a `rejection` classification (#2098). A false `rejection` is the
// unsafe direction (it can mark an active application Rejected); a false
// `invite`/`unknown` merely causes `--apply` to safely refuse. Any phrase
// here that is common in *non-rejection* professional correspondence
// (reschedules, apologies for delays, unrelated bad news) must never be
// sufficient on its own to classify as `rejection` — see CodeRabbit review
// on PR #2100.
//
// Strong-tier bar (maintainer finding, PR #2100 review comment, 2026-08-07):
// a phrase belongs here ONLY if it cannot reasonably appear outside an
// actual candidate rejection — e.g. "we have decided not to move forward"
// and "pursuing other candidates" are safe because they are boilerplate ATS
// rejection language with no other plausible use. Several phrases previously
// listed here fail that bar and can fire on a reschedule, a delay apology,
// or an unrelated (non-candidate-directed) bad-news announcement — those
// have been demoted to REJECTION_PHRASES_WEAK below, where they can only
// contribute as corroborating evidence, never trigger `rejection` alone.
const REJECTION_PHRASES_STRONG = [
  'not been selected to advance',
  'not selected for this position',
  'not selected for this role',
  'not moving forward with your application',
  'decided not to move forward',
  'decided to move forward with other candidates',
  'pursue other candidates',
  'pursuing other candidates',
  'other candidates whose qualifications',
  'not able to offer you a position',
];

// Corroborating-only: too generic to trigger a `rejection` classification by
// itself (e.g. "Unfortunately we need to reschedule your interview" is a
// benign reschedule, not a rejection). Only counts toward `rejection` when
// it co-occurs with a strong phrase above, or with a second distinct
// corroborating phrase — never alone. See classifyEmail() below.
//
// Demoted from the strong tier (maintainer finding, PR #2100 review comment,
// 2026-08-07) because each can plausibly appear outside a rejection:
//   - 'not been selected'          — "a candidate has not been selected yet"
//     is delay-apology phrasing, not necessarily a rejection.
//   - 'will not be moving forward' — generic enough to describe an
//     unrelated project/deal, e.g. "the Q3 expansion will not be moving
//     forward", not specific to a candidate. ('not be moving forward' is
//     deliberately NOT also listed as a separate weak entry: it is a literal
//     substring of 'will not be moving forward', so any text containing the
//     latter would double-count as two "distinct" weak matches from a single
//     utterance and defeat the two-corroborating-phrases gate below.)
//   - 'not successful'             — extremely generic ("was not successful
//     in reaching you", "the negotiation was not successful").
//   - 'regret to inform'           — the classic company-wide bad-news
//     opener (layoffs, restructuring announcements) as much as a rejection
//     opener; not directed at the candidate by itself.
//   - 'will not be proceeding'     — generic business phrasing (mergers,
//     projects, purchases) with no candidate-specific anchor.
//   - 'unable to offer you'        — also plausible mid-negotiation, e.g.
//     "unable to offer you a higher base salary" is not a rejection.
const REJECTION_PHRASES_WEAK = [
  'unfortunately',
  'not been selected',
  'will not be moving forward',
  'not successful',
  'regret to inform',
  'will not be proceeding',
  'unable to offer you',
];

// Phrasings that suggest an interview invite. Mirrors the rejection phrase
// lists above for
// the opposite case; extractCompany's own patterns already do the real work
// of the invite path, so this list exists purely for classification.
const INVITE_PHRASES = [
  'schedule your phone screen',
  'schedule your interview',
  'phone screen',
  'interviewing with',
  'interview with',
  'would like to invite you',
  'invite you to interview',
  'next steps in the interview process',
  'move you forward to the next round',
  'like to set up a time',
  'like to set up a call',
  'book a time',
];

/**
 * Classify pasted email text as `invite`, `rejection`, or `unknown`, and
 * report which phrase(s) drove the call — so a human/agent can sanity-check
 * a `rejection` classification before `--apply` performs its irreversible
 * tracker write (#2098, CodeRabbit review on PR #2100).
 *
 * Rejection requires either a strong phrase (unambiguous on its own) or two
 * distinct corroborating-only phrases together — a single corroborating-only
 * phrase (e.g. "unfortunately") is never sufficient by itself, since it is
 * common in unrelated professional correspondence (reschedules, delays) and
 * a false `rejection` is the unsafe misclassification direction here.
 *
 * Informational only — never a gate on matching. An email that mentions both
 * (e.g. a rejection that references an earlier phone screen: "Thank you for
 * interviewing with us. Unfortunately, we regret to inform you...") is
 * classified `rejection`: that language is the more decisive signal of the
 * two, and it is also the only classification the --apply path acts on.
 *
 * `phraseStrength` reports whether a `rejection` classification was driven by
 * a strong (unambiguous-on-its-own) phrase or only by weak corroborating
 * phrases — the `--apply` confidence gate on a sole fuzzy-matched candidate
 * requires `'strong'` before auto-writing Rejected (#2100 CodeRabbit review,
 * see selectApplyTarget()). `null` for non-`rejection` classifications.
 *
 * @param {string} text - Raw pasted email text.
 * @returns {{classification: 'invite'|'rejection'|'unknown', matchedPhrases: string[], phraseStrength: 'strong'|'weak'|null}}
 */
export function classifyEmail(text) {
  if (!text) return { classification: 'unknown', matchedPhrases: [], phraseStrength: null };
  const lower = text.toLowerCase();
  const strongMatches = REJECTION_PHRASES_STRONG.filter(p => lower.includes(p));
  const weakMatches = REJECTION_PHRASES_WEAK.filter(p => lower.includes(p));
  const isStrongRejection = strongMatches.length > 0;
  const isRejection = isStrongRejection || weakMatches.length >= 2;
  if (isRejection) {
    return {
      classification: 'rejection',
      matchedPhrases: [...strongMatches, ...weakMatches],
      phraseStrength: isStrongRejection ? 'strong' : 'weak',
    };
  }

  const inviteMatches = INVITE_PHRASES.filter(p => lower.includes(p));
  if (inviteMatches.length > 0) return { classification: 'invite', matchedPhrases: inviteMatches, phraseStrength: null };

  return { classification: 'unknown', matchedPhrases: [], phraseStrength: null };
}

// --- Interview constraints (#5732) ---

// Phrase matching only (zero-token, no network). Each detector is deliberately
// narrow: "silence stays silence" -- a constraint is reported only when the
// invite says it. Keys are stable; the tag form `[constraint:<key>]` mirrors
// the `[process-friction]` convention parsed by process-quality.mjs.
// A duration counts as the interview's length only when the text ties it to the
// interview: a length verb or noun right before it ("lasts 30 minutes", "plan for
// 45 minutes", "Duration: 30 minutes"), an adjective form ("a 45-minute interview",
// "30 minutes long"), or a bracketed length ("(30 minutes)"). Other intervals --
// "join 10 minutes early", "reply within 24 hours", "starts 30 minutes after the
// assessment" -- have no such tie, so they never suppress length-not-stated.
const LENGTH_CONTEXT = /\b(?:last|lasts|lasting|take|takes|taking|run|runs|running|duration|length|scheduled for|set for|plan for|allow|allot|allocate|expect|approximately|about|around|up to|for)\b[^.\n]{0,25}?\b\d+(?:\.\d+)?\s*[-–]?\s*(?:minutes?|mins?|hours?|hrs?)\b/i;
const LENGTH_ADJECTIVE = /\b\d+(?:\.\d+)?\s*[-–]?\s*(?:minutes?|mins?|hours?|hrs?)\s*[-–]?\s*(?:long\b|(?:interview|call|conversation|session|meeting|chat|screen|screening|assessment)\b)/i;
const LENGTH_BRACKETED = /\(\s*\d+(?:\.\d+)?\s*[-–]?\s*(?:minutes?|mins?|hours?|hrs?)\s*\)/i;
const LENGTH_NAMED = /\b(?:half|one|an)[-\s]hour\b/i;
function statesDuration(text) {
  // "The interview will be 30 minutes": an interview noun + copula + duration.
  const copula = /\b(?:interview|call|conversation|session|meeting|chat|screen|screening|assessment)\s+(?:will\s+be|would\s+be|should\s+be|is|runs?)\s+(?:about\s+|around\s+|approximately\s+)?\d+(?:\.\d+)?\s*[-–]?\s*(?:minutes?|mins?|hours?|hrs?)\b/i;
  return LENGTH_CONTEXT.test(text) || LENGTH_ADJECTIVE.test(text) || LENGTH_BRACKETED.test(text) || LENGTH_NAMED.test(text) || copula.test(text);
}

const NAME = "[\\p{Lu}][\\p{L}'.-]*(?:\\s+[\\p{Lu}][\\p{L}'.-]*){0,3}";
const DASH = "\\s*[-\\u2013\\u2014,]\\s*";
// "with Jordan Reyes - Director of X and Sam Ito - Manager of Y"
const PANEL_LINE = new RegExp(`\\bwith\\s+(${NAME}${DASH}[^\\n]+)`, 'u');
const PANEL_SPLIT = new RegExp(`\\s+and\\s+(?=${NAME}${DASH})`, 'u');
const PANEL_DASH = new RegExp(DASH, 'u');

const CONSTRAINT_DETECTORS = [
  // The prohibition must sit in the same sentence as the AI-tool mention.
  { key: 'no-ai', test: t => /\b(?:ai|artificial intelligence|chatgpt|copilot|generative)\b[^.\n]{0,120}\b(?:not (?:be )?(?:permitted|allowed)|(?<!\bnot\s)(?<!n't\s)(?<!\bno longer\s)(?:prohibited|forbidden)|not be used)\b/i.test(t)
      || /\b(?:not (?:be )?(?:permitted|allowed)|prohibited|forbidden|may not use|do not use|must not use)\b[^.\n]{0,80}\b(?:ai|artificial intelligence|chatgpt|copilot)\b/i.test(t) },
  { key: 'recorded', test: t => /\b(?:will|may) be (?:audio[- ]?|video[- ]?)?recorded\b|\bwe (?:will|may) record\b|\bthis (?:interview|call|session|meeting) is (?:being )?recorded\b/i.test(t) },
  { key: 'no-recording', test: t => /\b(?:recording|recordings)\b[^.\n]{0,60}\b(?:not (?:be )?(?:permitted|allowed)|prohibited)\b|\b(?:do not|don't|may not|must not) (?:record|screenshot)\b|\bno recording\b/i.test(t) },
  { key: 'camera-required', test: t => /\bcamera\b[^.\n]{0,40}\b(?:(?<!\bnot\s)(?<!n't\s)(?<!\bno longer\s)(?:required|mandatory)|must be on|on throughout)\b|\b(?:required|must|please) (?:to )?(?:have|keep|turn on|enable)\b[^.\n]{0,30}\b(?:camera|video on)\b|\bvideo (?:must be|required)\b/i.test(t) },
  { key: 'test-link', test: t => /\b(?:test|check|try)\b[^.\n]{0,40}\b(?:link|connection|audio|video|setup)\b[^.\n]{0,40}\b(?:before(?:hand)?|ahead of|in advance|prior to)\b/i.test(t) },
  { key: 'id-required', test: t => /\b(?:photo |government[- ]issued |valid )?(?:id|identification)\b[^.\n]{0,40}\b(?:(?<!\bnot\s)(?<!n't\s)(?<!\bno longer\s)required|must|will be (?:checked|verified|requested))\b|\b(?:bring|have|present|show)\b[^.\n]{0,40}\b(?:photo id|government[- ]issued id|identification)\b/i.test(t) },
];

// Untitled list: "with Jordan Reyes and Sam Ito" / "with A B, C D and E F".
// Product and platform words are not interviewers.
const PANEL_UNTITLED = new RegExp(`\\bwith\\s+(${NAME}(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${NAME}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${NAME})*)`, 'u');
const NOT_A_PERSON = /\b(?:teams|zoom|google|meet|microsoft|webex|skype|outlook|calendar|link|phone|video|camera|team|hr|recruiter|us|me)\b/i;
function extractPanel(text) {
  const m = text.match(PANEL_LINE);
  if (m) {
    const people = m[1].replace(/[.\s]+$/, '').split(PANEL_SPLIT).map(p => p.trim()).filter(Boolean);
    if (people.length >= 2) return people.map(p => p.split(PANEL_DASH)[0].trim());
  }
  const u = text.match(PANEL_UNTITLED);
  if (!u) return null;
  const names = u[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(n => n.replace(/[.\s]+$/, '').trim()).filter(Boolean);
  if (names.length < 2 || names.some(n => NOT_A_PERSON.test(n))) return null;
  return names;
}

/**
 * Extract the interview's rules from pasted invite text by phrase matching.
 * Returns an array of `{key, tag, detail?}` in a fixed order. Keys: no-ai,
 * recorded, no-recording, camera-required, test-link, id-required, panel
 * (detail = names), length-not-stated. Empty/non-string input returns [];
 * `length-not-stated` is only added when the text is non-empty and reads like
 * an invite (so unrelated text does not gain a spurious constraint).
 *
 * @param {string} text
 * @returns {Array<{key: string, tag: string, detail?: string}>}
 */
export function extractConstraints(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const add = (key, detail) => out.push({ key, tag: `[constraint:${key}]`, ...(detail ? { detail } : {}) });
  for (const { key, test } of CONSTRAINT_DETECTORS) if (test(text)) add(key);
  const panel = extractPanel(text);
  if (panel) add('panel', panel.join('; '));
  if (classifyEmail(text).classification === 'invite' && !statesDuration(text)) add('length-not-stated');
  return out;
}

// --- Tracker loading ---
function loadTracker(appsFile = APPS_FILE) {
  if (!existsSync(appsFile)) return [];
  const content = readFileSync(appsFile, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const entries = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) entries.push(row);
  }
  return entries;
}

/**
 * Core matcher: given extracted invite signals and a list of tracker rows,
 * return ranked candidates. Exported so tests can drive it directly against
 * fixture rows without touching the real tracker file.
 *
 * @param {{company: string|null, date: string|null, reqId: string|null}} signals
 * @param {Array<object>} trackerRows - Rows from parseTrackerRow().
 * @returns {Array<object>} Ranked candidates, highest confidence first.
 */
export function matchInvite(signals, trackerRows) {
  if (!signals || !signals.company || !Array.isArray(trackerRows)) return [];

  const targetKey = normalizeCompanyName(signals.company);
  if (!targetKey) return [];
  const reqId = signals.reqId?.toLowerCase();

  const scored = [];
  for (const row of trackerRows) {
    const rowKey = normalizeCompanyName(row.company);
    const nameScore = companySimilarity(targetKey, rowKey);
    if (nameScore <= 0) continue;

    let confidence = nameScore;

    // A req/job ID appearing in the row's notes is a near-certain match —
    // boost it above any name-only match (including another exact name
    // match without the req ID). Match the whole ID token, so JR1234 cannot
    // also boost a different requisition JR12345 or JR1234-A. Preserve the
    // shared parser's explicit glued labels (req_JR1234, reqJR1234), but require the
    // whole suffix. A bare JR1234 is an ID, not a label for numeric ID 1234;
    // after a separate label, REQ-1234 is itself the ID, not another label.
    // Compared case-insensitively: the invite
    // and the notes may case the same ID differently ("jr12352" vs
    // "JR12352"). matchConfidence is a ranking score, not a probability,
    // so it's intentionally allowed to exceed 1 here.
    if (reqId && row.notes
      && row.notes.toLowerCase().split(/[^a-z0-9_-]+/)
        .filter(token => /[a-z0-9]/.test(token)).some((token, index, tokens) =>
        token === reqId || (!/^(?:(?:requisition|req|job(?:id)?|posting(?:id)?|ref(?:erence)?|jr|id)[_-]*|r_[_-]*)$/.test(tokens[index - 1] || '')
          && /^(?:(?:requisition|req|job(?:id)?|posting(?:id)?|ref(?:erence)?)[_-]?|r_)/.test(token)
          && token.endsWith(reqId) && extractReqNumber(token)?.toLowerCase() === reqId))) {
      confidence += 0.5;
    }

    // Prefer rows in an active/actionable status over closed-out ones when
    // the same company has multiple tracker entries.
    const statusRank = STATUS_PRIORITY[normalizeStatusKey(row.status)] ?? 8;
    confidence += (7 - Math.min(statusRank, 7)) * 0.01; // tiny tiebreaker, never dominates nameScore

    scored.push({
      appNumber: row.num,
      company: row.company,
      role: row.role,
      status: row.status,
      date: row.date,
      matchConfidence: Math.round(confidence * 1000) / 1000,
      // Raw company-name similarity (1 == exact/confirmed match), separate
      // from matchConfidence — the reqId boost or status tiebreaker can push
      // matchConfidence above 1 for a fuzzy (non-exact) name match, so
      // matchConfidence alone can't answer "was this an exact company-name
      // match". The --apply sole-candidate confidence gate needs that exact
      // answer (#2100 CodeRabbit review, see selectApplyTarget()).
      nameScore,
    });
  }

  scored.sort((a, b) => b.matchConfidence - a.matchConfidence);
  return scored;
}

// --- Pre-interview clarification draft (#6092) ---

// Locale-keyed so a market mode can add its own wording later; English only for
// now. Placeholders are literal bracketed text the candidate fills in.
const CLARIFICATION_TEMPLATES = {
  en: {
    subject: (company, role) => `Questions ahead of the ${role} interview at ${company}`,
    greeting: name => (name ? `Hello ${name},` : 'Hello,'),
    intro: (company, role) =>
      `Thank you for the invitation to interview for the ${role} position at ${company}. I am looking forward to it, and I would like to prepare well. Could you share a few details beforehand?`,
    questions: [
      'Who does this role report to?',
      'What are the main deliverables expected in the first three months?',
      'Is the posting the full scope of the role, or are there responsibilities beyond what it lists?',
    ],
    closing: 'Thank you, and I look forward to speaking with you.',
    signoff: 'Best regards,\n[Your name]',
  },
};
const PLACEHOLDER_COMPANY = '[company]';
const PLACEHOLDER_ROLE = '[role]';

const REPORTING_LINE_STATED = /\b(?:reports?\s+(?:directly\s+)?to|reporting\s+(?:line|to|structure)|you\s+will\s+report|will\s+report\s+to)\b/i;
const DELIVERABLES_STATED = /\b(?:deliverables?|first\s+(?:three|3|90|ninety)\s+(?:months?|days?)|first\s+(?:quarter|90\s*days)|key\s+responsibilities|responsibilities\s+(?:include|are)|you\s+will\s+be\s+responsible)\b/i;

// Text that came from the invite is untrusted: only ever let a short, plain
// name through, never anything carrying a link, address, or line break.
function safeName(value, maxLen) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > maxLen) return null;
  if (!/^[\p{L}][\p{L}0-9 '&.,-]*$/u.test(v)) return null;
  if (/https?|www\.|@/i.test(v)) return null;
  return v;
}

// Tracker cells are the user's own data, so they get a wider allowlist than
// invite-derived text (parentheses, slashes, digits, combining marks), with the
// same hard stops: length, control characters, links and addresses.
const TRACKER_NAME_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '&.,()+\/#:;\u{2019}\u{2013}\u{2014}-]*$/u;
function safeTrackerName(value, maxLen) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > maxLen) return null;
  if (/[\p{Cc}\u{2028}\u{2029}]/u.test(v)) return null;
  if (!TRACKER_NAME_RE.test(v) || /https?|www\.|@/i.test(v)) return null;
  return v;
}

// A contact name is used only when the invite names one in a place a sender
// belongs: a From: line, or a sign-off followed by a name line. First name only.
function extractContactName(text) {
  const NAME_ONLY = /^[\p{Lu}][\p{L}'.-]*(?:\s+[\p{Lu}][\p{L}'.-]*){0,2}$/u;
  // Sender labels that name a team or organisation, not a person. Deliberately
  // not NOT_A_PERSON, whose "link" would reject real surnames.
  const NOT_A_CONTACT = /\b(?:careers?|recruit(?:er|ers|ing|ment)|talent|hiring|resources|team|support|notifications?|hr|staffing)\b/i;
  const firstName = raw => {
    const t = raw.trim();
    if (!NAME_ONLY.test(t) || NOT_A_CONTACT.test(t)) return null;
    return safeName(t, 40)?.split(/\s+/)[0] ?? null;
  };
  const from = text.match(/^\s*from\s*:\s*([^\n<]+?)\s*(?:<[^>\n]*>)?\s*$/im);
  const fromName = from ? firstName(from[1]) : null;
  if (fromName) return fromName;
  // A rejected From: label (e.g. a team) falls through to the sign-off.
  const sign = text.match(/\n\s*(?:best(?: regards)?|kind regards|regards|thanks|thank you|sincerely|cheers)\s*,?\s*\n\s*([^\n]+)\s*(?:\n|$)/i);
  return sign ? firstName(sign[1]) : null;
}

// The report cell is a markdown link; resolve it against each root in turn.
// Reads only local .md files that stay inside one of those roots.
function readReportHeader(reportCell, roots) {
  const href = typeof reportCell === 'string' ? reportCell.match(/\]\(([^)\s]+)\)/)?.[1] : null;
  if (!href || !href.toLowerCase().endsWith('.md') || /^[a-z]+:/i.test(href)) return '';
  for (const root of roots) {
    const full = resolve(root, href);
    const rel = relative(root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    try {
      if (existsSync(full)) return readFileSync(full, 'utf-8').split('\n').slice(0, 40).join('\n');
    } catch { /* unreadable report: treat as no record */ }
  }
  return '';
}

/**
 * Build the pre-interview clarification email draft (subject + body) for an
 * invite-classified analysis. Pure and offline: reads only the analysis, the
 * invite text, and (optionally) the matched row's report header. Never sends.
 *
 * Company/role come from the tracker row only when exactly one candidate
 * matched with an exact company-name match; otherwise the role is left as a
 * `[role]` placeholder rather than guessed.
 *
 * @param {object} analysis - Result of analyzeInvite (before clarificationDraft is added).
 * @param {string} text - The pasted invite text.
 * @param {{row?: object|null, readReport?: (row: object) => string, lang?: string}} [options]
 * @returns {{subject: string|null, body: string|null, skipped: boolean, skipReason: string|null}|null}
 */
export function buildClarificationDraft(analysis, text, options = {}) {
  if (!analysis || analysis.classification !== 'invite') return null;
  const tpl = CLARIFICATION_TEMPLATES[options.lang] || CLARIFICATION_TEMPLATES.en;
  const skip = reason => ({ subject: null, body: null, skipped: true, skipReason: reason });
  const invite = typeof text === 'string' ? text : '';

  const candidates = analysis.candidates || [];
  const confident = candidates.length === 1 && candidates[0].nameScore === 1 ? candidates[0] : null;

  if (confident && options.row) {
    const row = options.row;
    if (REPORTING_LINE_STATED.test(row.notes || '')) {
      return skip(`tracker row #${row.num} notes already record a reporting line`);
    }
    const header = options.readReport ? options.readReport(row) : '';
    if (REPORTING_LINE_STATED.test(header)) {
      return skip(`report for tracker row #${row.num} already records a reporting line`);
    }
  }
  if (REPORTING_LINE_STATED.test(invite) && DELIVERABLES_STATED.test(invite)) {
    return skip('the invite already states the reporting line and deliverables');
  }

  let company = null;
  let role = null;
  if (confident) {
    company = safeTrackerName(confident.company, 60);
    role = safeTrackerName(confident.role, 80);
  } else {
    // No tracker fallback outside an exact single match.
    company = safeName(analysis.signals?.company, 60);
  }
  company = company || PLACEHOLDER_COMPANY;
  role = role || PLACEHOLDER_ROLE;

  const lines = [
    tpl.greeting(extractContactName(invite)), '',
    tpl.intro(company, role), '',
    ...tpl.questions.map((q, i) => `${i + 1}. ${q}`), '',
    tpl.closing, '',
    tpl.signoff,
  ];
  return { subject: tpl.subject(company, role), body: lines.join('\n'), skipped: false, skipReason: null };
}

/**
 * End-to-end: parse invite text, load the tracker, return ranked candidates
 * plus the signals that were extracted (so the caller/CLI can show what was
 * understood from the email, not just the result).
 *
 * @param {string} text - Raw invite/rejection email text.
 * @param {Array<object>} [trackerRows] - Injectable for tests; defaults to loadTracker().
 * @param {{clarificationDraft?: boolean, readReport?: (row: object) => string}} [options] - clarificationDraft:false suppresses the draft (`--no-clarification-draft`); readReport is injectable for tests.
 * @returns {{signals: object, classification: 'invite'|'rejection'|'unknown', matchedPhrases: string[], phraseStrength: 'strong'|'weak'|null, candidates: Array<object>, constraints: Array<{key: string, tag: string, detail?: string}>, clarificationDraft: object|null}}
 */
export function analyzeInvite(text, trackerRows = null, options = {}) {
  const signals = {
    company: extractCompany(text),
    date: extractDate(text),
    reqId: extractReqId(text),
    platform: extractPlatform(text),
    // Additive field (#2673) — does not change the shape of any existing
    // key above, so existing callers reading `signals.platform` etc. are
    // unaffected.
    isAIInterviewer: isAIInterviewerPlatform(text),
  };
  // Additive (#5732): top-level so every existing key keeps its shape.
  const constraints = extractConstraints(text);
  const rows = trackerRows ?? loadTracker();
  const candidates = matchInvite(signals, rows);
  const { classification, matchedPhrases, phraseStrength } = classifyEmail(text);
  const result = { signals, classification, matchedPhrases, phraseStrength, candidates, constraints };
  // Additive (#6092): appended last so every existing key keeps its position.
  // null unless the text is an invite and the draft was not suppressed.
  let clarificationDraft = null;
  if (options.clarificationDraft !== false) {
    const row = candidates.length === 1 ? rows.find(r => r.num === candidates[0].appNumber) : null;
    clarificationDraft = buildClarificationDraft(result, text, {
      row,
      readReport: options.readReport ?? (r => readReportHeader(r.report, [dirname(APPS_FILE), CAREER_OPS])),
    });
  }
  return { ...result, clarificationDraft };
}

/**
 * Advance a single tracker row's status to Rejected, reusing set-status.mjs
 * as a subprocess — the canonical, locked, atomic write path (#2098) — rather
 * than duplicating its row-rewrite/locking logic here. set-status.mjs already
 * imports its atomic-write and locking primitives from tracker-utils.mjs.
 *
 * Never call this on an ambiguous match — the CLI layer below is responsible
 * for confirming a single confident candidate (or an explicit --id) before
 * reaching this function.
 *
 * @param {number} appNumber - Tracker # to update (must be unambiguous).
 * @param {{appsFile?: string}} [options] - appsFile overrides CAREER_OPS_TRACKER for the child process (tests only).
 * @returns {object} set-status.mjs's own --json result (or its structured error).
 */
export function applyRejectionStatus(appNumber, options = {}) {
  const scriptPath = join(CAREER_OPS_CODE_ROOT, 'set-status.mjs');
  const env = options.appsFile ? { ...process.env, CAREER_OPS_TRACKER: options.appsFile } : process.env;
  try {
    const out = execFileSync(process.execPath, [scriptPath, String(appNumber), 'Rejected', '--json'], {
      encoding: 'utf-8', env,
      // Capture the child's stderr instead of letting execFileSync's default
      // inherit it. set-status.mjs's failWith writes the machine payload to
      // stdout AND an `❌ {message}` line to stderr; inherited, that line
      // printed straight through this function — which by contract returns a
      // structured result and never speaks for itself — into whatever was
      // running it. In the test suite a *passing* assertion therefore emitted
      // `❌ No tracker row with #999`, indistinguishable from a real failure.
      // Nothing is lost: it is the same string as the JSON `error` field the
      // CLI already prints as "Apply FAILED: ...".
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    // set-status.mjs writes JSON to stdout even on failure when --json is
    // passed (its failWith/failUsage contract) — prefer that structured
    // payload over a raw exception when it is present and parseable.
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* fall through */ }
    }
    // failUsage's non-JSON branch (and any hard crash) leaves stderr as the
    // only account of what went wrong; now that it is piped, fold it into the
    // returned error rather than dropping it on the floor.
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
    return { error: stderr || err.message, code: 'apply-failed' };
  }
}

/**
 * Decide which (if any) candidate `--apply` should act on, given an
 * `analyzeInvite()` result and an optional `--id` override. Pure decision
 * logic, no I/O — pulled out of the CLI block so tests can drive every
 * branch directly (#2100 CodeRabbit review nitpick: this branch logic had no
 * direct test coverage).
 *
 * The single-candidate auto-select branch additionally requires a confidence
 * gate: the sole candidate is only auto-applied when it is an exact/confirmed
 * company-name match (`nameScore === 1`) AND the classification is backed by
 * a strong rejection phrase (`phraseStrength === 'strong'`), not just a weak
 * corroborating one. `matchInvite`'s fuzzy token-overlap scoring can return a
 * single low-confidence candidate for a loosely-worded company name — a
 * false auto-apply off a match that weak is the unsafe direction, since
 * `--apply` performs an irreversible tracker write (#2100 CodeRabbit review,
 * major finding on the old line 768-769 unconditional sole-candidate
 * selection). A sole candidate that clears "one row matched" but not this
 * confidence bar falls back to requiring an explicit `--id`.
 *
 * @param {{candidates: Array<object>, phraseStrength: 'strong'|'weak'|null}} result - analyzeInvite() output.
 * @param {number|null} idArg - Parsed --id value, or null if not passed.
 * @returns {{target: object}|{error: string, code: number, candidate?: object, candidates?: Array<object>}}
 */
export function selectApplyTarget(result, idArg) {
  if (idArg !== null) {
    const target = result.candidates.find(c => c.appNumber === idArg);
    if (!target) {
      return {
        error: `invite-match: --id ${idArg} is not among the matched candidates — not applying.`,
        code: 2,
      };
    }
    return { target };
  }

  if (result.candidates.length === 0) {
    return { error: 'invite-match: no matching tracker entries found — not applying.', code: 2 };
  }

  if (result.candidates.length === 1) {
    const sole = result.candidates[0];
    const isExactCompanyMatch = sole.nameScore === 1;
    const isStrongRejection = result.phraseStrength === 'strong';
    if (isExactCompanyMatch && isStrongRejection) {
      return { target: sole };
    }
    return {
      error: `invite-match: sole candidate #${sole.appNumber} did not meet the confidence bar for auto-apply `
        + `(exact company match: ${isExactCompanyMatch}, strong rejection phrase: ${isStrongRejection}) — `
        + `re-run with --id ${sole.appNumber} to confirm explicitly.`,
      code: 2,
      candidate: sole,
    };
  }

  return {
    error: `invite-match: ${result.candidates.length} candidates matched — ambiguous, refusing to auto-apply. `
      + `Re-run with --id <#> to disambiguate.`,
    code: 3,
    candidates: result.candidates,
  };
}

// --- Summary mode ---
function printClarificationDraft(draft) {
  if (!draft) return;
  if (draft.skipped) {
    console.log(`  Clarification draft: skipped (${draft.skipReason})\n`);
    return;
  }
  console.log('  Clarification draft (not sent -- review before sending):');
  console.log(`  Subject: ${draft.subject}`);
  for (const line of draft.body.split('\n')) console.log(`    ${line}`);
  console.log('');
}

function printSummary(result) {
  console.log(`\n${'='.repeat(70)}`);
  console.log('  Interview Invite / Rejection Matcher — career-ops');
  console.log(`${'='.repeat(70)}\n`);

  console.log(`  Classification:     ${result.classification}`);
  console.log(`  Matched phrase(s):  ${result.matchedPhrases && result.matchedPhrases.length ? result.matchedPhrases.join(', ') : '(none)'}`);
  console.log(`  Extracted company:  ${result.signals.company || '(not found)'}`);
  console.log(`  Extracted date:     ${result.signals.date || '(not found)'}`);
  console.log(`  Extracted req ID:   ${result.signals.reqId || '(not found)'}`);
  console.log(`  Extracted platform: ${result.signals.platform || '(not found)'}`);
  const constraints = result.constraints || [];
  console.log(`  Constraints:        ${constraints.length ? constraints.map(c => c.tag + (c.detail ? ` (${c.detail})` : '')).join(' ') : '(none)'}`);
  if (constraints.some(c => c.key === 'length-not-stated')) {
    console.log('  Length not stated -- mark the calendar block as a guess.');
  }
  console.log('');
  printClarificationDraft(result.clarificationDraft);

  if (!result.signals.company) {
    console.log('  Could not find a company name in the invite text — paste more context or check manually.\n');
    return;
  }

  if (result.candidates.length === 0) {
    console.log('  No matching tracker entries found for this company.\n');
    return;
  }

  console.log('  ' + '#'.padEnd(6) + 'Company'.padEnd(20) + 'Role'.padEnd(34) + 'Status'.padEnd(12) + 'Confidence');
  console.log('  ' + '-'.repeat(88));
  for (const c of result.candidates.slice(0, 5)) {
    console.log(
      '  ' +
      String(c.appNumber).padEnd(6) +
      c.company.substring(0, 18).padEnd(20) +
      c.role.substring(0, 32).padEnd(34) +
      c.status.padEnd(12) +
      String(c.matchConfidence)
    );
  }
  console.log('');
}

// --- Self-test ---
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // Smoke checks across the core pipeline
  check(normalizeCompanyName('Acme Corp.') === 'acme', 'normalizeCompanyName strips corporate suffixes');
  check(extractCompany('Company: Example Industries\nRole: Analyst') === 'Example Industries', 'extractCompany extracts company name');
  check(extractPlatform('Join via Zoom: https://us02web.zoom.us/j/1234567890') === 'Zoom', 'extractPlatform detects Zoom URL');
  check(classifyEmail('Unfortunately, we have decided not to move forward with your application.').classification === 'rejection', 'classifyEmail detects rejection');
  check(classifyEmail('We would like to invite you to schedule your phone screen for next week.').classification === 'invite', 'classifyEmail detects invite');

  const rows = [
    { num: 101, company: 'Example Industries', role: 'Analyst', status: 'Applied', date: '2026-06-01', notes: '' },
  ];
  const fullText = 'Company: Example Industries\nWe would like to invite you to schedule your phone screen.\nInterview scheduled for 2026-07-09\nJoin via Zoom: https://zoom.us/j/1234567890';
  const result = analyzeInvite(fullText, rows);
  check(
    result.signals.company === 'Example Industries' &&
    result.signals.platform === 'Zoom' &&
    result.candidates.length === 1 &&
    result.candidates[0].appNumber === 101 &&
    result.classification === 'invite',
    'analyzeInvite extracts signals and matches candidates end-to-end'
  );

  console.log(`\n  invite-match self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (isMainModule(import.meta.url)) {
  if (selfTestMode) {
    runSelfTest();
  } else {
    let text;
    if (filePathArg) {
      if (!existsSync(filePathArg)) {
        console.error(`invite-match: file not found: ${filePathArg}`);
        process.exit(1);
      }
      text = readFileSync(filePathArg, 'utf-8');
    } else {
      text = readFileSync(0, 'utf-8'); // stdin
    }

    const result = analyzeInvite(text, null, { clarificationDraft: !noClarificationDraft });

    if (applyMode) {
      // Scoped strictly to the Rejected transition (#2098) — never applies
      // for an invite/unknown classification, and never for an ambiguous
      // match unless the caller disambiguates with --id.
      if (result.classification !== 'rejection') {
        console.error(`invite-match: --apply only applies the Rejected transition, but this text classified as "${result.classification}" — not applying.`);
        if (summaryMode) printSummary(result); else console.log(JSON.stringify(result, null, 2));
        process.exit(1);
      }

      const selection = selectApplyTarget(result, idArg);
      if (selection.error) {
        console.error(selection.error);
        if (selection.candidates) {
          // Ambiguous multi-candidate case: the ranked list IS the
          // actionable output (each row's # is what --id expects), so print
          // that instead of the full JSON/summary dump the other refusal
          // branches use.
          for (const c of selection.candidates) {
            console.error(`  #${c.appNumber}\t${c.company}\t${c.role}\t${c.status}\t${c.matchConfidence}`);
          }
        } else if (summaryMode) {
          printSummary(result);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
        process.exit(selection.code);
      }
      const target = selection.target;

      const applyResult = applyRejectionStatus(target.appNumber);
      const output = { ...result, applied: applyResult };
      if (summaryMode) {
        printSummary(result);
        console.log(applyResult.error
          ? `  Apply FAILED: ${applyResult.error}\n`
          : `  Applied: #${applyResult.num} ${applyResult.company} — ${applyResult.role}: ${applyResult.oldStatus} → ${applyResult.newStatus}\n`);
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
      process.exit(applyResult.error ? 1 : 0);
    }

    if (summaryMode) {
      printSummary(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}
