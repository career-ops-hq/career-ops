/**
 * answer-prompt.mjs - build the planner's pre-fill instruction from a form.
 *
 * Plain .mjs with no imports, for the same reason extract-json-object.mjs is:
 * the prompt is the part of apply/prefill that decides what the model is
 * allowed to answer, and it was unreachable by a test while it lived inline in
 * the route. The sensitive-field carve-out on the fourth bullet is the line that
 * matters - it is what keeps legal, visa, work-authorization, salary and
 * demographic questions from being auto-filled - and nothing pinned it.
 *
 * Moved verbatim from api/apply/prefill/route.ts. The wording, the
 * tab-separated field list and the arrows are the prompt the planner has been
 * receiving all along; this is a relocation, not a rewrite.
 */

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
 * @param {{title: string, fields: PromptField[], memory?: string}} opts
 * @returns {string}
 */
export function buildAnswerPrompt({ title, fields, memory = "" }) {
  const fieldsList = fields
    .map((f) => `${f.id}\t${f.type}${f.required ? "*" : ""}\t${f.label}${f.options ? `\t[options: ${f.options.join(" | ")}]` : ""}`)
    .join("\n");
  return `You are pre-filling a job application for the user (company/role: ${title}). Read cv.md and config/profile.yml; if a matching report for this company exists in reports/, read it too. Ground EVERY answer in the REAL candidate — never invent facts.${memory ? `\n\nDurable notes about the user:\n${memory}` : ""}

FIELDS (id ⇥ type ⇥ label ⇥ options):
${fieldsList}

For each field give the best answer:
- identity/contact (name, email, phone, github, linkedin, location) → from profile/cv.
- free-text (Why us?, cover-letter, "most impactful thing you've built", etc.) → a concise, honest, concrete answer in the candidate's own voice (no buzzwords, active voice, real metrics only). Keep each under ~120 words.
- select/radio → choose the best-matching option using the EXACT option text from the list.
- NEVER fill legal / visa / work-authorization / salary / demographic / sensitive fields → set needs_confirmation:true and value:"".

Output ONLY a compact JSON object mapping each field id → {"value": "...", "needs_confirmation": boolean}. No prose, no markdown, no code fence.`;
}
