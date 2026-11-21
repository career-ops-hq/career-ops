import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";

import "../helpers/web-ts-alias-loader.mjs";

const previousRoot = process.env.CAREER_OPS_ROOT;
const root = await mkdtemp(join(tmpdir(), "career-ops-application-kit-"));
const kitId = "kit-1";
const kitPath = join(root, "data", "application-kits", `${kitId}.json`);
const initialKit = {
  id: kitId,
  company: "Example Co",
  role: "Engineer",
  createdAt: "2026-11-18T00:00:00.000Z",
  appliedAt: null,
  fitSummary: "",
  matchScore: null,
  gaps: [],
  answers: [],
  coverLetter: "",
  tailoredCvMarkdown: "# CV",
  cvFile: "data/application-kits/kit-1-cv.md",
};

process.env.CAREER_OPS_ROOT = root;
const { PATCH, syncKitToTracker, writeAtomicBatch } = await import("../../src/app/api/application-kit/route.ts");

async function patch(body) {
  return PATCH(new Request("http://localhost/api/application-kit", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

before(async () => {
  await mkdir(join(root, "data", "application-kits"), { recursive: true });
  await writeFile(kitPath, `${JSON.stringify(initialKit, null, 2)}\n`);
});

after(() => {
  if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
  else process.env.CAREER_OPS_ROOT = previousRoot;
});

test("PATCH persists valid edits and leaves unsupported report conclusions absent", async () => {
  const response = await patch({
    id: kitId,
    coverLetter: "A truthful letter.",
    outreach: { postApplicationEmail: "Thanks for your time." },
    answers: [{ question: "Why?", answer: "Because", needsConfirmation: false }],
    cvFile: "data/application-kits/kit-1-cv.md",
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.kit.coverLetter, "A truthful letter.");
  assert.equal(data.kit.answers[0].answer, "Because");
  const report = await readFile(join(root, data.trackerInfo.reportLink), "utf8");
  assert.match(report, /score: null/);
  assert.doesNotMatch(report, /High Confidence|final_decision|Direct match based on candidate profile|PDF:/);
});

test("PATCH rejects malformed values without modifying the kit or tracker", async () => {
  const kitBefore = await readFile(kitPath, "utf8");
  const trackerPath = join(root, "data", "applications.md");
  const trackerBefore = await readFile(trackerPath, "utf8");
  const rejected = [
    { id: kitId, coverLetter: { text: "wrong" } },
    { id: kitId, outreach: { unexpected: "wrong" } },
    { id: kitId, answers: [{ question: "Why?", answer: 42 }] },
    { id: kitId, cvFile: "../../outside.md" },
    { id: kitId, coverLetter: "x".repeat(40_001) },
    { id: kitId, extra: true },
    { coverLetter: "missing id" },
  ];
  for (const body of rejected) {
    const response = await patch(body);
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    assert.equal(await readFile(kitPath, "utf8"), kitBefore);
    assert.equal(await readFile(trackerPath, "utf8"), trackerBefore);
  }
});

test("tracker preserves unrelated rows and separates roles at the same company", async () => {
  const trackerPath = join(root, "data", "applications.md");
  const unrelated = "| 8 | 2026-11-01 | Other Co | Other Role |  | Applied |  | reports/008.md | Keep this row |";
  const existingRole = "| 9 | 2026-11-02 | Example Co | Engineer |  |  |  | reports/009.md | Existing role |";
  await writeFile(trackerPath, `${unrelated}\n${existingRole}\n`);
  const secondKitPath = join(root, "data", "application-kits", "kit-2.json");
  await writeFile(secondKitPath, "{}\n");
  await syncKitToTracker({
    id: "kit-2",
    company: "Example Co",
    role: "Designer",
    appliedAt: "2026-11-18T00:00:00.000Z",
    matchScore: null,
  }, secondKitPath);
  const tracker = await readFile(trackerPath, "utf8");
  assert.match(tracker, /Other Co \| Other Role/);
  assert.match(tracker, /Example Co \| Designer/);
  assert.match(tracker, /Application kit: kit-2/);
  assert.match(tracker, /Example Co \| Engineer/);
});

test("ambiguous company and role matches fail without changing tracker data", async () => {
  const trackerPath = join(root, "data", "applications.md");
  const ambiguous = [
    "| 1 | 2026-11-01 | Same Co | Same Role |  |  |  | reports/001.md | first |",
    "| 2 | 2026-11-02 | Same Co | Same Role |  |  |  | reports/002.md | second |",
  ].join("\n") + "\n";
  await writeFile(trackerPath, ambiguous);
  const before = await readFile(trackerPath, "utf8");
  await assert.rejects(
    syncKitToTracker({ id: "kit-ambiguous", company: "Same Co", role: "Same Role", appliedAt: "2026-11-18" }),
    /Ambiguous company and role match/,
  );
  assert.equal(await readFile(trackerPath, "utf8"), before);
});

test("special characters are serialized safely and model conclusions are omitted", async () => {
  const trackerPath = join(root, "data", "applications.md");
  await writeFile(trackerPath, "");
  const result = await syncKitToTracker({
    id: "kit-special",
    company: 'Acme: "quoted"\nInjected',
    role: "Role | Special",
    fitSummary: "High Confidence\nfinal_decision: Apply",
    appliedAt: "2026-11-18",
  });
  const report = await readFile(join(root, result.reportLink), "utf8");
  const yamlBlock = report.match(/```yaml\n([\s\S]*?)\n```/)?.[1];
  assert.ok(yamlBlock);
  const summary = yaml.load(yamlBlock);
  assert.equal(summary.company, 'Acme: "quoted" Injected');
  assert.equal(summary.role, "Role Special");
  assert.equal(summary.score, null);
  assert.doesNotMatch(report, /High Confidence|final_decision|Apply/);
});

test("atomic batch restores earlier files after report or tracker write failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "career-ops-atomic-"));
  const report = join(dir, "report.md");
  const tracker = join(dir, "applications.md");
  const kit = join(dir, "kit.json");
  const original = new Map([[report, "old report"], [tracker, "old tracker"], [kit, "old kit"]]);
  for (const [file, content] of original) writeFileSync(file, content);

  const failingWriter = (file, content) => {
    writeFileSync(file, content);
    if (file === report || file === tracker) throw new Error(`write failed: ${file}`);
    return null;
  };
  for (const failedPath of [report, tracker]) {
    assert.throws(() => writeAtomicBatch([
      { path: report, content: "new report" },
      { path: tracker, content: "new tracker" },
      { path: kit, content: "new kit" },
    ], (file, content) => {
      writeFileSync(file, content);
      if (file === failedPath) throw new Error("injected failure");
      return null;
    }), /injected failure/);
    for (const [file, content] of original) assert.equal(readFileSync(file, "utf8"), content);
  }
  assert.throws(() => writeAtomicBatch([{ path: report, content: "new report" }], failingWriter), /write failed/);
  assert.equal(readFileSync(report, "utf8"), "old report");
});
