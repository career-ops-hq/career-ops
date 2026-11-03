// A one-job paste used to read as "thin" because it was under 80 words, and
// the first-run checklist opened on twelve evaluation sections. A named role
// is enough to match. Compact first-run counts the four setup files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cvReadiness } from "../../src/lib/cv/readiness.mjs";
import { onboardingChecklist, PREREQS } from "../../src/lib/home/onboarding-checklist.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ONE_JOB = [
  "## Experience",
  "Floor lead, Northwind Market",
  "2019-2024",
  "Opened the shop and wrote the weekly schedule.",
].join("\n");

test("a one-job paste with a role is ready to match", () => {
  const ready = cvReadiness(ONE_JOB);
  assert.ok(ready.words < 80, `expected a short paste, got ${ready.words} words`);
  assert.equal(ready.hasExperience, true);
  assert.equal(ready.scoreable, true);
  assert.equal(ready.hint, undefined);
});

test("a title with no role stays thin", () => {
  const thin = cvReadiness("Floor lead at a grocery chain");
  assert.equal(thin.hasExperience, false);
  assert.equal(thin.scoreable, false);
});

test("a short skills list with no role stays thin", () => {
  const skills = cvReadiness("## Skills\nScheduling, inventory, opening, closing");
  assert.equal(skills.hasSkills, true);
  assert.equal(skills.hasExperience, false);
  assert.ok(skills.words < 80);
  assert.equal(skills.scoreable, false);
});

test("a bare experience heading is not a role", () => {
  for (const md of ["## Experience", "## Experience\n\n## Skills\nScheduling"]) {
    const bare = cvReadiness(md);
    assert.equal(bare.scoreable, false, md);
  }
  assert.equal(cvReadiness("## Experience\nFloor lead, Northwind Market").scoreable, true);
});

test("work authorization is not a role, and a subheading under experience is", () => {
  const auth = cvReadiness("## Work Authorization\nAuthorized to work");
  assert.equal(auth.scoreable, false);
  assert.equal(auth.hasExperience, false);
  const sub = cvReadiness("## Experience\n### Floor lead, Northwind Market");
  assert.equal(sub.scoreable, true);
  assert.equal(cvReadiness("## Work Experience\nFloor lead, Northwind Market").scoreable, true);
  for (const heading of ["## Experience:", "## Experience ##", "## Experience: ##"]) {
    assert.equal(cvReadiness(`${heading}\nFloor lead, Northwind Market`).scoreable, true, heading);
  }
  assert.equal(cvReadiness("## Work Authorization:\nAuthorized to work").scoreable, false);
  assert.equal(cvReadiness("## Experience\n<!-- add your roles here -->").scoreable, false);
  assert.equal(cvReadiness("## Experience\n<!-<!-- x -->- y -->").scoreable, false);
  assert.equal(cvReadiness("## Experience\n<!-- newest first -->\nFloor lead, Northwind Market").scoreable, true);
});

test("deeply nested comment markers are stripped in one linear pass", () => {
  const nested = "## Experience\n" + "<!-".repeat(100_000) + "- -->".repeat(100_000);
  const started = performance.now();
  assert.equal(cvReadiness(nested).scoreable, false);
  assert.ok(performance.now() - started < 1000, "readiness of an 800 KB nested paste took over a second");
});

test("a range that starts before 2000 is a role", () => {
  assert.equal(cvReadiness("Floor lead, Northwind Market\n1998–2002").scoreable, true);
  assert.equal(cvReadiness("Floor lead, Northwind Market\n1996 - present").scoreable, true);
});

test("a range with months on both ends is a role", () => {
  for (const range of ["Jan 2020 – Dec 2023", "January 2020 - March 2023", "enero 2020 – diciembre 2023", "01/2020 - 12/2023"]) {
    assert.equal(cvReadiness(`Floor lead, Northwind Market\n${range}`).scoreable, true, range);
  }
  assert.equal(cvReadiness("Floor lead, Northwind Market\nSept. 2019 — Present").scoreable, true);
});

