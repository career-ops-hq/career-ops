import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readCareerMasterProfile,
  saveCareerMasterProfile,
} from "../../src/lib/career-profile-store.mjs";
import {
  listCvVersions,
  readActiveCv,
  restoreCvVersion,
  saveCvVersion,
  validateCvImport,
} from "../../src/lib/cv-version-store.mjs";
import { analyzeAtsReadiness } from "../../src/lib/ats-foundation.mjs";

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "career-pilot-phase1-"));
  await writeFile(
    path.join(root, "profile-seed.yml"),
    "candidate:\n  full_name: Existing Name\nunknown_extension:\n  keep_me: true\n",
    "utf8",
  );
  return root;
}

test("Career Master Profile reads sparse legacy profiles", async () => {
  const root = await fixtureRoot();
  const profile = await readCareerMasterProfile(root, { profileFile: "profile-seed.yml" });
  assert.equal(profile.fullName, "Existing Name");
  assert.deepEqual(profile.targetRoles, []);
  assert.deepEqual(profile.skills, []);
});

test("Career Master Profile preserves unknown configuration and stores private data securely", async () => {
  const root = await fixtureRoot();
  const seed = await readFile(path.join(root, "profile-seed.yml"), "utf8");
  await writeFile(path.join(root, "config.yml"), seed, "utf8");

  const saved = await saveCareerMasterProfile(root, {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+46 70 123 45 67",
    location: "Stockholm",
    linkedin: "https://linkedin.com/in/ada",
    portfolioUrl: "https://ada.example",
    headline: "AI systems leader",
    summary: "Builds reliable applied AI systems.",
    targetRoles: ["Staff AI Engineer", "AI Architect"],
    skills: ["TypeScript", "Python", "LLM systems"],
  }, { profileFile: "config.yml" });

  assert.equal(saved.fullName, "Ada Lovelace");
  assert.deepEqual(saved.targetRoles, ["Staff AI Engineer", "AI Architect"]);
  assert.deepEqual(saved.skills, ["TypeScript", "Python", "LLM systems"]);

  const raw = await readFile(path.join(root, "config.yml"), "utf8");
  assert.match(raw, /keep_me: true/);
  assert.match(raw, /full_name: Ada Lovelace/);
  assert.equal((await stat(path.join(root, "config.yml"))).mode & 0o777, 0o600);

  const loaded = await readCareerMasterProfile(root, { profileFile: "config.yml" });
  assert.equal(loaded.summary, "Builds reliable applied AI systems.");
});

test("CV imports create immutable versions and an older version can be restored", async () => {
  const root = await fixtureRoot();
  const first = await saveCvVersion(root, {
    content: "# Ada Lovelace\n\n## Summary\nAnalytical engine pioneer.",
    source: "import",
    label: "Original CV",
  });
  const second = await saveCvVersion(root, {
    content: "# Ada Lovelace\n\n## Summary\nAI systems leader.\n\n## Experience\n- Built reliable systems.",
    source: "editor",
    label: "AI version",
  });

  assert.notEqual(first.id, second.id);
  assert.equal((await listCvVersions(root)).length, 2);
  assert.match(await readActiveCv(root), /AI systems leader/);

  await restoreCvVersion(root, first.id);
  assert.match(await readActiveCv(root), /Analytical engine pioneer/);
  assert.equal((await listCvVersions(root)).length, 3, "restore creates an audit version");
  assert.equal((await stat(path.join(root, "cv.md"))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(root, "data", "cv-versions"))).mode & 0o777, 0o700);
});

test("CV import validation rejects unsafe formats and oversized uploads", () => {
  assert.deepEqual(validateCvImport({ name: "cv.md", size: 1200 }), {
    extension: ".md",
    kind: "text",
  });
  assert.deepEqual(validateCvImport({ name: "cv.pdf", size: 2400 }), {
    extension: ".pdf",
    kind: "document",
  });
  assert.throws(() => validateCvImport({ name: "cv.exe", size: 1200 }), /filformat/i);
  assert.throws(
    () => validateCvImport({ name: "cv.pdf", size: 10 * 1024 * 1024 + 1 }),
    /10 MB/i,
  );
});

test("ATS foundation scores structure and job keyword coverage deterministically", () => {
  const cv = `# Ada Lovelace

## Summary
Staff AI engineer building reliable LLM systems.

## Experience
- Led TypeScript and Python platform delivery, improving latency by 40%.
- Built production AI evaluation pipelines for cloud services.

## Skills
TypeScript, Python, LLM systems, cloud architecture

## Education
BSc Computer Science
`;
  const result = analyzeAtsReadiness(cv, {
    jobDescription: "Staff AI Engineer with Python, TypeScript, cloud architecture and Kubernetes",
  });

  assert.ok(result.score >= 70, `expected ATS score >= 70, got ${result.score}`);
  assert.ok(result.keywordMatch.score > 50);
  assert.ok(result.keywordMatch.matched.includes("python"));
  assert.ok(result.keywordMatch.missing.includes("kubernetes"));
  assert.equal(result.sections.experience, true);
  assert.equal(result.sections.skills, true);
  assert.ok(result.recommendations.some((item) => item.toLowerCase().includes("kubernetes")));
});
