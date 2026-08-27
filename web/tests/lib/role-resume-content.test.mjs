import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRoleResumeWorkerResponse, renderRoleResumeTemplate, ROLE_JSON_OPEN_MARK, ROLE_JSON_CLOSE_MARK } from "../../src/lib/role-resume-content.mjs";

const root = new URL("../../..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
const content = (overrides = {}) => ({
  format: "letter", lang: "en", name: "Jane & Doe", phone: "555 < 1234", email: "jane@example.test",
  linkedin: { url: "https://example.test/in/jane?a=1&b=2", display: "LinkedIn <Jane>" },
  portfolio: { url: "", display: "" }, location: "Remote > US", professionalSummary: "Builds secure & reliable systems.",
  coreCompetencies: ["Java & APIs"],
  workExperience: [{ company: "Example <Corp>", period: "2020–Present", role: "Engineer", location: "Remote", bullets: ["Improved A & B"] }],
  projects: [{ title: "Project", description: "Description", technologies: ["Java"] }],
  education: [{ title: "Degree", organization: "University", year: "2020" }],
  certifications: [], awards: [], interests: "Learning & systems", skills: [{ category: "Languages", items: ["Java", "SQL"] }],
  ...overrides,
});
const response = (value = content(), prefix = "") => `${prefix}${ROLE_JSON_OPEN_MARK}\n${JSON.stringify(value)}\n${ROLE_JSON_CLOSE_MARK}\nVERDICT: 5/5 — complete`;

test("General Role worker returns structured JSON only", () => {
  const parsed = parseRoleResumeWorkerResponse(response());
  assert.equal(parsed.ok, true); assert.equal(parsed.content.name, "Jane & Doe");
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
