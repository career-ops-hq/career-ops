import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

import "../helpers/web-ts-alias-loader.mjs";

// The first profile the web writes is seeded from config/profile.example.yml, by
// whichever of two routes saves first. config/profile.yml is the ground truth for
// facts from then on, so whatever the example says about its example person and
// the save did not replace would reach a CV as the user's own claim. Runs against
// the real template: a field added to it later has to be classified here, not
// found on someone's CV.
const { POST: saveProfile } = await import("../../src/app/api/profile/route.ts");
const { POST: saveCadence } = await import("../../src/app/api/followups/cadence/route.ts");

const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const template = readFileSync(path.join(CODE_ROOT, "config", "profile.example.yml"), "utf8");
const example = yaml.load(template);

const PERSONAL_SECTIONS = ["candidate", "target_roles", "narrative", "compensation", "location"];
// Settings that say nothing about the person, so the seed may keep them.
const SETTINGS = new Set(["candidate.photo_style", "compensation.currency", "location.needs_sponsorship"]);
const LEAKS = ["janesmith", "Jane Smith", "555-0123", "Project Alpha", "sold my SaaS"];

const FORM = {
  name: "Ada Lovelace",
  email: "ada@fixture.invalid",
  location: "London",
  roles: ["Analytical Engineer"],
  compMin: 70000,
  compMax: 95000,
  currency: "GBP",
  remote: "Hybrid",
};

async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-first-run-"));
  mkdirSync(path.join(root, "config"));
  const previous = { root: process.env.CAREER_OPS_ROOT, code: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  try {
    await fn(path.join(root, "config", "profile.yml"));
  } finally {
    if (previous.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous.root;
    if (previous.code === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previous.code;
    rmSync(root, { recursive: true, force: true });
  }
}

const request = (patch) => new Request("http://fixture.invalid/api/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(patch),
});
const post = (patch) => saveProfile(request(patch));
const uncommented = (text) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

/** Every leaf under a value, as [dotted key, value]. */
function leaves(value, at) {
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${at}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, `${at}.${k}`));
  return value === "" || value === null ? [] : [[at, value]];
}

test("the example has values to protect against, so an empty walk cannot pass", () => {
  const walked = PERSONAL_SECTIONS.flatMap((section) => leaves(example[section], section));
  assert.ok(walked.length >= 30, `only ${walked.length} leaves`);
  assert.ok(walked.some(([, v]) => v === "Jane Smith"));
});

test("a first run keeps nothing the example says about its example person", async () => {
  await withRoot(async (file) => {
    const response = await post(FORM);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).seeded, true);
    const written = yaml.load(readFileSync(file, "utf8"));
    const form = new Set(Object.values(FORM).flat().map(String));
    const left = PERSONAL_SECTIONS
      .flatMap((section) => leaves(written[section], section))
      .filter(([key]) => !SETTINGS.has(key))
      .filter(([, value]) => !form.has(String(value)) && !String(value).startsWith("70000"));
    assert.deepEqual(left, []);
    for (const leak of LEAKS) assert.ok(!uncommented(readFileSync(file, "utf8")).includes(leak), `${leak} is still in the profile`);
  });
});

test("the follow-up cadence route seeds the same way when it saves first", async () => {
  await withRoot(async (file) => {
    assert.equal((await saveCadence(request({ applied_first_days: 9 }))).status, 200);
    const text = readFileSync(file, "utf8");
    const written = yaml.load(text);
    const left = PERSONAL_SECTIONS.flatMap((section) => leaves(written[section], section)).filter(([key]) => !SETTINGS.has(key));
    assert.deepEqual(left, []);
    for (const leak of LEAKS) assert.ok(!uncommented(text).includes(leak), `${leak} is still in the profile`);
    assert.equal(written.followup_cadence.applied_first_days, 9);
  });
});

test("a first run with only a role still drops the example's name and email", async () => {
  await withRoot(async (file) => {
    assert.equal((await post({ roles: ["Analytical Engineer"] })).status, 200);
    const { candidate } = yaml.load(readFileSync(file, "utf8"));
    assert.equal(candidate.full_name, "");
    assert.equal(candidate.email, "");
  });
});

test("a first run writes what the form sent", async () => {
  await withRoot(async (file) => {
    await post(FORM);
    const written = yaml.load(readFileSync(file, "utf8"));
    assert.equal(written.candidate.full_name, FORM.name);
    assert.equal(written.candidate.email, FORM.email);
    assert.equal(written.candidate.location, FORM.location);
    assert.deepEqual(written.target_roles.primary, FORM.roles);
    assert.equal(written.compensation.target_range, "70000-95000");
    assert.equal(written.compensation.currency, "GBP");
    assert.equal(written.compensation.location_flexibility, "Hybrid");
  });
});

test("a first run keeps the template's settings and its comments", async () => {
  await withRoot(async (file) => {
    await post(FORM);
    const text = readFileSync(file, "utf8");
    const written = yaml.load(text);
    assert.deepEqual(written.language, example.language);
    assert.equal(written.spend_tier, example.spend_tier);
    assert.deepEqual(written.cv, example.cv);
    assert.match(text, /# Optional profile photo for the PDF CV/, "the opt-in keys are documented in comments");
    assert.match(text, /# Archetypes help the evaluation system score fit/);
  });
});

test("a saved profile is left alone: only a seed is cleared", async () => {
  await withRoot(async (file) => {
    const saved = "candidate:\n  full_name: Ada Lovelace\n  phone: \"+44 20 7946 0000\"\n  linkedin: linkedin.com/in/ada\n";
    writeFileSync(file, saved);
    assert.equal((await post({ location: "London" })).status, 200);
    const { candidate } = yaml.load(readFileSync(file, "utf8"));
    assert.equal(candidate.phone, "+44 20 7946 0000");
    assert.equal(candidate.linkedin, "linkedin.com/in/ada");
    assert.equal(candidate.location, "London");
  });
});