test("Current ends a range like Present does", () => {
  assert.equal(cvReadiness("Floor lead, Northwind Market\n2020 - Current").scoreable, true);
  assert.equal(cvReadiness("Floor lead, Northwind Market\nMar 2020 – current").scoreable, true);
  assert.equal(cvReadiness("Floor lead, Northwind Market\n2020 - currently hiring").scoreable, false);
});

test("a Skills or Education heading nested under Experience is not a role", () => {
  assert.equal(cvReadiness("## Experience\n### Skills\nScheduling").scoreable, false);
  assert.equal(cvReadiness("## Experience\n### Education\nNorthwind Community College").scoreable, false);
  assert.equal(cvReadiness("## Experience\n### Floor lead, Northwind Market").scoreable, true);
  assert.equal(cvReadiness("## Experience\n### Education Program Manager\nNorthwind Market").scoreable, true);
});

test("a word that only starts with a month name is not a range", () => {
  assert.equal(cvReadiness("Floor lead, Northwind Market\n2020 - marketing 2023").scoreable, false);
  assert.equal(cvReadiness("Floor lead, Northwind Market\n2020 - marzo 2023").scoreable, true);
});

test("a numeric end month outside 1-12 is not a range", () => {
  for (const range of ["2020 - 99/2023", "2020 - 13/2023", "2020 - 00/2023"]) {
    assert.equal(cvReadiness(`Floor lead, Northwind Market\n${range}`).scoreable, false, range);
  }
});

test("a markdown rule under experience is not a role", () => {
  for (const rule of ["---", "***", "___", "- - -"]) {
    assert.equal(cvReadiness(`## Experience\n${rule}\n## Skills\nScheduling`).scoreable, false, rule);
  }
  assert.equal(cvReadiness("## Experience\n---\nFloor lead, Northwind Market").scoreable, true);
});

const SECTIONS = [
  { heading: "## Your Target Roles", state: "filled" },
  { heading: "## Your Deal Breakers", state: "missing" },
];

test("compact first-run checklist counts the four setup files", () => {
  const compact = onboardingChecklist({ missing: ["cv.md", "modes/_profile.md", "config/profile.yml", "portals.yml"], sections: SECTIONS, compact: true });
  assert.equal(compact.showSections, false);
  assert.equal(compact.done, 0);
  assert.equal(compact.total, 4);
  const full = onboardingChecklist({ missing: [], sections: SECTIONS });
  assert.equal(full.showSections, true);
  assert.equal(full.done, 5);
  assert.equal(full.total, 6);
  assert.deepEqual(full.asks, ["my personalization (deal breakers)"]);
});

test("compact mode still asks for a missing personalization file", () => {
  const compact = onboardingChecklist({ missing: ["cv.md", "modes/_profile.md"], sections: SECTIONS, compact: true });
  assert.deepEqual(compact.asks, ["my CV", "my personalization file (modes/_profile.md)"]);
  // The full list asks through its sections line instead, not twice.
  const full = onboardingChecklist({ missing: ["modes/_profile.md"], sections: SECTIONS });
  assert.deepEqual(full.asks, ["my personalization (deal breakers)"]);
});

test("checklist prereq keys match the doctor list", () => {
  const doctor = readFileSync(join(root, "../doctor.mjs"), "utf8");
  const block = doctor.match(/const USER_LAYER_PREREQS = \[([\s\S]*?)\n\];/);
  assert.ok(block, "doctor.mjs still lists USER_LAYER_PREREQS");
  const paths = [...block[1].matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(PREREQS.map((item) => item.key), paths);
});

test("first-run home renders the compact checklist", () => {
  const home = readFileSync(join(root, "src/components/home/first-run-home.tsx"), "utf8");
  assert.match(home, /<OnboardingProgress compact/);
});
