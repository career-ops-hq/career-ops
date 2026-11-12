#!/usr/bin/env node
/**
 * generate-cover-letter.mjs — Renders a cover letter payload to PDF.
 *
 * Usage:
 *   node generate-cover-letter.mjs --payload payload.json
 *   node generate-cover-letter.mjs --payload payload.json --out output/slug-cover.pdf
 *
 * Fills templates/cover-letter-template.html with the payload, then renders
 * it to PDF via the same Playwright pipeline used for CVs (generate-pdf.mjs).
 *
 * `buildHtml` and `safeOutputPath` are exported as pure functions so the
 * template and --out path guard can be tested without loading Playwright
 * (renderHtmlToPdf is imported lazily inside main).
 */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, join, relative, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { assertFacts, newFactWarnings, printFactWarnings } from "./verify-cv-facts.mjs";
import { resolveTemplate } from "./cv-templates.mjs";
import { isMainModule } from "./lib/is-main-module.mjs";
import { PAGE_FORMATS, normalizePageFormat, pageFormatForCountry } from "./lib/page-format.mjs";
import { getCareerOpsRoot } from "./path-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// output/ is a USER-layer directory. Anchoring it to the script directory made
// the cover letter unwritable under an external data directory: this module
// insisted on <checkout>/output while the shared PDF guard in generate-pdf.mjs
// required the tracker workspace, and the two could not both be satisfied.
// getCareerOpsRoot() returns the checkout when no external root is configured,
// so the default install is unchanged.
const OUTPUT_ROOT = resolve(getCareerOpsRoot(), "output");

/**
 * Resolve a requested cover-letter output path.
 *
 * Paths that stay inside `output/` keep their relative subdirectory (the
 * application-bundle layout `generate-pdf.mjs` already supports). Paths that
 * would escape `output/` — `..` traversal or an absolute path outside it —
 * are rejected instead of being silently flattened to `output/<basename>`.
 *
 * @param {string} raw - Caller-supplied --out / payload.output_path value.
 * @returns {string} Absolute path inside OUTPUT_ROOT.
 */
export function safeOutputPath(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new Error("Refusing to write the cover letter outside output/: (empty path)");
  }
  const trimmed = String(raw).trim();

  const asWritten = resolve(trimmed);
  if (containedInOutput(asWritten)) return asWritten;

  // Absolute paths and any `..` segment already chose a location; if that
  // location is not inside output/, refuse instead of rewriting to a basename.
  if (isAbsolute(trimmed) || /(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    throw new Error(`Refusing to write the cover letter outside output/: ${raw}`);
  }

  // Bare filename or a relative path that is not already under output/
  // (e.g. --out cover.pdf, or --out output/foo/bar.pdf from another cwd).
  const posix = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  const relativeToRoot = posix === "output" || posix === "output/"
    ? ""
    : posix.startsWith("output/")
      ? posix.slice("output/".length)
      : posix;
  const candidate = resolve(OUTPUT_ROOT, relativeToRoot);
  if (containedInOutput(candidate)) return candidate;

  throw new Error(`Refusing to write the cover letter outside output/: ${raw}`);
}

