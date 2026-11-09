/**
 * answer-prompt.mjs - build the planner's pre-fill instruction from a form.
 *
 * Plain .mjs whose only import is the dependency-free profile-path.mjs, for the same reason extract-json-object.mjs is:
 * the prompt is the part of apply/prefill that decides what the model is
 * allowed to answer, and it was unreachable by a test while it lived inline in
 * the route. Work authorization, visa, and compensation are filled from the
 * profile when it states them. Citizenship, gender, race, disability, and
 * veteran questions stay blank, and years of experience are not invented.
 */
import { DEFAULT_PROFILE_REF } from "../core/profile-path.mjs";


/**
 * One form control, as much of it as the prompt needs. Structurally satisfied by
 * ApplyField, without importing it: extract.ts pulls in playwright-core, and a
 * module that does cannot be loaded by `node --test`.
 *
 * @typedef {Object} PromptField
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {boolean} [required]
 * @property {string[]} [options]
 */

/**
 * `cvSource` is the tailored CV being uploaded to this same form, as a
 * root-relative readable path (applyCvSource resolves it from the PDF the fill
 * route attaches). The tailoring is the whole point of it: bullets are
 * reselected per offer, role framing is rewritten toward the employer's domain,
 * and engagements may be regrouped under an umbrella firm. The reviewer reads
 * the structured fields beside the attachment, so drafting from master cv.md
 * contradicts the resume stapled to the form and discards the tailoring that
 * made the application relevant. The ownership split below mirrors modes/apply.md Step
 * 4b, which settles the same question on the CLI path. Null when no tailored CV
 * exists for this application, and only then does cv.md own the answers.
 *
 * @param {{title: string, fields: PromptField[], memory?: string, cvSource?: string | null, profile?: string}} opts
 * `profile` is how the prompt names the profile file: profileRef() in core/profile-path.mjs.
 * @returns {string}
 */
export function buildAnswerPrompt({ title, fields, memory = "", cvSource = null, profile = DEFAULT_PROFILE_REF }) {
  const fieldsList = fields
    .map((f) => `${f.id}\t${f.type}${f.required ? "*" : ""}\t${f.label}${f.options ? `\t[options: ${f.options.join(" | ")}]` : ""}`)
    .join("\n");
  const sources = cvSource
    ? `SOURCES. The document being attached to this form is the tailored CV at ${cvSource} — read it, and read ${profile}. If a matching report for this company exists in reports/, read it too.
- ${profile} owns name, email, phone, address, links, work authorization, visa status and comp expectations. It is authoritative; no CV overrides it.
- The tailored CV owns employer names, job titles, dates, locations, role descriptions, achievements, education, certifications, skills and the summary. The reviewer is holding it, so every experience answer must describe the roles as it states them.
- cv.md is the fallback only: read it for a whole section the tailored CV omits, never to top up a role the tailored CV already covers. Where the two disagree, the tailored CV wins.`
    : `SOURCES. No tailored CV was found for this application. Read cv.md and ${profile}; if a matching report for this company exists in reports/, read it too. ${profile} owns name, email, phone, address, links, work authorization, visa status and comp expectations, and is authoritative over cv.md.`;

  return `You are pre-filling a job application for the user (company/role: ${title}).

${sources}

Ground EVERY answer in the REAL candidate — never invent facts.${memory ? `\n\nDurable notes about the user:\n${memory}` : ""}

FIELDS (id ⇥ type ⇥ label ⇥ options):
${fieldsList}

For each field give the best answer:
- identity/contact (name, email, phone, github, linkedin, location) → from ${profile}.
- experience (employer, job title, dates, location, role description) → from the source that owns it above, verbatim in substance.
- free-text (Why us?, cover-letter, "most impactful thing you've built", etc.) → a concise, honest, concrete answer in the candidate's own voice (no buzzwords, active voice, real metrics only). Keep each under ~120 words.
- select/radio → choose the best-matching option using the EXACT option text from the list.
- work authorization, visa sponsorship, and compensation expectations → from ${profile} when it states them (location.authorized_in, location.visa_status, location.needs_sponsorship, compensation.target_range). Use the exact option text. If ${profile} does not state that answer, set needs_confirmation:true and value:"".
- NEVER invent a work-authorization, visa, sponsorship, or salary answer the profile does not state.
- NEVER fill citizenship, nationality, permanent resident, gender, race, ethnicity, disability, or veteran questions → set needs_confirmation:true and value:"".
- NEVER fill criminal history, non-compete, security clearance, age or date of birth, sexual orientation, religion, or marital status questions → set needs_confirmation:true and value:"".
- NEVER invent years of experience, a degree, or a credential to meet a minimum. If the source does not state it, set needs_confirmation:true and value:"".
- NEVER fill a legal consent, privacy, or terms checkbox → set needs_confirmation:true and value:"".

Output ONLY a compact JSON object mapping each field id → {"value": "...", "needs_confirmation": boolean}. No prose, no markdown, no code fence.`;
}
