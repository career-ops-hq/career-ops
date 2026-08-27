import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatRoleResumeSchemaDiagnostics, inspectRawRoleResumeJsonShape, inspectRoleResumeJsonShape, parseRawRoleResumeJson, parseRoleResumeWorkerResponse, renderRoleResumeTemplate, roleResumeSourceRequirements, validateRoleResumeCompleteness, ROLE_JSON_OPEN_MARK, ROLE_JSON_CLOSE_MARK } from "../../src/lib/role-resume-content.mjs";

const root = new URL("../../..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
const content = (overrides = {}) => ({
  format: "letter", lang: "en", name: "Jane & Doe", phone: "555 < 1234", email: "jane@example.test",
  linkedin: { url: "https://example.test/in/jane?a=1&b=2", display: "LinkedIn <Jane>" },
  portfolio: { url: "", display: "" }, location: "Remote > US", professionalSummary: "Builds secure & reliable systems.",
  coreCompetencies: ["Java & APIs"],
  workExperience: [{ company: "Example <Corp>", period: "2020–Present", role: "Engineer", location: "Remote", bullets: ["Improved A & B"] }],
  projects: [{ title: "Project", description: "Description", technologies: ["Java"], url: null, badge: null }],
  education: [{ title: "Degree", organization: "University", year: "2020", description: null }],
  certifications: [], awards: [], interests: "Learning & systems", skills: [{ category: "Languages", items: ["Java", "SQL"] }],
  ...overrides,
});
const response = (value = content(), prefix = "") => `${prefix}${ROLE_JSON_OPEN_MARK}\n${JSON.stringify(value)}\n${ROLE_JSON_CLOSE_MARK}\nVERDICT: 5/5 — complete`;
const completeContent = (overrides = {}) => content({
  name: "Jane Doe",
  professionalSummary: "Senior software engineer building reliable enterprise backend services, integrations, and scalable production systems across complex regulated environments.",
  coreCompetencies: ["Java", "REST APIs", "Backend Services", "System Design", "Production Reliability", "Performance Engineering"],
  workExperience: [{ company: "Example Corp", period: "2020–Present", role: "Senior Engineer", location: "Remote", bullets: ["Built supported backend services.", "Resolved complex production issues."] }],
  projects: [{ title: "Platform Modernization", description: "Modernized a supported enterprise platform.", technologies: ["Java", "Docker"], url: null, badge: null }],
  education: [{ title: "Degree", organization: "University", year: "2020", description: null }],
  certifications: [{ title: "Certification", organization: "Issuer", year: "2021" }],
  awards: [], interests: "",
  skills: [{ category: "Languages", items: ["Java", "JavaScript"] }, { category: "Platforms", items: ["Docker", "Kubernetes"] }],
  ...overrides,
});
const sourceRequirements = { projects: true, education: true, certifications: true };

test("General Role worker returns structured JSON only", () => {
  const parsed = parseRoleResumeWorkerResponse(response());
  assert.equal(parsed.ok, true); assert.equal(parsed.content.name, "Jane & Doe");
});
test("native schema-constrained raw JSON validates and reaches the canonical renderer", () => {
  const parsed = parseRawRoleResumeJson(JSON.stringify(content()));
  assert.equal(parsed.ok, true);
  const html = renderRoleResumeTemplate({ root, content: parsed.content }).html;
  assert.equal((html.match(/class="section-title"/g) || []).length, 9);
});
test("native raw control/status wrapper cannot pass", () => {
  const raw = JSON.stringify({ message: "done", output_constraints: {}, status: "success", system_notice: "notice" });
  assert.match(parseRawRoleResumeJson(raw).error, /unexpected field "message"/);
  const diagnostic = formatRoleResumeSchemaDiagnostics(inspectRawRoleResumeJsonShape(raw));
  assert.equal(diagnostic.presentRequiredKeyCount, 0);
  assert.equal(diagnostic.unexpectedKeysCsv, "message,output_constraints,status,system_notice");
});
test("native raw JSON still fails when a required field is absent", () => {
  const value = content(); delete value.professionalSummary;
  assert.match(parseRawRoleResumeJson(JSON.stringify(value)).error, /field "professionalSummary" is required/);
});
test("nullable semantic fields accept strings or null and reject other types", () => {
  assert.equal(parseRawRoleResumeJson(JSON.stringify(content())).ok, true);
  assert.equal(parseRawRoleResumeJson(JSON.stringify(content({ projects: [{ title: "P", description: "D", technologies: [], url: "https://example.test", badge: "Featured" }], education: [{ title: "D", organization: "U", year: "2020", description: "Coursework" }] }))).ok, true);
  assert.match(parseRawRoleResumeJson(JSON.stringify(content({ projects: [{ title: "P", description: "D", technologies: [], url: 42, badge: null }] }))).error, /projects\[0\]\.url.*string/);
  assert.match(parseRawRoleResumeJson(JSON.stringify(content({ education: [{ title: "D", organization: "U", year: "2020", description: false }] }))).error, /education\[0\]\.description.*string/);
});
test("default-like empty content fails semantic completeness", () => {
  assert.match(validateRoleResumeCompleteness(content({ name: "", professionalSummary: "", coreCompetencies: [], workExperience: [], projects: [], education: [], certifications: [], skills: [] }), sourceRequirements).error, /name is empty/);
});
test("workflow/refusal summary fails explicitly", () => {
  assert.match(validateRoleResumeCompleteness(completeContent({ professionalSummary: "Please provide the job description or specify the career-ops task you want completed." }), sourceRequirements).error, /refusal instead of a professional summary/);
});
test("empty competencies and work experience fail clearly", () => {
  assert.match(validateRoleResumeCompleteness(completeContent({ coreCompetencies: [] }), sourceRequirements).error, /coreCompetencies has 0/);
  assert.match(validateRoleResumeCompleteness(completeContent({ workExperience: [] }), sourceRequirements).error, /workExperience is empty/);
});
test("work experience requires two substantive bullets", () => {
  const workExperience = [{ company: "Example", role: "Engineer", period: "2020", location: "Remote", bullets: ["Only one", " "] }];
  assert.match(validateRoleResumeCompleteness(completeContent({ workExperience }), sourceRequirements).error, /bullets has 1/);
});
test("source-backed projects education and certifications cannot disappear", () => {
  assert.match(validateRoleResumeCompleteness(completeContent({ projects: [] }), sourceRequirements).error, /projects is empty/);
  assert.match(validateRoleResumeCompleteness(completeContent({ education: [] }), sourceRequirements).error, /education is empty/);
  assert.match(validateRoleResumeCompleteness(completeContent({ certifications: [] }), sourceRequirements).error, /certifications is empty/);
});
test("skills require two populated categories", () => {
  assert.match(validateRoleResumeCompleteness(completeContent({ skills: [] }), sourceRequirements).error, /skills has 0 categories/);
  assert.match(validateRoleResumeCompleteness(completeContent({ skills: [{ category: "Languages", items: ["Java"] }, { category: "Platforms", items: ["Docker", "Kubernetes"] }] }), sourceRequirements).error, /items has 1/);
});
test("valid populated content passes while awards and interests remain optional", () => {
  assert.deepEqual(validateRoleResumeCompleteness(completeContent({ awards: [], interests: "" }), sourceRequirements), { ok: true });
});
test("source requirements are derived from section presence without exposing content", () => {
  assert.deepEqual(roleResumeSourceRequirements("# CV\n## Selected Projects\n- One\n## Education\n- Degree\n## Certifications\n- Cert"), sourceRequirements);
  assert.deepEqual(roleResumeSourceRequirements("# CV\n## Experience\n- Work"), { projects: false, education: false, certifications: false });
});
test("backend fills the real template with nine preserved sections and landmarks", () => {
  const rendered = renderRoleResumeTemplate({ root, content: content() });
  assert.equal((rendered.html.match(/class="section-title"/g) || []).length, 9);
  for (const landmark of ["page", "header", "contact-row", "summary-text", "competencies-grid", "cert-table", "award-table", "interests-line"]) assert.match(rendered.html, new RegExp(`class="${landmark}"`));
  assert.doesNotMatch(rendered.html, /{{[^}]+}}/);
});
test("missing required JSON field fails clearly", () => {
  const value = content(); delete value.skills;
  assert.match(parseRoleResumeWorkerResponse(response(value)).error, /field "skills" is required/);
});
test("unknown fields fail closed", () => assert.match(parseRoleResumeWorkerResponse(response(content({ html: "<script>" }))).error, /unexpected field "html"/));
for (const forbidden of ["status", "targetRole", "metadata"]) {
  test(`top-level ${forbidden} fails closed`, () => assert.match(parseRoleResumeWorkerResponse(response(content({ [forbidden]: "forbidden" }))).error, new RegExp(`unexpected field "${forbidden}"`)));
}
test("HTML special characters are escaped and unsafe URLs are removed", () => {
  const rendered = renderRoleResumeTemplate({ root, content: content({ portfolio: { url: "javascript:alert(1)", display: "Bad" } }) }).html;
  assert.match(rendered, /Jane &amp; Doe/); assert.match(rendered, /555 &lt; 1234/); assert.doesNotMatch(rendered, /javascript:/); assert.doesNotMatch(rendered, /Example <Corp>/);
});
test("optional empty sections preserve their wrappers and classes", () => {
  const html = renderRoleResumeTemplate({ root, content: content({ projects: [], certifications: [], awards: [], interests: "" }) }).html;
  assert.equal((html.match(/class="section-title"/g) || []).length, 9); assert.match(html, /class="cert-table"><\/div>/); assert.match(html, /class="award-table"><\/div>/);
});
test("narration and Markdown outside the structured envelope never become resume content", () => {
  const parsed = parseRoleResumeWorkerResponse(response(content(), "# I’m applying a workflow\n**narration**\n"));
  assert.equal(parsed.ok, true);
  const html = renderRoleResumeTemplate({ root, content: parsed.content }).html;
  assert.doesNotMatch(html, /applying a workflow|\*\*narration/);
});
test("invalid JSON fails cleanly", () => assert.match(parseRoleResumeWorkerResponse(`${ROLE_JSON_OPEN_MARK}\n{bad}\n${ROLE_JSON_CLOSE_MARK}\nVERDICT: 5/5 - complete`).error, /invalid JSON/));
test("final 5/5 VERDICT remains required", () => assert.match(parseRoleResumeWorkerResponse(response().replace("VERDICT: 5/5", "VERDICT: 4/5")).error, /VERDICT/));
test("VERDICT remains outside the JSON object", () => {
  const raw = response(); const json = raw.slice(raw.indexOf("{") , raw.lastIndexOf("}") + 1);
  assert.equal("verdict" in JSON.parse(json), false); assert.match(raw.split("<</role-resume-json>>")[1], /VERDICT: 5\/5/);
});
test("two distinct structured envelopes still fail closed", () => {
  const raw = `${response(content())}\n${response(content({ name: "Other" }))}`;
  assert.match(parseRoleResumeWorkerResponse(raw).error, /Found 2 role-resume JSON envelopes/);
});
test("the canonical template placeholder inventory remains mapped", () => {
  const template = fs.readFileSync(new URL("../../../templates/cv-template.html", import.meta.url), "utf8");
  const rendered = renderRoleResumeTemplate({ root, content: content() }).html;
  assert.equal(new Set(template.match(/{{[A-Z0-9_]+}}/g)).size, 29); assert.doesNotMatch(rendered, /{{[A-Z0-9_]+}}/);
});
test("schema diagnostics emit key names as CSV without field values", () => {
  const wrapped = response({ status: "secret status value", result: "secret result value", content: { name: "private name" } });
  const diagnostic = formatRoleResumeSchemaDiagnostics(inspectRoleResumeJsonShape(wrapped));
  assert.equal(diagnostic.topLevelKeysCsv, "content,result,status");
  assert.equal(diagnostic.unexpectedKeysCsv, "content,result,status");
  assert.match(diagnostic.missingRequiredKeysCsv, /format/);
  const serialized = JSON.stringify(diagnostic);
  for (const value of ["secret status value", "secret result value", "private name"]) assert.doesNotMatch(serialized, new RegExp(value));
});
