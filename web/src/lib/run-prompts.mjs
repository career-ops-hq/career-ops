// run-prompts.mjs — headless worker prompts for /api/run.
// Object-signature buildPrompt({kind, input, memory, today, reportNum}) so the
// route and tracker-columns-tests share one emitter. The evaluate prompt's TSV
// example is an emitter of the batch/tracker-additions format (#3517): header
// labels must resolve through tracker-aliases.json, and only those two lines
// may contain tab characters.

import { CV_ENVELOPE_INSTRUCTION } from "./cv-envelope.mjs";

/**
 * @param {{kind: string, input: string, memory?: string, today?: string, reportNum?: string,
 *          cliId?: string, hasPlaywright?: boolean, jevPrior?: object|null,
 *          jevCompile?: {slotsPath: string, facts: string}|null}} opts
 * @returns {string}
 * When `jevCompile` is set for kind "evaluate", the prompt is the Envelope B
 * variant: the worker reads modes/oferta.md for Blocks A-F + G scoring intent,
 * writes ONLY its free-text slots to `slotsPath`, leaves the
 * `<!-- machine-summary-slot -->` marker in the report, and the host composes
 * the Machine Summary from System One decisions + those slots afterwards.
 * Without it the legacy prompt is emitted byte-identical.
 */
export function buildPrompt({
  kind = "evaluate",
  input,
  memory = "",
  today = "",
  reportNum = input,
  cliId = "",
  hasPlaywright = false,
  jevPrior = null,
  jevCompile = null,
}) {
  const mem = memory.trim() ? `\n\nDurable notes about the user (from their profile):\n${memory.trim()}\n` : "";
  const todayStr = today || new Date().toISOString().slice(0, 10);
  const report = reportNum ?? input;

  if (kind === "research") {
    return `You are investigating the user's OWN work / portfolio to surface job-search-relevant strengths, headless. Investigate the target (use WebFetch for URLs; read local files if referenced) and report: what it is, why it is impressive, and how to leverage it in their job search — which roles/claims it supports and how to frame it on a CV. Be specific, honest, and encouraging.${mem}

End with EXACTLY one final line: VERDICT: {0-5 signal strength}/5 — {why it helps their search, ≤12 words}

Target: ${input}`;
  }

  if (kind === "pdf") {
    return `You are generating the user's ATS-optimized, TAILORED CV PDF for application #${input}, headless, on their machine. Run the REAL career-ops "pdf" mode — follow modes/pdf.md EXACTLY (default JSON → PDF path, not legacy HTML).
${CV_ENVELOPE_INSTRUCTION}
1. Read modes/pdf.md, cv.md, config/profile.yml, and the evaluation report at reports/${report}-*.md (for the JD keywords + analysis). If tmp/cv-fit-gaps-${report}.json exists, read it — those are requirement phrases the last tailored CV missed; weave them into summary, competencies, and top bullets using ONLY cv.md evidence (never claim Block B rows that say "No direct" / "No such").
2. Tailor the CV per modes/pdf.md: inject the JD's keywords into the summary + bullets, reorder by relevance, build the competency grid (6–8 phrases from Block B requirements with cv.md evidence), pick 3–4 projects from cv.md evidence. ALWAYS include EVERY employer from cv.md → Work Experience (SigmaX Labs, Deloitte USI, Synergy Teletech, InstaCure — each ≥1 bullet) — never drop a company block. Fill one page with substantive content: target 12–16 experience bullets (add more JD-tailored lines from cv.md when thin), not blank space at the bottom. NEVER invent skills — only reword REAL experience using the JD's vocabulary.
3. Build the JSON payload per modes/pdf.md "JSON Input Schema"; write it to /tmp/cv-{candidate}-{company}.json via Bash heredoc (candidate = profile name in kebab-case).
4. Fact gate: \`node verify-cv-facts.mjs /tmp/cv-{candidate}-{company}.json\` — fix payload if it fails.
5. Render the PDF (MUST run via Bash): \`node generate-pdf.mjs /tmp/cv-{candidate}-{company}.json output/cv-{candidate}-${todayStr}.pdf --format={letter for US/Canada companies, else a4} --report=${report}\`
6. Mark the tracker PDF column ✅ via the canonical writer (NEVER hand-edit data/applications.md): \`node mark-pdf-ready.mjs ${report}\`
Do not submit anything anywhere. Do NOT skip step 5 — Bash alone must run generate-pdf.mjs.

End with EXACTLY one final line: VERDICT: {5 if the PDF was written, else 1}/5 — PDF {written|failed}, ≤8 words (NOT a JD fit score — fit is computed separately)
After step 5, if possible run: node cv-jd-fit.mjs --report ${report} --company "{company from report}" --json and mention CV-JD fit X/5 in the prose above the VERDICT line.`;
  }

  if (kind === "cover") {
    return `You are generating a tailored COVER LETTER PDF for application #${input}, headless, on the user's machine. Run modes/cover.md with these WEB overrides (user clicked Generate in the UI — skip chat approval):
1. Read modes/cover.md, cv.md, config/profile.yml, modes/_profile.md, and the evaluation report at reports/${report}-*.md (use any existing "## Cover Letter Draft" as a starting point only).
2. Parse the JD from the report; one WebSearch query max if you need recent company context.
3. Draft the letter per cover.md (active voice, 350-420 words). Language rules: no em/en dashes (use comma or period); no GenAI buzzwords (leverage, synergy, seamless, holistic, robust, cutting-edge, spearheaded, passionate, excited, etc.); achievements as JSON \`{lead, impact}\` array only — never prefix lines with the word "bullet". Build the JSON payload from modes/cover.md Step 9.
4. Write the payload to /tmp/cover-payload-${input}.json
5. Render (MUST run via Bash): \`node generate-cover-letter.mjs --payload /tmp/cover-payload-${input}.json --report=${report}\` (uses reportlab — no browser).
Do not submit anywhere. Do NOT skip step 5 — Write alone cannot produce the PDF; you need Bash to run generate-cover-letter.mjs.

End with EXACTLY one final line: VERDICT: {5 if PDF written, else 1}/5 — {output path, ≤12 words}`;
  }

  if (kind === "fix-portal") {
    return `A company's job-portal ATS slug is BROKEN — career-ops can no longer scan it, so it silently disappears from every future scan. Repair it (headless, on the user's machine):
1. Run \`node verify-portals.mjs --add "${input}"\` — it probes Greenhouse/Ashby/Lever for the company's correct ATS slug and prints the suggested ats + slug.
2. Open portals.yml, find the "${input}" entry under tracked_companies, and update its careers_url (and any api/slug field) to the suggested WORKING ATS URL. Change ONLY this one company; preserve all other YAML structure, comments and formatting exactly.
3. Re-run \`node verify-portals.mjs\` and confirm "${input}" now shows ✅ live (not ❌).
If NO slug variant resolves, say so clearly and leave portals.yml unchanged. Never touch any other company.

End with EXACTLY one final line: VERDICT: {5 if now live, else 1}/5 — {what you changed, ≤12 words}`;
  }

  // evaluate (default) — run the REAL oferta mode + persist canonically
  const isLocal = input.startsWith("local:");
  // Playwright availability is per-CLI (doctor.mjs is the source of truth) and the
  // old text hardcoded "unavailable" for every CLI. That was backwards for
  // opencode, which DOES ship @playwright/mcp: the worker was told to skip
  // verification on the one CLI that can do it, and 42 reports carry the
  // unconfirmed header as a result. A closed posting is also the ONLY genuinely
  // free discard available here — a Playwright-confirmed-dead role costs nothing
  // and carries no false-negative risk (unlike a score-based cut-off).
  const sourceLine = isLocal
    ? `Read the JD from the local file \`${input.slice("local:".length)}\` (the \`local:\` prefix means: read that file directly, per modes/pipeline.md's convention — do NOT WebFetch it, it is not a URL).`
    : hasPlaywright
      ? `Verify the posting with Playwright BEFORE scoring it (this CLI has @playwright/mcp): \`browser_navigate\` the URL, then \`browser_snapshot\` it. Apply modes/_shared.md's rule — title + description + Apply = live; footer/navbar only, or an explicit closed/expired notice = DEAD. If DEAD: stop immediately, write NO report, and say so in one line (a closed posting costs no tokens and must not become a phantom evaluation). If LIVE: mark the report header "Verification: verified via Playwright".`
      : `Use WebFetch to read the posting (you are headless and this CLI${cliId ? ` (\`${cliId}\`)` : ""} has no Playwright MCP — doctor.mjs reports it absent — so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").`;

  // Cheap Jev prior (web/src/lib/jev-pre-screen.mjs). Advisory ONLY: the gate
  // cannot discard (0/69 real postings ever scored >= 4.0, and at a 2.6 cut-off it
  // would drop roles the user applied to), so it is injected as a weak prior that
  // the evidence must confirm or overturn — never as a score or a verdict.
  const priorLine = jevPrior && jevPrior.decision === "available"
    ? `\n\nA cheap deterministic ATS-screen pre-pass (TypeSafe Jev, no text generation) scored this posting ${jevPrior.score?.toFixed(2)}/5, band "${jevPrior.band}", core-skills ${jevPrior.hasCoreSkills ? "present" : "not established"} — correlating r=0.743 with the candidate's own prior evaluations. Treat it ONLY as a weak prior to confirm or overturn from the JD and the primary files. It is NOT a score, NOT a verdict, and must NEVER lower a block score on its own.`
    : "";

  const head = `You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Today is ${todayStr}. Run the REAL career-ops evaluation — do NOT improvise your own scoring.`;

  // Shared persistence + close. `stepNum`/`neverNum` are parameterized so the
  // Envelope B branch can insert its own steps 2-3 ahead without forking this
  // block; default numbering keeps the legacy output byte-identical.
  const persistSuffix = (stepNum = 2, neverNum = 3) => `

${stepNum}. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:
   a. Reserve a report number: run \`node reserve-report-num.mjs\` — its stdout is a 3-digit number (e.g. 035).
   b. Write the full report to reports/{num}-{company-slug}-${todayStr}.md  (company-slug = company lowercased, non-alphanumerics → hyphens).
   c. Append a TSV to batch/tracker-additions/{num}-{company-slug}.tsv with THIS header row first (real tab characters, not the four-space escape):
num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes
      then ONE data row under it (values aligned to those labels; status may sit before or after score — merge-tracker resolves by header name):
{num}\t${todayStr}\t{Company}\t{Role}\t{score}/5\t{CanonicalStatus e.g. Evaluated}\t❌\t[{num}](reports/{num}-{company-slug}-${todayStr}.md)\t{one-line note}
   d. Merge into the tracker: run \`node merge-tracker.mjs\` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).
   e. Release the reservation sentinel: run \`node reserve-report-num.mjs --release <num>\` with the number from (a). Skipping this leaks \`reports/{num}-RESERVED.md\` — an abandoned run's sentinel counts as an occupied report number forever, so every later evaluation is pushed one higher for a report that will never exist. modes/pipeline.md step (d) and every market mode's pipeline.md/oferta.md already require this release; this prompt did not, which is how the Airtel APM run (2026-09-28) orphaned 158 and 159.

${neverNum}. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.${mem}

After everything above is written and merged, output EXACTLY one final line, nothing after it:
VERDICT: {score}/5 — {reason in 12 words or fewer}

${isLocal ? "Posting source" : "Posting URL"}: ${input}`;

  // Envelope B (jev-decide.mjs + jev-inject.mjs): the Machine Summary is NOT
  // written free-form. System One (Jev) adjudicates the bounded enums; the worker
  // writes ONLY its residual free-text slots to `slotsPath` and leaves the
  // `<!-- machine-summary-slot -->` marker; the host composes the validated block
  // afterwards via jev-inject.mjs. Default off — when `jevCompile` is absent this
  // builder emits the byte-identical legacy prompt (see the envelope test).
  if (jevCompile) {
    const { slotsPath, facts } = jevCompile;
    return `${head}${priorLine}

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy). Ground the fit in THIS person: oferta.md names cv.md, config/profile.yml and modes/_profile.md as the primary sources and directs you to read them at the point of use (13/18/4 explicit references) — do not bulk-pre-read them here. ${sourceLine}

The Machine Summary is NOT yours to write — it is compiled deterministically by the host from System One machine decisions plus your free-text slots below. These System One facts are adjudicated readings of the same JD: ${facts}

2. Write your free-text slots to the file ${slotsPath} as JSON via a Bash heredoc, with EXACTLY these keys (the composed block is validated against batch/batch-prompt.md's Machine Summary schema; a malformed slot voids the envelope and the report keeps whatever prose you left instead):

\`\`\`json
{
  "company": "Company Name",
  "role": "Role Title",
  "score": 4.2,
  "final_decision": "Apply | Consider | Research first | Skip",
  "hard_stops": ["..."],
  "soft_gaps": ["..."],
  "top_strengths": ["..."],
  "next_action": "one concrete next step",
  "discard_reasons": ["..."],
  "via": null,
  "company_confidential": false,
  "advertised_comp": null,
  "reports_to": null,
  "requirement_importance": [
    {
      "requirement": "JD requirement",
      "jd_signal": "verbatim JD quote or null",
      "evidence": "stated | structural | inferred",
      "importance": "critical | high | meaningful | preferred | low_signal",
      "match": "strong | partial | missing | na"
    }
  ],
  "risk_summary": {
    "classification": "clear | flagged | not_evaluated",
    "culture": "pass | caution | fail | not_evaluated",
    "interview_redflags": "none | caution | warning | not_evaluated",
    "ai_infra": "consistent | mismatch | not_evaluated",
    "ai_screening_disclosure": "disclosed | corroborating_only | no_match | not_evaluated"
  }
}
\`\`\`

Rules: score is numeric only, no "/5". evidence "stated" requires a verbatim jd_signal quote from the JD; never "critical"/"high" importance with evidence "inferred". Use [] for empty arrays and null (never "N/A") for an absent via/advertised_comp/reports_to. company_confidential is true only when you concluded the end employer is unknown. Do NOT include legitimacy_tier, risk_level, work_auth, archetype, confidence, or risk_summary.legitimacy — System One supplies those fields.

3. In the report markdown, where a hand-written Machine Summary block would go, write EXACTLY these two lines (no yaml fence, no prose):

## Machine Summary

<!-- machine-summary-slot -->

Set the report header's **Archetype:** and **Legitimacy:** rows from the System One facts above.${persistSuffix(4, 5)}`;
  }

  return `${head}${priorLine}

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: oferta.md names cv.md, config/profile.yml and modes/_profile.md as the primary sources and directs you to read them at the point of use (13/18/4 explicit references) — do not bulk-pre-read them here. ${sourceLine}${persistSuffix()}`;
}

export default buildPrompt;
