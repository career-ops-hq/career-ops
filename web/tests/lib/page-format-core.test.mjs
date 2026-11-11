// The dashboard prints on the sheet the CLI would.
//
// The core ranks paper size explicit --format -> config/profile.yml page_format
// -> the project default (lib/page-format.mjs), and page_format: auto hands the
// choice to the employer's country. The web used to have its agent pick letter
// for a US/Canada company and a4 otherwise, then passed that pick as --format,
// which outranks the profile: page_format: a4 could still print on Letter, and
// auto never applied. These cases drive core/page-format.mjs against the REAL
// core module and real profile files, so a change to the core's ranking shows up
// here instead of being restated.
//
// Expected sheets are literals, never read back out of the module under test.
//
// Run:  node --test tests/lib/page-format-core.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPageFormatSetting, resolveRenderPageFormat } from "../../src/lib/core/page-format.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// lib/page-format.mjs imports js-yaml through lib/yaml-document.mjs. A web-only
// install (web-ci.yml runs `npm ci` in web/ alone) has the file and not its
// dependency, so probe importability rather than existence, as cv-template.test.mjs does.
let coreUsable = true;
try {
  await import(path.join(CORE, "lib", "page-format.mjs"));
} catch {
  coreUsable = false;
}
const needsCore = { skip: coreUsable ? false : "the core's lib/page-format.mjs cannot be loaded here" };

const dirs = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-page-format-"));
  dirs.push(dir);
  return dir;
}

/** A profile.yml with `page_format: <value>`, or without the key for null. */
function profile(value) {
  const file = path.join(tempDir(), "profile.yml");
  fs.writeFileSync(file, value === null ? "name: Test Candidate\n" : `name: Test Candidate\npage_format: ${value}\n`);
  return file;
}

test("readPageFormatSetting: a4 and letter in the profile are read as stated", needsCore, async () => {
  assert.deepEqual(await readPageFormatSetting(CORE, profile("a4")), { setting: "a4", letterCountries: [] });
  assert.deepEqual(await readPageFormatSetting(CORE, profile(" Letter ")), { setting: "letter", letterCountries: [] });
});

test("readPageFormatSetting: auto carries the core's Letter countries", needsCore, async () => {
  const { setting, letterCountries } = await readPageFormatSetting(CORE, profile("auto"));
  assert.equal(setting, "auto");
  // The prompt names these, so they must be the core's list, sorted. Spot-checked
  // rather than pinned whole: tests/page-format-auto.test.mjs pins the table.
  assert.ok(letterCountries.includes("US") && letterCountries.includes("CA") && letterCountries.includes("MX"));
  assert.ok(!letterCountries.includes("DE") && !letterCountries.includes("GB"));
  assert.deepEqual(letterCountries, [...letterCountries].sort());
});

test("readPageFormatSetting: no key, an unknown value or no file is nothing stated", needsCore, async () => {
  const none = { setting: null, letterCountries: [] };
  assert.deepEqual(await readPageFormatSetting(CORE, profile(null)), none);
  assert.deepEqual(await readPageFormatSetting(CORE, profile("legal")), none);
  assert.deepEqual(await readPageFormatSetting(CORE, path.join(tempDir(), "missing.yml")), none);
});

test("readPageFormatSetting: a core it cannot load reads as nothing stated", async () => {
  // An empty directory has no lib/page-format.mjs to import.
  assert.deepEqual(await readPageFormatSetting(tempDir(), profile("a4")), { setting: null, letterCountries: [] });
});

test("readPageFormatSetting: a core older than readProfilePageSetting reads as nothing stated", async () => {
  // Given a checkout whose lib/page-format.mjs predates the export
  const root = tempDir();
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "page-format.mjs"), "export function readProfilePageFormat() { return 'a4'; }\n");

  // Then the web falls back to the agent's own pick, as it behaved before
  assert.deepEqual(await readPageFormatSetting(root, profile("a4")), { setting: null, letterCountries: [] });
});

test("resolveRenderPageFormat: the profile's a4 outranks the agent's letter", async () => {
  // This is the reported bug: page_format: a4, a US employer, and the agent
  // following the old "letter for a US/Canada company" rule.
  const sheet = await resolveRenderPageFormat(CORE, { setting: "a4", declared: "letter", country: null });
  assert.equal(sheet.format, "a4");
  assert.equal(sheet.warnings.length, 1);
  assert.match(sheet.warnings[0], /declared letter.*page_format in your profile is a4/);
});

test("resolveRenderPageFormat: the profile's letter holds when the agent declares nothing", async () => {
  const sheet = await resolveRenderPageFormat(CORE, { setting: "letter", declared: null });
  assert.deepEqual(sheet, { format: "letter", warnings: [] });
});

test("resolveRenderPageFormat: an agent that agrees with the profile raises no warning", async () => {
  const sheet = await resolveRenderPageFormat(CORE, { setting: "a4", declared: "a4" });
  assert.deepEqual(sheet, { format: "a4", warnings: [] });
});

for (const [country, expected] of [["DE", "a4"], ["US", "letter"], [" ca ", "letter"], ["JP", "a4"], ["MX", "letter"]]) {
  test(`resolveRenderPageFormat: auto maps ${JSON.stringify(country)} to ${expected}`, needsCore, async () => {
    const sheet = await resolveRenderPageFormat(CORE, { setting: "auto", declared: null, country });
    assert.deepEqual(sheet, { format: expected, warnings: [] });
  });
}

test("resolveRenderPageFormat: under auto the country wins over a declared format", needsCore, async () => {
  // The prompt asks for a country only, so a format here is the agent going off
  // script; the profile said auto, and auto is decided by the country.
  const sheet = await resolveRenderPageFormat(CORE, { setting: "auto", declared: "letter", country: "FR" });
  assert.equal(sheet.format, "a4");
});

test("resolveRenderPageFormat: auto with no country takes the default and says so", needsCore, async () => {
  const sheet = await resolveRenderPageFormat(CORE, { setting: "auto", declared: null, country: null });
  assert.equal(sheet.format, "letter");
  assert.equal(sheet.warnings.length, 1);
  assert.match(sheet.warnings[0], /auto.*no country.*letter/);
});

test("resolveRenderPageFormat: auto with a malformed country takes the default and says so", needsCore, async () => {
  const sheet = await resolveRenderPageFormat(CORE, { setting: "auto", country: "Germany" });
  assert.equal(sheet.format, "letter");
  assert.match(sheet.warnings[0], /"Germany" is not a two-letter country code/);
});

test("resolveRenderPageFormat: with nothing stated the agent's pick is used", async () => {
  // No page_format in the profile: modes/pdf.md step 6 has the agent choose, on
  // the CLI and here alike. A country the agent named is ignored.
  assert.deepEqual(await resolveRenderPageFormat(CORE, { setting: null, declared: "a4", country: "US" }), { format: "a4", warnings: [] });
  assert.deepEqual(await resolveRenderPageFormat(CORE, { setting: null, declared: "letter" }), { format: "letter", warnings: [] });
});

test("resolveRenderPageFormat: nothing stated and nothing declared takes the default and says so", async () => {
  const sheet = await resolveRenderPageFormat(CORE, {});
  assert.equal(sheet.format, "letter");
  assert.equal(sheet.warnings.length, 1);
  assert.match(sheet.warnings[0], /declared no page format.*letter/);
});
