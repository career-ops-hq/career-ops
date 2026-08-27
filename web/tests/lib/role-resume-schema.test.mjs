import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schema = JSON.parse(fs.readFileSync(new URL("../../src/lib/role-resume.schema.json", import.meta.url), "utf8"));
const expected = ["format", "lang", "name", "phone", "email", "linkedin", "portfolio", "location", "professionalSummary", "coreCompetencies", "workExperience", "projects", "education", "certifications", "awards", "interests", "skills"];

test("native role-resume schema requires the exact top-level contract", () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, expected);
  assert.deepEqual(Object.keys(schema.properties), expected);
  assert.deepEqual(schema.properties.format.enum, ["letter", "a4"]);
});

test("native role-resume schema rejects unknown keys at every object level", () => {
  for (const [name, definition] of Object.entries(schema.$defs)) {
    assert.equal(definition.additionalProperties, false, `${name} must reject unknown keys`);
  }
});

test("native nested role schema pins required and optional fields", () => {
  assert.deepEqual(schema.$defs.contactLink.required, ["url", "display"]);
  assert.deepEqual(schema.$defs.workExperience.required, ["company", "period", "role", "location", "bullets"]);
  assert.deepEqual(schema.$defs.project.required, ["title", "description", "technologies"]);
  assert.deepEqual(schema.$defs.education.required, ["title", "organization", "year"]);
  assert.deepEqual(schema.$defs.credential.required, ["title", "organization", "year"]);
  assert.deepEqual(schema.$defs.skill.required, ["category", "items"]);
});