/** True when absPath is a file (not output/ itself) still inside OUTPUT_ROOT. */
function containedInOutput(absPath) {
  const rel = relative(OUTPUT_ROOT, absPath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Assert that a payload object contains the required keys and that their values are non-empty strings. */
function _require(obj, keys, context) {
  for (const key of keys) {
    const value = obj && typeof obj === "object" ? obj[key] : undefined;
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Missing required field: ${context}.${key}`);
    }
  }
}

/** Assert that a payload contains the required object-shaped fields. */
function _requireObject(obj, keys, context) {
  for (const key of keys) {
    if (!obj || typeof obj !== "object" || !(key in obj) || typeof obj[key] !== "object" || obj[key] === null) {
      throw new Error(`Missing required field: ${context}.${key}`);
    }
  }
}

/** Escape user-provided text before inserting it into generated HTML. */
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Add an HTTPS scheme to a profile URL when it is omitted. */
function asUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Build the escaped contact line shown in the cover-letter header. */
function buildContactLine(candidate) {
  const parts = [];
  if (candidate.location) parts.push(escapeHtml(candidate.location));
  if (candidate.email) {
    const email = escapeHtml(candidate.email);
    parts.push(`<a href="mailto:${email}">${email}</a>`);
  }
  if (candidate.phone) parts.push(escapeHtml(candidate.phone));
  if (candidate.linkedin) {
    const display = candidate.linkedin.replace(/^https?:\/\//i, "");
    parts.push(`<a href="${escapeHtml(asUrl(candidate.linkedin))}">${escapeHtml(display)}</a>`);
  }
  if (candidate.github) {
    const display = candidate.github.replace(/^https?:\/\//i, "");
    parts.push(`<a href="${escapeHtml(asUrl(candidate.github))}">${escapeHtml(display)}</a>`);
  }
  return parts.join(" &nbsp;|&nbsp; ");
}

/** Build the optional credentials line from the candidate payload. */
function buildCredentialsBlock(candidate) {
  const credentials = candidate.credentials || [];
  if (!credentials.length) return "";
  return `<div class="credentials">${credentials.map(escapeHtml).join(" &nbsp;|&nbsp; ")}</div>`;
}

/** Build the escaped company, city, and date line for the letter. */
function buildDateline(letter, hasRecipientBlock = false) {
  // The pack contract gives {{DATELINE}} the date and leaves the company and
  // city to the address block directly beneath it, so joining all three prints
  // the company twice, three lines apart.
  //
  // Gated on the block actually RENDERING, not on `letter.recipient` merely
  // being set — see the caller, which needs both the data and a template slot
  // to conclude that. An empty or whitespace-only recipient produces no address
  // block, and a template without a {{RECIPIENT_BLOCK}} slot has nowhere to put
  // one; either way, dropping company and city would lose them with nothing
  // taking their place. The shipped base template is the second case, so it
  // keeps the full join exactly as before.
  const company = typeof letter.company === "string" ? letter.company : "";
  const parts = hasRecipientBlock
    ? [letter.date]
    : [company, letter.city, letter.date];
  return parts.filter(Boolean).map(escapeHtml).join(" &nbsp;&nbsp; ");
}

/**
 * Build the optional recipient address block for a business letter.
 *
 * The pack authoring contract places {{RECIPIENT_BLOCK}} bare and expects the
 * filler to emit its own wrapper, so this returns a complete
 * `<div class="recipient">` or an empty string, never a bare fragment. Each
 * line is its own `<div>` rather than a `<br>` join, which is what the packs'
 * own CSS targets.
 *
 * A partial recipient is normal and renders as far as it goes: a company with
 * no named individual, or a name with no street address, are both ordinary
 * states for a cover letter. Only a recipient with nothing usable in it (blank or whitespace-only fields included), or no
 * recipient at all, yields the empty string, so a letter without an addressee
 * still renders instead of failing.
 *
 * Accepts `address_lines` (array, the contract's shape) or `address` (string).
 */
function buildRecipientBlock(letter) {
  const r = letter.recipient;
  if (!r || typeof r !== "object") return "";
  const addressLines = Array.isArray(r.address_lines)
    ? r.address_lines
    : r.address
      ? [r.address]
      : [];
  // Trim before filtering: `filter(Boolean)` alone keeps "   ", which renders as
  // a blank line inside the wrapper rather than as the absent field it is.
  // Falsy first, so 0 / "" / null drop out as they always have, THEN coerce.
  // Coercing first would turn 0 into the string "0" and keep it as an address
  // line; leaving a truthy non-string uncoerced crashes the compare below.
  const lines = [r.name, r.title, r.company, ...addressLines]
    .filter(Boolean)
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (!lines.length) return "";

  // Once this block renders, the dateline drops the company and city, so they
  // have to land here or they leave the letter entirely. A recipient given as a
  // bare name is the case that exposed it: the block held one line, the dateline
  // went date-only, and both values were simply gone from the output.
  //
  // Appended only when the recipient did not already supply them, compared
  // case-insensitively against every line including the address, so a recipient
  // that names its own company keeps exactly one copy.
  // Compared by comma-delimited component, not by whole line. An address line
  // is routinely "123 Main St, Boston, MA" while letter.city is "Boston, MA":
  // the lines differ, so a whole-line compare appends the city a second time,
  // which is the duplication this whole change exists to stop.
  // A trailing US ZIP is stripped from the LAST component only. "Boston, MA
  // 02101" and the city "Boston, MA" otherwise differ in that component and the
  // city gets appended a second time, and an address carrying a ZIP is the
  // ordinary case rather than an edge one. Confined to the final component and
  // to a recognisable ZIP shape, so a street number cannot be eaten; formats
  // this cannot recognise simply keep today's behaviour.
  const components = (v) => {
    const parts = String(v)
      .split(",")
      .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (parts.length) {
      const last = parts[parts.length - 1].replace(/\s+\d{5}(?:-\d{4})?$/, "").trim();
      if (last) parts[parts.length - 1] = last;
    }
    return parts;
  };

  /** Does `hay` contain `needle` as a contiguous run of components? */
  const containsRun = (hay, needle) => {
    if (!needle.length || needle.length > hay.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) {
      if (needle.every((n, j) => hay[i + j] === n)) return true;
    }
    return false;
  };

  // Where each one belongs differs, so they are not both appended. A company
  // goes straight after the recipient's name and title and ABOVE the street
  // address; pushing it to the end put it below the street, which is not an
  // address block (#4069 review). The city stays last, where it already sat.
  // `lines` starts as name, title, company, then the address lines, all through
  // the same filters, so the first `headCount` entries are exactly that head.
  const headCount = [r.name, r.title, r.company]
    .filter(Boolean)
    .map((v) => String(v).trim())
    .filter(Boolean).length;
  for (const [extra, insertAt] of [[letter.company, headCount], [letter.city, null]]) {
    const v = typeof extra === "string" ? extra.trim() : "";
    if (!v) continue;
    const want = components(v);
    if (lines.some((l) => containsRun(components(l), want))) continue;
    if (insertAt === null) lines.push(v);
    else lines.splice(insertAt, 0, v);
  }

  const escaped = lines.map(escapeHtml);
  return `<div class="recipient">\n${escaped.map((l) => `    <div>${l}</div>`).join("\n")}\n  </div>`;
}


/** Build the optional achievements list for the letter body. */
function buildAchievementsBlock(achievements) {
  if (!achievements || !achievements.length) return "";
  const items = achievements.map(ach => {
    // Trim a caller-supplied trailing comma (cover.md's own bullet-format
    // example shows the lead ending in a comma) so it never doubles up with
    // the comma this function always appends.
    const lead = escapeHtml((ach.lead || "").replace(/,\s*$/, ""));
    const impact = escapeHtml(ach.impact || "");
    return `    <li><b>${lead},</b> ${impact}</li>`;
  }).join("\n");
  return `<ul class="achievements">\n${items}\n  </ul>`;
}

/** Build the optional footnotes block with escaped links. */
function buildFootnotesBlock(footnotes) {
  if (!footnotes || !footnotes.length) return "";
  const lines = footnotes.map(fn => {
    if (typeof fn === "object" && fn !== null) {
      const marker = escapeHtml(fn.marker || "");
      const text = escapeHtml(fn.text || "");
      const url = fn.url
        ? ` <a href="${escapeHtml(fn.url)}">${escapeHtml(fn.url)}</a>`
        : "";
      return `    <p>${marker} ${text}${url}</p>`;
    }
    return `    <p>${escapeHtml(fn)}</p>`;
  }).join("\n");
  return `<div class="footnotes">\n${lines}\n  </div>`;
}

/**
 * Build the optional sign-off block: a valediction over the signing name.
 *
 * Accepts either a plain string (used verbatim as the valediction) or an
 * object `{ valediction, name }`. `name` defaults to the candidate name so a
 * payload can set only the valediction. Returns "" when unset, which keeps
 * every pre-existing payload rendering byte-identical.
 */
function buildSignatureBlock(signature, candidateName) {
  if (!signature) return "";
  const isObject = typeof signature === "object" && signature !== null;
  const valediction = isObject ? signature.valediction : signature;
  const name = (isObject ? signature.name : "") || candidateName || "";
  if (!valediction && !name) return "";
  // Each value is escaped independently; the <br> separator is template markup
  // emitted between them, never injected into escaped content.
  const lines = [valediction, name].filter(Boolean).map(escapeHtml);
  return `<p class="signature">${lines.join("<br>")}</p>`;
}

// Resolve the cover-letter template through the shared resolver so a
// `cover_letter.template` profile default, an explicit `payload.template`, and
// installed template packs are all honored. With nothing configured the
// resolver returns the base template (its default name is `standard`).
//
// Resolver errors propagate (#6370). This used to pass `fallback: true` and
// catch everything, returning the base template, so a malformed
// config/profile.yml, a template name that does not exist, or a template
// missing required placeholders all rendered a plain letter with no warning:
// the candidate's letterhead, signature or layout silently dropped. That
// contradicts modes/cover.md Step 8 and `cv-templates.mjs resolve cover`,
// which both surface the error. main() already prints a buildHtml error and
// exits 1. A caller can still pass `{ fallback: true }` in opts, but that only
// covers a template NAME that does not exist (it then resolves `standard`). A
// malformed profile or an invalid template is an error either way: falling
// back over those is exactly the silent substitution this function stopped
// doing.
export function resolveCoverTemplatePath(payload = {}, opts = {}) {
  return resolveTemplate("cover", payload.template, { format: "html", strict: true, ...opts });
}

/**
 * Replace every balanced `{{ … }}` token in `text` in a single pass.
 *
 * Depth-aware: `{{` opens a level and `}}` closes one, and a token is the span
 * from an opening `{{` to the `}}` that brings the depth back to zero. So
 * `{{ outer {{ inner }} }}` is ONE token, not `{{ outer {{ inner }}` followed by
 * a stray ` }}`. Single braces (`({})`) do not count.
 *
 * An opening `{{` that is never closed is left as literal text and the scan
 * continues just after it. Giving up there instead would leave every later
 * token in the template unfilled and unreported, which is worse than what a
 * regex did.
 *
 * Each token is replaced by `replaceToken(token)`, and the result is never
 * re-scanned, so a substituted value that contains `{{…}}` stays literal.
 *
 * @param {string} text
 * @param {(token: string) => string} replaceToken
 * @returns {string}
 */
export function replaceBalancedTokens(text, replaceToken) {
  let out = "";
  let emitted = 0;
  let searchFrom = 0;
  while (true) {
    const start = text.indexOf("{{", searchFrom);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length - 1; ) {
      if (text[i] === "{" && text[i + 1] === "{") {
        depth++;
        i += 2;
      } else if (text[i] === "}" && text[i + 1] === "}") {
        depth--;
        i += 2;
        if (depth === 0) {
          end = i;
          break;
        }
      } else {
        i++;
      }
    }
    if (end === -1) {
      // Unterminated: keep this `{{` literal and look for the next one.
      searchFrom = start + 2;
      continue;
    }
    out += text.slice(emitted, start) + replaceToken(text.slice(start, end));
    emitted = end;
    searchFrom = end;
  }
  return out + text.slice(emitted);
}

export function buildHtml(payload, templatePath) {
  _requireObject(payload, ["candidate", "letter"], "payload");
  const candidate = payload.candidate;
  const letter = payload.letter;
  _require(candidate, ["name"], "candidate");
  _require(letter, ["role_title", "opening", "profile_intro"], "letter");

  const resolvedPath = templatePath || resolveCoverTemplatePath(payload);
  let html = readFileSync(resolvedPath, "utf-8");

  // Optional salutation (e.g. "Dear Jane Smith,"). Omitted -> no salutation,
  // preserving the original behavior for payloads that don't set it.
  const greetingBlock = letter.greeting ? `<p class="greeting">${escapeHtml(letter.greeting)}</p>` : "";
  const closingBlock = letter.closing ? `<p>${escapeHtml(letter.closing)}</p>` : "";
  const languageClosingBlock = letter.language_closing
    ? `<p class="language-closing">${escapeHtml(letter.language_closing)}</p>`
    : "";
  const problemsBlock = letter.problems_section ? `<p>${escapeHtml(letter.problems_section)}</p>` : "";

  // Optional sign-off (e.g. valediction "Sincerely," over the signing name).
  // Omitted -> no signature, preserving behavior for payloads that don't set it.
  // The name falls back to the candidate name so a payload can set only the
  // valediction. The <br> is emitted around escaped values, never inside one.
  const signatureBlock = buildSignatureBlock(letter.signature, candidate.name);

  const recipientBlock = buildRecipientBlock(letter);
  // The gate's predicate is "the address block will RENDER", which needs both
  // halves: recipient data to put in it, and a slot in the loaded template to
  // put it in. The shipped base template has {{DATELINE}} and no
  // {{RECIPIENT_BLOCK}}, so a payload carrying a recipient would otherwise lose
  // the company and city entirely — dropped from the dateline, with no address
  // block downstream to reprint them.
  const rendersRecipientBlock = Boolean(recipientBlock) && html.includes("{{RECIPIENT_BLOCK}}");
  const replacements = {
    "{{NAME}}": escapeHtml(candidate.name),
    "{{CONTACT_LINE}}": buildContactLine(candidate),
    "{{CREDENTIALS_BLOCK}}": buildCredentialsBlock(candidate),
    "{{ROLE_TITLE}}": escapeHtml(letter.role_title),
    "{{DATELINE}}": buildDateline(letter, rendersRecipientBlock),
    "{{RECIPIENT_BLOCK}}": recipientBlock,
    "{{GREETING_BLOCK}}": greetingBlock,
    "{{OPENING}}": escapeHtml(letter.opening),
    "{{PROFILE_INTRO}}": escapeHtml(letter.profile_intro),
    "{{ACHIEVEMENTS_BLOCK}}": buildAchievementsBlock(letter.achievements),
    "{{PROBLEMS_BLOCK}}": problemsBlock,
    "{{CLOSING_BLOCK}}": closingBlock,
    "{{LANGUAGE_CLOSING_BLOCK}}": languageClosingBlock,
    "{{SIGNATURE_BLOCK}}": signatureBlock,
    "{{FOOTNOTES_BLOCK}}": buildFootnotesBlock(letter.footnotes),
  };

  // Single-pass substitution: each {{TOKEN}} is replaced exactly once against
  // the original template. A single regex pass (rather than iterative
  // split/join) ensures a substituted value that itself contains a {{TOKEN}}
  // sequence is left literal instead of being re-interpreted as a placeholder.
  //
  // A token with no entry in the map is a template the renderer cannot fill —
  // a custom cover-letter template (KINDS.cover in cv-templates.mjs) carrying a
  // typo'd or unsupported token. Collect those DURING the pass rather than
  // scanning the result: a scan of the output cannot tell a template token from
  // the same sequence appearing inside a substituted value, which is exactly
  // what the single pass above is careful to leave literal.
  //
  // The pass visits EVERY `{{…}}` sequence, not only `{{UPPER_SNAKE}}` ones.
  // Matching only the shape the map uses meant a lowercase, digit-bearing,
  // hyphenated or space-padded token (`{{role_title}}`, `{{OPENING2}}`,
  // `{{ COMPANY }}`) was never visited, so it was neither filled nor reported
  // and shipped verbatim in the PDF (#6374). Lookup stays exact on purpose:
  // `{{ COMPANY }}` is not `{{COMPANY}}`, and guessing would hide the typo.
  //
  // Tokens are found by balancing `{{` against `}}` (replaceBalancedTokens),
  // not by a regex, so a token that contains braces — `{{ config | default({}) }}`
  // — or another token — `{{ outer {{ inner }} }}` — is visited and reported
  // whole, rather than cut at the first `}}` it happens to contain.
  const unresolved = new Set();
  const rendered = replaceBalancedTokens(html, (token) => {
    const value = replacements[token];
    if (value == null) {
      unresolved.add(token);
      return token;
    }
    return value;
  });

  // Fail loudly, matching build-cv-html.mjs and build-cv-latex.mjs. Shipping a
  // letter with a literal {{TOKEN}} in it is worse than not producing one.
  if (unresolved.size) {
    throw new Error(`Unresolved placeholders: ${[...unresolved].join(', ')}`);
  }
  return rendered;
}

/**
 * Answers and other text the candidate supplied for this letter.
 *
 * Read `user_inputs` (the list cover mode writes) and `answers` (the same
 * texts as an object). Do not read `letter`: the draft is the document under
 * check, and a sentence that appears only there must not support itself.
 *
 * @param {object} [payload]
 * @returns {string[]}
 */
export function letterInputTexts(payload = {}) {
  return [...collectInputText(payload?.user_inputs), ...collectInputText(payload?.answers)];
}

function collectInputText(value) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectInputText);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectInputText);
  return [];
}

/** A cover letter is one page by convention; a CV's default budget is 2. */
export const DEFAULT_COVER_MAX_PAGES = 1;

/**
 * The writing check a CV gets, applied to a letter, as notes and never as a stop.
 *
 * generate-pdf.mjs refuses a CV that carries stock wording the candidate never
 * wrote ("spearheaded", "leveraged"). A letter went through the fact gate only,
 * so a draft could keep that wording and the long dashes cover mode bans, and
 * nothing said so. A letter is not refused here: it quotes the posting, and a
 * posting uses words a candidate would not choose. The notes name the words and
 * the PDF still builds.
 *
 * Wording is allowed when cv.md, voice-dna.md, cv-facts.json or the candidate's
 * own answers for this letter already use it. Read before the ATS pass, which
 * replaces long dashes and would hide them.
 *
 * @param {string} html - The letter's HTML before the ATS text pass.
 * @param {{root?: string, payload?: object}} [options]
 * @returns {Promise<string[]>} One note per kind of finding; empty when clean.
 */
export async function coverLetterVoiceNotes(html, { root = getCareerOpsRoot(), payload = {} } = {}) {
  const { voiceIssues, candidateOwnWords } = await import("./cv-voice.mjs");
  const cvPath = join(root, "cv.md");
  const cv = existsSync(cvPath) ? readFileSync(cvPath, "utf-8") : "";
  const ownWords = [cv, candidateOwnWords(root), ...letterInputTexts(payload)].join("\n");
  const issues = voiceIssues(html, ownWords);
  const notes = [];
  const phrases = [...new Set(issues.filter((issue) => issue.kind === "banned-phrase").map((issue) => issue.value))];
  if (phrases.length) {
    notes.push(
      `Voice check warning for cover letter: ${phrases.map((phrase) => `"${phrase}"`).join(", ")}. `
      + "That wording is not in your CV or your own words, and it reads as stock text. The PDF still builds.",
    );
  }
  const dashes = [...new Set(issues.filter((issue) => issue.kind === "em-dash").map((issue) => issue.value))];
  if (dashes.length) {
    notes.push(
      `Voice check warning for cover letter: ${dashes.map((dash) => `an ${dash}`).join(", ")}. `
      + "Cover mode bans long dashes. The PDF replaces them, but the draft and any text you paste elsewhere keep them.",
    );
  }
  return notes;
}

const USAGE = `
Usage:
  node generate-cover-letter.mjs --payload payload.json [--out output/path.pdf] [--format letter|a4] [--country XX] [--report NNN] [--max-pages N] [--strict-pages]

  --payload       Path to the JSON payload file (required)
  --out           Override output path from payload (optional)
  --format        Override output PDF page format (letter|a4). Defaults to
                  config/profile.yml page_format, then letter.
  --country       Employer's ISO 3166-1 country code (e.g. DE). Picks the sheet
                  only when page_format is "auto". Defaults to the payload's country.
  --report        Link the PDF to a tracker report number in data/pdf-index.tsv
  --max-pages     Preferred letter length in pages (default: ${DEFAULT_COVER_MAX_PAGES})
  --strict-pages  Fail instead of warning when the letter is longer than --max-pages
`;

/**
 * Parse and validate the CLI flags.
 *
 * Strict on purpose (#6373). With `strict: false` an unknown flag (a typo, or
 * --max-pages / --strict-pages, which this script did not declare) was dropped
 * without a word, and a string flag given no value swallowed the next flag:
 * `--report --out x.pdf` set report to "--out" and wrote the PDF to the
 * default path. Every case is now an error that names the flag.
 *
 * @param {string[]} argv
 * @returns {{ ok: true, args: object } | { ok: false, error: string }}
 */
export function parseCoverArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        payload:        { type: "string" },
        out:            { type: "string" },
        format:         { type: "string" },
        country:        { type: "string" },
        report:         { type: "string" },
        "max-pages":    { type: "string" },
        "strict-pages": { type: "boolean" },
        help:           { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (values.help) return { ok: true, args: values };

  // Supplied flags are validated like generate-pdf.mjs does. A typo that fell
  // through to the profile or the payload would print a letter on the wrong sheet.
  // `auto` is a profile or payload value, never a sheet, so --format rejects it.
  if (values.format !== undefined && !normalizePageFormat(values.format)) {
    return { ok: false, error: `Invalid format "${values.format}". Use: ${[...PAGE_FORMATS].join(", ")}` };
  }
  if (values.country !== undefined && !pageFormatForCountry(values.country)) {
    return { ok: false, error: `Invalid country "${values.country}". Use a two-letter ISO 3166-1 code, e.g. --country=DE.` };
  }
  // Checked as typed, not trimmed: `--report=' 42 '` is not a report number.
  if (values.report !== undefined && !/^\d+$/.test(values.report)) {
    return { ok: false, error: `Invalid --report "${values.report}". Use a numeric report number, e.g. --report=42.` };
  }
  // An empty --out= would otherwise be read as "not given" by main(), which
  // then writes to the payload's own destination: a flag the caller typed,
  // silently ignored.
  if (values.out !== undefined && values.out.trim() === "") {
    return { ok: false, error: 'Invalid --out "". Give a path inside output/, e.g. --out output/acme-cover.pdf.' };
  }
  const maxPagesInput = values["max-pages"];
  const maxPages = maxPagesInput === undefined ? DEFAULT_COVER_MAX_PAGES : Number(maxPagesInput);
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    return { ok: false, error: `Invalid --max-pages "${maxPagesInput}". Use a positive integer, e.g. --max-pages=1.` };
  }
  return {
    ok: true,
    args: {
      ...values,
      report: values.report,
      maxPages,
      strictPages: Boolean(values["strict-pages"]),
    },
  };
}

/** Parse a payload, run the fact gate, and render the cover-letter PDF. */
async function main() {
  const parsed = parseCoverArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exit(1);
  }
  const args = parsed.args;

  if (args.help || !args.payload) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const payloadPath = resolve(args.payload);
  if (!existsSync(payloadPath)) {
    console.error(`ERROR: payload file not found: ${payloadPath}`);
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(payloadPath, "utf-8"));

  if (args.out) {
    payload.output_path = args.out;
  }

  if (!payload.output_path) {
    const company = (typeof payload.letter?.company === "string" ? payload.letter.company : "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const role = (typeof payload.letter?.role_title === "string" ? payload.letter.role_title : "role")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 30);
    payload.output_path = join(OUTPUT_ROOT, `${company}-${role}-cover.pdf`);
  } else {
    try {
      payload.output_path = safeOutputPath(payload.output_path);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  if (!existsSync(OUTPUT_ROOT)) mkdirSync(OUTPUT_ROOT, { recursive: true });

  try {
    const html = buildHtml(payload);
    // Cover letters are candidate-facing documents too. Reuse the CV fact
    // validator before importing Playwright or writing a PDF so a failed gate
    // cannot leave behind a misleading artifact.
    const factOptions = {
      label: "cover letter",
      planTexts: letterInputTexts(payload),
    };
    const factCheck = assertFacts(html, factOptions);
    // Ahead of the verdict, because it qualifies it: with no config the phrase
    // lists are empty, so a silent gate here covers metrics and facts only.
    if (factCheck.configMissing) {
      console.error("No config/cv-facts.json — forbidden/advisory phrase checks did not run.");
    }
    if (factCheck.verdict === "warn") {
      console.error(`CV fact check warning: cover letter`);
      printFactWarnings(factCheck, console.error);
    }
    // The wording check a CV gets, as notes only: a note never stops the PDF.
    try {
      for (const note of await coverLetterVoiceNotes(html, { payload })) console.error(note);
    } catch (err) {
      console.error(`Voice check skipped: ${err.message}`);
    }
    // Imported only after fact validation so a failed gate does not load
    // Playwright or create a PDF artifact.
    const { normalizeTextForATS, reportAtsReplacements, renderHtmlToPdf } = await import("./generate-pdf.mjs");
    const outputPath = resolve(payload.output_path);
    // The pass a CV gets before it prints. Without it a letter kept its em
    // dashes and curly quotes, and printed a draft's **bold** with the asterisks.
    const { html: printed, replacements } = normalizeTextForATS(html);
    reportAtsReplacements(replacements, console.error);
    // As for a CV, the gate also reads the document that prints: the pass can
    // spell out a phrase the draft hid, as `self–starter` prints as
    // `self-starter`. A forbidden one stops here. Anything advisory is reported,
    // unless the check above already named it.
    const printedWarnings = newFactWarnings(factCheck, assertFacts(printed, factOptions));
    if (printedWarnings) {
      console.error(`CV fact check warning: cover letter`);
      printFactWarnings(printedWarnings, console.error);
    }
    const result = await renderHtmlToPdf(printed, outputPath, {
      // Passed through unresolved. renderHtmlToPdf ranks it against the user's
      // config/profile.yml, so a cover letter and its CV cannot end up on
      // different paper because only one of them carried a flag.
      format: args.format,
      country: args.country || payload.country,
      reportNum: args.report,
      maxPages: args.maxPages,
      strictPages: args.strictPages,
      // Declared, never inferred: this script always renders a cover letter, and
      // the manifest must not file it as the report's CV (#3887).
      kind: 'cover',
      inputPath: payloadPath,
    });
    // A render over a warn-only page budget returns the sibling draft it
    // wrote instead and leaves the output path as it was (#6377); saying the
    // PDF is there would hand over a file that was never written.
    if (result.draftPath) {
      console.log(`\nCover letter over its page budget: nothing was written to ${payload.output_path}; the draft is ${result.draftPath}. Trim and rerun.`);
    } else {
      console.log(`\nCover letter PDF: ${payload.output_path}`);
    }
  } catch (err) {
    console.error("ERROR generating cover letter PDF:");
    console.error(err.message);
    process.exit(1);
  }
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
