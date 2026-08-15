/**
 * run-prompts.mjs — the prompts /api/run sends each worker kind (#2185).
 *
 * The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
 * kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
 * artifacts (A–F report + tracker row) via the SAME scripts the CLI uses
 * (reserve-report-num.mjs → reports/ → batch/tracker-additions/ → merge-tracker.mjs),
 * so a web evaluation is byte-identical to a CLI one (single source of truth, no
 * drift). kind "research" stays read-only.
 */
import { CV_ENVELOPE_INSTRUCTION } from "./cv-envelope.mjs";

/**
 * Is this company name safe to interpolate into a shell command inside a prompt?
 *
 * The fix-portal prompt tells the agent to run
 * `node verify-portals.mjs --add "<company>"`, and fix-portal is one of the kinds
 * that still holds Bash. Company names are not always the user's own typing — they
 * reach the dashboard from public ATS listings — so a crafted one could close the
 * quote and append a command. Allow the characters real company names use and
 * refuse the rest. The caller turns a refusal into a 400 rather than sanitizing,
 * because a silently rewritten name would resolve the wrong portal.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isShellSafeCompanyName(name) {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 80
    && SAFE_COMPANY_NAME.test(name)
    // A single & is needed (AT&T, Marks & Spencer); && is a command separator and
    // appears in no real company name. Every other chaining character — ; | $ `
    // quotes, newline — is already outside the character class.
    && !name.includes("&&");
}

const SAFE_COMPANY_NAME = /^[\p{L}\p{N} .,&'()+/-]+$/u;

/**
 * The exact prompt each worker kind is sent.
 *
 * Lives in a plain .mjs so it can be asserted on as a VALUE: the pdf prompt is
 * the load-bearing half of #2185 (it is what tells the agent to emit the CV
 * inline instead of writing it), and a guard that greps route.ts for the marker
 * text matched the route's own comments instead. See test-all.mjs §55.6.
 *
 * @param {{kind: string, input: string, memory: string, today: string}} args
 * @returns {string}
 */
/** ISO calendar date, the only form the dashboard's POSTED column parses. */
const ISO_DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;

