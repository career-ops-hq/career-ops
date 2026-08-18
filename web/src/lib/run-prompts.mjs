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

export function buildPrompt({ kind, input, memory, today, postedAt, lang }) {
  // AGENTS.md "Output Language vs Market Modes" composition rule: language.output
  // governs prose, language.modes_dir only supplies market vocabulary/context. The
  // CLI picks this up interactively by reading AGENTS.md + profile.yml itself, but
  // this route hands the agent a single one-shot prompt — so the directive (and,
  // for "evaluate", the market-specific mode FILE) must be injected explicitly or
  // a configured market mode silently does nothing in a web-triggered run. `lang`
  // is optional (readLanguageConfig() touches the filesystem, so callers that
  // can't/don't provide it — e.g. a future test — get the English/global default
  // rather than this module reaching for fs itself).
  const resolvedLang = lang ?? { output: "en", modesDir: "modes", evalModeFile: "modes/oferta.md" };
  const marketNote =
    resolvedLang.modesDir !== "modes"
      ? ` Also read ${resolvedLang.modesDir}/_shared.md for this market's vocabulary, benefits, and legal concepts, and keep those terms (explained in the output language) where relevant.`
      : "";
  const languageDirective = `\n\nWrite all human-facing output in "${resolvedLang.output}" regardless of the language of these instructions or the job description.${marketNote}\n`;
  // Every file path given below is already exact — some agent CLIs default to a
  // cautious "look around first" habit (list directories, run a find/grep)
  // before reading a named file, which is pure wasted latency here since the
  // path never needed discovering. Cheap to state, and it's the one lever
  // available regardless of which CLI backend the run is spawned through.
  const noSearchDirective = `\n\nEvery file path given in these instructions is already exact except the one \`*\` wildcard (the report filename, whose date/slug suffix is genuinely unknown) — read exact paths directly and resolve the wildcarded one with a single targeted glob. Do not otherwise search, list directories, or explore the workspace "to be safe"; that only adds latency for no benefit.\n`;
  const mem = (memory.trim() ? `\n\nDurable notes about the user (from their profile):\n${memory.trim()}\n` : "") + languageDirective + noSearchDirective;
  // The evaluate/pdf/research report formats are long BY DESIGN (that's the
  // actual deliverable) — this directive is scoped only to the assistant-
  // drafted-message kinds below, where the failure mode is the opposite:
  // echoing back the mode file's own authoring framework (sentence-by-sentence
  // breakdowns, restated reasoning) instead of just the usable result.
  const concise = " Be concise: give the answer, not a writeup of how you got there — no restating your own methodology, no repeating the same content in two different formats.";
  if (kind === "contacto") {
    return `You are running the career-ops "contacto" mode, headless, on the user's own machine, for application #${input}. Follow modes/contacto.md's persona logic (LinkedIn power move variant, unless the report context clearly calls for the Greeting variant) — but the OUTPUT must stay lean and directly usable, not a methodology writeup.

1. Read modes/contacto.md, cv.md, config/profile.yml, and the evaluation report at reports/${input}-*.md for company/role context.
2. SPEED MATTERS — this only needs to end with ONE well-chosen primary target, not a full roster, so don't search like it does. Try the hiring manager/team lead first (usually the strongest primary at this stage) with 1-2 targeted WebSearch calls; only search for a recruiter or peer as a fallback if that comes up empty. Stop searching the moment you have ONE confirmed, useful target — do not keep searching to round out a complete list nobody asked for. 3 WebSearch calls total is a hard ceiling; best-effort and no login, so state plainly when a target can't be confirmed instead of guessing a name.
3. Per modes/contacto.md's own selection step, pick ONE primary target (whoever benefits most from this candidate) and write their FULL ready-to-send message.
4. List any other genuinely viable targets as ONE line each (name/role + the single reason to reach them) — do NOT draft a full message or sentence-by-sentence breakdown for every contact type found; that is authoring guidance for you, not something to echo back to the user.
5. Enforce modes/contacto.md's Message rules strictly — this is the part people actually notice: no "Saw the [role] at [company]" opener (the single most recognizable mass-outreach tell), no resume-bullet phrasing pasted mid-sentence, vary the sentence rhythm instead of three uniform robotic sentences, and end on a genuine question the recipient can answer in one line — not a flat "happy to share my CV" statement that gives them nothing to react to.

OUTPUT FORMAT — keep it to exactly this, nothing more:
- Primary target: name, role, one-line why them.
- The message itself, ready to copy-paste as-is, then its character count against the platform limit.
- Other targets worth trying, one line each (omit this line entirely if there's only one real target).${mem}${concise}

This is DRAFT-ONLY: do NOT write to data/contacts.tsv or any other file, do NOT send, submit, connect, or open anything.

End with EXACTLY one final line: VERDICT: {0-5 confidence you found a real, useful contact}/5 — {who to message first, ≤12 words}`;
  }
  if (kind === "deep") {
    return `You are running the career-ops "deep" mode, headless, on the user's own machine, for application #${input}. modes/deep.md defines 6 research axes — ACTUALLY RESEARCH and ANSWER them yourself using WebSearch/WebFetch; do not just emit a prompt for another tool to run later.

1. Read modes/deep.md, cv.md, config/profile.yml, and the evaluation report at reports/${input}-*.md for company/role context.
2. Research and answer all 6 axes (AI Strategy, Recent moves, Engineering culture, Likely challenges, Competitors & differentiation, Candidate angle) with SPECIFIC, current findings. If something can't be found, say so plainly rather than inventing it.
3. Ground axis 6 (Candidate angle) ONLY in real experience already present in cv.md/config/profile.yml — never fabricate a claim.${mem}${concise}

End with EXACTLY one final line: VERDICT: {0-5 how much this changes interview prep}/5 — {the single sharpest insight, ≤12 words}`;
  }
  if (kind === "cover") {
    return `You are running the career-ops "cover" mode, headless, on the user's own machine, for application #${input}. Follow modes/cover.md's structure and rules, but SKIP its interactive confirmation checkpoints (Step 3 research sync, Step 4 keyword list, Step 5 gap conversation) since no one is present to answer them — proceed with your own best-effort synthesis/defaults instead, and flag any assumption or unresolved gap in a short "Assumptions" line right before the letter.

1. Read modes/cover.md, modes/_writing.md, cv.md, config/profile.yml, modes/_profile.md (if present), article-digest.md (if present), and the evaluation report at reports/${input}-*.md for JD + company context.
2. Run the Step 3 company research (3 WebSearch queries) and synthesize 2-3 sentences.
3. Extract JD keywords (Step 4) and mirror them per the rules — never invent skills, only reword real experience already in cv.md.
4. Draft the full cover letter per modes/cover.md's template, length, and tone rules.${mem}${concise}

This is DRAFT-ONLY: do not write any file, do not send or submit anything.

End with EXACTLY one final line: VERDICT: {0-5 how ready-to-send this draft is}/5 — {one thing worth double-checking, ≤12 words}`;
  }
  if (kind === "email") {
    return `You are running the career-ops "email" mode, headless, on the user's own machine, for application #${input} — draft ONLY the standard application email variant (not "stuck" or "noshow").

1. Read modes/email.md, modes/_writing.md, cv.md, config/profile.yml, modes/_profile.md (if present), modes/_custom.md (if present), voice-dna.md (if present), and the evaluation report at reports/${input}-*.md for company/role/PDF-status context.
2. Check data/pdf-index.tsv (or the report's PDF column) — if a tailored CV already exists, name it as the attachment; otherwise say the CV needs generating first (via "Generate tailored CV") or attaching manually.
3. Draft the subject line, email body, a short attachment checklist, and a contact block, per modes/email.md's structure.${mem}${concise}

This is DRAFT-ONLY: never send, never submit, never click send.

End with EXACTLY one final line: VERDICT: {0-5 how ready-to-send this draft is}/5 — {one thing worth double-checking, ≤12 words}`;
  }
  if (kind === "training") {
    return `You are running the career-ops "training" mode, headless, on the user's own machine, evaluating a course or certification for their job search. Follow modes/training.md's 6-dimension framework EXACTLY (North Star alignment, Recruiter signal, Time and effort, Opportunity cost, Risks, Portfolio deliverable) and give exactly one of its three verdicts (DO / DON'T DO / DO WITH TIMEBOX).

1. Read modes/training.md, cv.md, config/profile.yml, and modes/_profile.md (if present) to ground this in the user's actual target roles, timeline, and existing skills.
2. If the input below is a URL, use WebFetch to read the course page; otherwise treat it as a course/cert name and use WebSearch to find its syllabus, provider reputation, and typical time commitment.
3. Score all 6 dimensions with a short justification each, then give ONE clear verdict: a 4-12 week plan with weekly deliverables (DO), a condensed essentials-only plan with a max-week cap (DO WITH TIMEBOX), or a better alternative with justification (DON'T DO).${mem}${concise}

This is evaluation only — do not enroll, purchase, or submit anything.

End with EXACTLY one final line: VERDICT: {0-5 how worth doing this is}/5 — {DO / DON'T DO / DO WITH TIMEBOX, ≤12 words}

Course/certification to evaluate: ${input}`;
  }
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

1. Read ${resolvedLang.evalModeFile} — the market-appropriate evaluation mode resolved from config/profile.yml's language.modes_dir — and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary; if this file uses different block letters/labels than the default modes/oferta.md, keep ITS labels, don't force English ones). Ground the fit in THIS person: read cv.md, config/profile.yml and modes/_profile.md. Use WebFetch to read the posting (you are headless — Playwright is unavailable, so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").

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

