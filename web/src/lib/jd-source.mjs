/**
 * jd-source.mjs — the pasted / uploaded job description, as a first-class posting.
 *
 * "Add job" accepts three shapes of the same thing: a link, a block of pasted JD
 * text, and a file (PDF, DOCX, MD, TXT). Only the link has a URL, so the other two
 * need an identity of their own before any of the existing machinery can carry
 * them. Rather than invent one, this module reuses the reference form the core
 * already uses everywhere a JD is cited without a live posting behind it:
 *
 *   local:jds/{filename}
 *
 * That form is read by modes/pipeline.md and modes/triage.md, written by
 * archive-posting.mjs and the apify plugin, and matched by outcome.mjs. A row
 * carrying one flows through data/pipeline.md, readInbox, the inbox triage view
 * and /api/run untouched, because none of them require parts[0] to be a URL — the
 * only two places that did are cleanPipelineOffers' normalizer and the evaluate
 * prompt, and both now branch on isJdRef.
 *
 * Deliberately NOT a URL scheme: `local:` is not fetchable, and normalizeJobUrl
 * refuses every non-http scheme on purpose (javascript:, file:). Keeping the JD
 * reference outside that function means a pasted `file:///etc/passwd` is still
 * refused for exactly the reason it always was.
 *
 * Plain dependency-free .mjs (same pattern as job-url.mjs / pdf-paths.mjs) so the
 * whole identity contract is unit-testable under bare `node --test`.
 *
 * NO node builtins here, deliberately: the Add job dialog and the job store are
 * both "use client", so this module is bundled for the browser. Everything that
 * needs the filesystem or node:crypto lives in jd-archive.mjs, which only the
 * server imports.
 */

export const JD_REF_PREFIX = "local:jds/";

/** Longest JD we will store. Far past any real posting; bounds the work below. */
export const MAX_JD_CHARS = 200_000;

/**
 * Shortest thing we will accept as a job description.
 *
 * A one-line paste is almost always a mis-paste (a job TITLE, a truncated
 * clipboard, an accidental paste of whatever was copied before). Evaluating it
 * produces a confident-looking A-F report scored against nothing, which is the
 * same failure LinkedIn's authwall produced before job-url.mjs existed. Refuse
 * instead.
 */
export const MIN_JD_CHARS = 200;

/** Characters a generated JD filename may contain, after slugging. */
const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]*\.md$/;

/**
 * Lowercase hyphen slug, bounded. Input with nothing sluggable in it (empty, or
 * e.g. CJK-only) yields "" so the caller can substitute its own placeholder
 * rather than emit a filename made of hyphens.
 *
 * @param {string} s
 * @param {number} [max]
 * @returns {string}
 */
export function slug(s, max = 40) {
  // One linear pass to collapse, then index trimming rather than /^-+|-+$/.
  // The company and role are typed by the user, so an anchored `-+` run against
  // them is a polynomial-backtracking input the caller controls (CodeQL
  // js/polynomial-redos). Scanning from each end is provably linear and says
  // what it does.
  return trimHyphens(trimHyphens(String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, max));
}

/**
 * Drop leading and trailing "-" from an already-collapsed slug. O(n), no regex.
 *
 * @param {string} s
 * @returns {string}
 */
function trimHyphens(s) {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "-") start++;
  while (end > start && s[end - 1] === "-") end--;
  return s.slice(start, end);
}

/**
 * Is this string a JD reference this app wrote or can safely resolve?
 *
 * Strict by construction, because the value reaches `path.join(root, "jds", …)`
 * on the server: one path segment, no traversal, no separators, no leading dot,
 * `.md` only. A string that fails here is treated as "not a JD reference" and
 * falls through to the URL path, where it is refused with a normal error.
 *
 * @param {unknown} s
 * @returns {boolean}
 */
export function isJdRef(s) {
  if (typeof s !== "string" || !s.startsWith(JD_REF_PREFIX)) return false;
  const name = s.slice(JD_REF_PREFIX.length);
  return SAFE_FILENAME.test(name) && !name.includes("..");
}

/**
 * The repo-relative path a reference points at, or "" when it is not one.
 * Always forward-slashed: it is used both in prompts and in `path.join(root, …)`,
 * and that form is accepted on every platform.
 *
 * @param {string} ref
 * @returns {string}
 */
export function jdRefPath(ref) {
  return isJdRef(ref) ? `jds/${ref.slice(JD_REF_PREFIX.length)}` : "";
}

/**
 * Validate the text before it is written or evaluated.
 *
 * Returns a user-facing message (no em dashes, AGENTS.md house rule) rather than
 * throwing, because every caller turns it into a 400 or an inline hint.
 *
 * @param {unknown} text
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function validateJdText(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { ok: false, error: "Paste the job description first." };
  if (t.length < MIN_JD_CHARS) {
    return { ok: false, error: `That is only ${t.length} characters. Paste the whole posting, not just the title.` };
  }
  if (t.length > MAX_JD_CHARS) {
    return { ok: false, error: "That job description is too long to store. Paste the posting itself, not the whole careers page." };
  }
  return { ok: true, text: t };
}
