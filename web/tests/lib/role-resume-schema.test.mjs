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

const objectSchemas = (node, at = "$") => {
  if (!node || typeof node !== "object") return [];
  const here = node.type === "object" ? [[at, node]] : [];
  return here.concat(Object.entries(node.properties || {}).flatMap(([key, value]) => objectSchemas(value, `${at}.${key}`)), objectSchemas(node.items, `${at}[]`));
};

test("every native object is closed and requires every declared property", () => {
  const objects = objectSchemas(schema);
  assert.equal(objects.length, 9);
  for (const [at, definition] of objects) {
    assert.equal(definition.additionalProperties, false, `${at} must reject unknown keys`);
    assert.deepEqual(new Set(definition.required), new Set(Object.keys(definition.properties)), `${at} must require every property`);
  }
});

test("conceptually optional values are required nullable fields", () => {
  const project = schema.properties.projects.items;
  const education = schema.properties.education.items;
  assert.ok(project.required.includes("url"));
  assert.ok(project.required.includes("badge"));
  assert.deepEqual(project.properties.url.type, ["string", "null"]);
  assert.deepEqual(project.properties.badge.type, ["string", "null"]);
  assert.ok(education.required.includes("description"));
  assert.deepEqual(education.properties.description.type, ["string", "null"]);
});

test("schema uses the simple inline structured-output subset", () => {
  assert.equal("$schema" in schema, false);
  assert.equal("$defs" in schema, false);
  assert.doesNotMatch(JSON.stringify(schema), /"\$ref"/);
});