export function buildPrompt({ kind, input, memory, today, postedAt }) {
  const mem = memory.trim() ? `\n\nDurable notes about the user (from their profile):\n${memory.trim()}\n` : "";
  if (kind === "research") {
    return `You are investigating the user's OWN work / portfolio to surface job-search-relevant strengths, headless. Investigate the target (use WebFetch for URLs; read local files if referenced) and report: what it is, why it is impressive, and how to leverage it in their job search — which roles/claims it supports and how to frame it on a CV. Be specific, honest, and encouraging. Report only: never submit, send, or click Apply anywhere, and contact no one — you are investigating the user's own work, not acting on it.${mem}

End with EXACTLY one final line: VERDICT: {0-5 signal strength}/5 — {why it helps their search, ≤12 words}

Target: ${input}`;
  }
  if (kind === "pdf") {
    // The agent tailors content only — it neither renders the PDF nor saves it.
    // Rendering moved to the backend because launching a real browser can hit a
    // sandbox escalation nobody is present to approve (#2172); SAVING moved for a
    // different reason (#2185): tool grants are tool-name-only, so the Write/Edit
    // this step used to need was unscoped, and a prompt injection in the posting
    // or the report — both of which land in this agent's context — could aim it at
    // cv.md or data/applications.md. The agent now emits the CV inline and the
    // backend (a plain Node process, no CLI sandbox) writes and renders it, so
    // pdf mode runs with no write tool at all.
    return `You are tailoring the user's ATS-optimized CV for application #${input}, headless, on their machine. Run the REAL career-ops "pdf" mode's CONTENT step: follow modes/pdf.md's TAILORING rules exactly (do not improvise your own scoring or format). Apply its CONTENT rules — keyword injection, ordering, the competency grid, project selection, and its never-invent-a-skill rule. Its steps that shell out (the jd-skill-gap.mjs check, template resolution) and its build/save/render steps are NOT performed on web runs; the platform handles output itself.
1. Read modes/pdf.md, cv.md, config/profile.yml, and the evaluation report at reports/${input}-*.md (for the JD keywords + analysis).
2. Tailor the CV per modes/pdf.md: inject the JD's keywords into the summary + first bullets, reorder experience by relevance, build the competency grid, pick the top 3–4 projects. NEVER invent skills — only reword REAL experience using the JD's vocabulary.
3. Fill templates/cv-template.html's {{...}} placeholders with the tailored content. Use that template even though modes/pdf.md resolves one via cv-templates.mjs: web runs always use the base template. ${CV_ENVELOPE_INSTRUCTION}
4. Emit the envelope EXACTLY ONCE. The platform writes the HTML, renders the PDF, and updates the tracker's PDF column itself, only after a confirmed successful render. Do not submit anything anywhere.

After the envelope, end with EXACTLY one final line: VERDICT: {5 if the complete HTML envelope was emitted, else 1}/5 — {a one-line summary, ≤12 words}`;
  }
  if (kind === "fix-portal") {
    return `A company's job-portal ATS slug is BROKEN — career-ops can no longer scan it, so it silently disappears from every future scan. Repair it (headless, on the user's machine):
1. Run \`node verify-portals.mjs --add "${input}"\` — it probes Greenhouse/Ashby/Lever for the company's correct ATS slug and prints the suggested ats + slug.
2. Open portals.yml, find the "${input}" entry under tracked_companies, and update its careers_url (and any api/slug field) to the suggested WORKING ATS URL. Change ONLY this one company; preserve all other YAML structure, comments and formatting exactly.
3. Re-run \`node verify-portals.mjs\` and confirm "${input}" now shows ✅ live (not ❌).
If NO slug variant resolves, say so clearly and leave portals.yml unchanged. Never touch any other company. This is a config repair: do not submit, send, or click Apply anywhere, and edit no file other than portals.yml.

End with EXACTLY one final line: VERDICT: {5 if now live, else 1}/5 — {what you changed, ≤12 words}`;
  }
  // The posting date is INTERPOLATED, not asked for. The scanner wrote it into
  // pipeline.md from the provider's own `offer.postedAt`; the server already has
  // it (readScanDates/readInbox) and passes it here, so the agent copies a value
  // rather than deriving one. modes/oferta.md is explicit that a guessed date is
  // worse than none — the dashboard's POSTED column renders an absent date as
  // `—`, and an invented one reports a months-old req as fresh.
  //
  // Canonical form, taken from the regex that CONSUMES it (dashboard's
  // rePostedOn) rather than from prose: its own trailing segment after `; `,
  // anchored to a separator, ISO `YYYY-MM-DD`. Mid-sentence mentions are
  // deliberately not metadata there, so this must be a segment or nothing.
  //
  // Absent → the empty string, so the row is byte-identical to today's. Same
  // reason the url field is always written but may be empty: the shape an agent
  // reliably follows is one unconditional template, and here the CONTENT is
  // conditional precisely because "write nothing" is the required behaviour.
  const postedSegment = ISO_DATE_RE.test(String(postedAt ?? "")) ? `; posted: ${postedAt}` : "";

  // evaluate (default) — run the REAL oferta mode + persist canonically
  //
  // The TSV row carries 10 fields, the 10th being the posting URL that
  // merge-tracker dedupes on (#1298). The web is a WRITER of that file, not only
  // a reader: emitting 9 fields stays valid forever, so nothing would ever go
  // red — every job evaluated from the web would simply sit outside the
  // URL dedup. Compatible and half-dead at once, which is the failure mode with
  // no symptom.
  //
  // ALWAYS 10 fields, empty when there is no URL, deliberately: an
  // unconditional template is one an agent follows, "emit 9 or 10 depending"
  // is one it sometimes forgets. Empty and absent are byte-identical in the
  // written row (verified against merge-tracker), so the robust instruction
  // costs nothing. Not "N/A" either — parseTsvExtras drops placeholders
  // precisely so they can't be misread as the row's LOCATION.
  return `You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Today is ${today}. Run the REAL career-ops evaluation — do NOT improvise your own scoring.

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: read cv.md, config/profile.yml and modes/_profile.md. Use WebFetch to read the posting (you are headless — Playwright is unavailable, so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").

2. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:
   a. Reserve a report number: run \`node reserve-report-num.mjs\` — its stdout is a 3-digit number (e.g. 035).
   b. Write the full report to reports/{num}-{company-slug}-${today}.md  (company-slug = company lowercased, non-alphanumerics → hyphens).
   c. Append ONE row of 10 TAB-separated columns to batch/tracker-additions/{num}-{company-slug}.tsv, in THIS exact order (real \\t tabs, status BEFORE score). ALWAYS write all 10 fields — leave the last one EMPTY if there is no posting URL, never "N/A" or "-":
      {num}\t${today}\t{Company}\t{Role}\t{CanonicalStatus e.g. Evaluated}\t{score}/5\t❌\t[{num}](reports/{num}-{company-slug}-${today}.md)\t{one-line note}${postedSegment}\t{posting URL, or empty}
   d. Merge into the tracker: run \`node merge-tracker.mjs\` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).

3. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.${mem}

After everything above is written and merged, output EXACTLY one final line, nothing after it:
VERDICT: {score}/5 — {reason in 12 words or fewer}

Posting URL: ${input}`;
}

