// The review screen and the fill route are what the person can see: a green
// "pre-filled" banner, a resume claim, and an employer window. These read the
// source the page ships, so a rewrite that puts the old promise back fails here.
//
// Run: node --test tests/lib/apply-handoff-wiring.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const src = join(dirname(fileURLToPath(import.meta.url)), "../../src");

test("a finished agent drive drops the previous read-back before merging gaps", () => {
  const provider = readFileSync(join(src, "components/apply/apply-provider.tsx"), "utf8");
  const agent = provider.slice(provider.indexOf("const agentFill"));
  assert.match(agent, /withoutReadbackIssues\(prev\)/);
  assert.match(agent, /issuesAfterAgent\(/);
});

test("the review screen does not promise a CV from the field label alone", () => {
  const view = readFileSync(join(src, "components/apply-view.tsx"), "utf8");
  assert.match(view, /resumeFieldNotice\(/);
  assert.doesNotMatch(view, /will be attached automatically/);
});

test("the fill route holds the employer window when the handoff gate refuses", () => {
  const route = readFileSync(join(src, "app/api/apply/fill/route.ts"), "utf8");
  assert.match(route, /handoffDecision\(/);
  assert.match(route, /decision\.handoff/);
});

test("a finished fill is not marked pre-filled unless the server handed the window over", () => {
  const provider = readFileSync(join(src, "components/apply/apply-provider.tsx"), "utf8");
  assert.match(provider, /if \(d\.handedOff\)/);
});

const sessionStub = `
export function getSession() { return globalThis.__applyFixture.session; }
export async function fillSession(id, answers, fields, cvPath, cvUploadName, readbackAnswers) {
  globalThis.__applyFixture.fillCalls += 1;
  globalThis.__applyFixture.fillAnswers = answers;
  globalThis.__applyFixture.readbackAnswers = readbackAnswers;
  return globalThis.__applyFixture.fillResult;
}
export async function handoffSession(id) {
  globalThis.__applyFixture.handoffCalls.push(id);
}
export async function finalizeDrivenSession() {
  const fixture = globalThis.__applyFixture;
  fixture.finalizeCalls = (fixture.finalizeCalls || 0) + 1;
  if (fixture.finalizeResult === null) return null;
  if (fixture.finalFields) fixture.session.fields = fixture.finalFields;
  return { title: fixture.session.title, fields: fixture.session.fields, issues: fixture.finalizeIssues || [] };
}
export async function extractCurrent() { return { form: {} }; }
export function isApplicationFormFn() { return true; }
`;
const cvStub = `
export async function resolveSessionCv() {
  if (globalThis.__applyFixture.cvThrow) throw new Error(globalThis.__applyFixture.cvThrow);
  return globalThis.__applyFixture.cvPath;
}
export function uploadNameForCv() { return "Fixture-Candidate.pdf"; }
`;
const driveStub = `
export async function driveSession() { return globalThis.__applyFixture.driveResult; }
`;
const diagnoseStub = `
export async function verifyFill(frame, fields, answers) {
  globalThis.__applyFixture.verifyAnswers = answers;
  return globalThis.__applyFixture.verifyIssues;
}
export async function classifyEmpty() { return { message: "fixture" }; }
`;
const cliStub = `
export function resolveCliOrFallback() { return { spec: { id: "claude" } }; }
`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({
      "@/lib/apply/session": sessionStub,
      "@/lib/apply/cv": cvStub,
      "@/lib/apply/drive": driveStub,
      "@/lib/apply/diagnose": diagnoseStub,
      "@/lib/clis": cliStub,
    })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const { POST: fillPost } = await import("../../src/app/api/apply/fill/route.ts");
const { POST: drivePost } = await import("../../src/app/api/apply/drive/route.ts");

function resetFixture(over = {}) {
  globalThis.__applyFixture = {
    handoffCalls: [],
    fillCalls: 0,
    cvPath: null,
    cvThrow: "",
    fillResult: { steps: [], issues: [] },
    verifyIssues: [],
    driveResult: { reached: true, turns: 1, reason: "reached", steps: [] },
    session: {
      id: "sess-1",
      title: "Role at Fixture",
      url: "https://jobs.example.test/apply",
      page: {},
      frame: {},
      fields: [],
    },
    ...over,
  };
}

async function postFill(body) {
  const response = await fillPost(new Request("http://fixture.invalid/api/apply/fill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-1", handoff: true, ...body }),
  }));
  assert.equal(response.status, 200);
  return response.json();
}

async function postDrive(body) {
  const response = await drivePost(new Request("http://fixture.invalid/api/apply/drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-1", goal: "full", ...body }),
  }));
  assert.equal(response.status, 200);
  const text = await response.text();
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("the fill route does not hand off a blank required screening answer", async () => {
  resetFixture();
  const body = await postFill({
    answers: { visa: "  " },
    fields: [{ id: "visa", type: "text", label: "Will you require visa sponsorship?", required: true }],
  });
  assert.equal(body.handedOff, false);
  assert.deepEqual(globalThis.__applyFixture.handoffCalls, []);
});

test("the fill route does not hand off when a required résumé is missing", async () => {
  resetFixture();
  const body = await postFill({
    answers: {},
    fields: [{ id: "cv", type: "file", label: "Resume/CV", required: true }],
  });
  assert.equal(body.handedOff, false);
  assert.deepEqual(globalThis.__applyFixture.handoffCalls, []);
});

test("the fill route hands off an answered screening question", async () => {
  resetFixture();
  const body = await postFill({
    answers: { visa: "No" },
    fields: [{ id: "visa", type: "text", label: "Will you require visa sponsorship?", required: true }],
  });
  assert.equal(body.handedOff, true);
  assert.deepEqual(globalThis.__applyFixture.handoffCalls, ["sess-1"]);
});

test("a résumé resolve failure still blocks a required résumé and reports the error", async () => {
  resetFixture({ cvThrow: "reports directory is unreadable" });
  globalThis.__applyFixture.session.fields = [{ id: "cv", type: "file", label: "Resume/CV", required: true }];
  const done = (await postDrive({ answers: [] })).find((event) => event.t === "done");
  assert.equal(done.filled, false);
  assert.ok(done.gaps.some((gap) => gap.message === "reports directory is unreadable"));
  assert.equal(globalThis.__applyFixture.handoffCalls.length, 0);
  assert.equal(globalThis.__applyFixture.fillCalls, 0);
});

test("a résumé resolve failure still hands off an optional résumé with no other gap", async () => {
  resetFixture({ cvThrow: "reports directory is unreadable" });
  globalThis.__applyFixture.session.fields = [{ id: "cv", type: "file", label: "Resume/CV", required: false }];
  const done = (await postDrive({ answers: [] })).find((event) => event.t === "done");
  assert.equal(done.filled, true);
  assert.ok(done.gaps.some((gap) => gap.message === "reports directory is unreadable"));
  assert.deepEqual(globalThis.__applyFixture.handoffCalls, ["sess-1"]);
});

test("a résumé resolve failure does not skip a blank required screening answer", async () => {
  resetFixture({ cvThrow: "reports directory is unreadable" });
  globalThis.__applyFixture.session.fields = [{ id: "visa", type: "text", label: "Will you require visa sponsorship?", required: true }];
  const done = (await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "" }],
  })).find((event) => event.t === "done");
  assert.equal(done.filled, false);
  assert.ok(done.gaps.some((gap) => /sponsorship question is still empty/.test(gap.message)));
  assert.ok(done.gaps.some((gap) => gap.message === "reports directory is unreadable"));
  assert.equal(globalThis.__applyFixture.handoffCalls.length, 0);
});

test("a resolved résumé that did not attach still blocks the handoff", async () => {
  resetFixture({
    cvPath: "/tmp/fixture-cv.pdf",
    fillResult: { steps: [{ fieldId: "cv", ok: false }], issues: [] },
  });
  globalThis.__applyFixture.session.fields = [{ id: "cv", type: "file", label: "Resume/CV", required: false }];
  const done = (await postDrive({ answers: [] })).find((event) => event.t === "done");
  assert.equal(done.filled, false);
  assert.equal(globalThis.__applyFixture.handoffCalls.length, 0);
  assert.equal(globalThis.__applyFixture.fillCalls, 1);
});

test("drive read-back compares the agent's answers and does not type them again", async () => {
  resetFixture({ cvPath: "/tmp/fixture-cv.pdf" });
  globalThis.__applyFixture.session.fields = [
    { id: "visa", type: "radio", label: "Will you require visa sponsorship?", required: true },
  ];
  await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "No" }],
  });
  assert.equal(globalThis.__applyFixture.fillCalls, 1);
  assert.deepEqual(globalThis.__applyFixture.fillAnswers, {});
  assert.deepEqual(globalThis.__applyFixture.readbackAnswers, { visa: "No" });
});

test("drive read-back uses the agent's answers when no résumé is attached", async () => {
  resetFixture();
  globalThis.__applyFixture.session.fields = [
    { id: "visa", type: "radio", label: "Will you require visa sponsorship?", required: true },
  ];
  await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "No" }],
  });
  assert.equal(globalThis.__applyFixture.fillCalls, 0);
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, { visa: "No" });
});

test("a wrong radio on the drive path stays in the done gaps", async () => {
  resetFixture();
  globalThis.__applyFixture.session.fields = [
    { id: "visa", type: "radio", label: "Will you require visa sponsorship?", required: true },
  ];
  globalThis.__applyFixture.verifyIssues = [
    { level: "warn", code: "fill-mismatch", message: "These answers didn't seem to land on the real form — check them: Will you require visa sponsorship?." },
  ];
  const done = (await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "Yes" }],
  })).find((event) => event.t === "done");
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, { visa: "Yes" });
  assert.ok(done.gaps.some((gap) => gap.code === "fill-mismatch"));
});

test("drive read-back uses the fields on the page the agent reached", async () => {
  resetFixture({
    finalFields: [{ id: "office", type: "select", label: "Office", required: true }],
  });
  globalThis.__applyFixture.session.fields = [];
  const done = (await postDrive({
    answers: [{ id: "office", label: "Office", value: "Springfield" }],
  })).find((event) => event.t === "done");
  assert.equal(globalThis.__applyFixture.finalizeCalls, 1);
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, { office: "Springfield" });
  assert.equal(done.filled, true);
});

test("a drive that cannot re-read the form does not check the old fields", async () => {
  resetFixture({ finalizeResult: null });
  globalThis.__applyFixture.session.fields = [
    { id: "visa", type: "radio", label: "Will you require visa sponsorship?", required: true },
  ];
  const done = (await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "No" }],
  })).find((event) => event.t === "done");
  assert.equal(done.filled, false);
  assert.ok(done.gaps.some((gap) => gap.code === "fill-unverified"));
  assert.equal(globalThis.__applyFixture.fillCalls, 0);
  assert.equal(globalThis.__applyFixture.verifyAnswers, undefined);
});

test("drive read-back does not reuse a positional id after the form changes", async () => {
  resetFixture({
    finalFields: [
      { id: "co0", type: "text", label: "Department", nativeId: "dept" },
      { id: "co1", type: "text", label: "Name", nativeId: "name" },
      { id: "co2", type: "select", label: "Office", nativeId: "office", required: true },
    ],
  });
  globalThis.__applyFixture.session.fields = [
    { id: "co0", type: "text", label: "Name", nativeId: "name" },
    { id: "co1", type: "select", label: "Office", nativeId: "office", required: true },
  ];
  const done = (await postDrive({
    answers: [
      { id: "co0", label: "Name", value: "Ada" },
      { id: "co1", label: "Office", value: "Springfield" },
    ],
  })).find((event) => event.t === "done");
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, { co1: "Ada", co2: "Springfield" });
  assert.equal(done.filled, true);
});

test("a dropped answer is unverified on the drive result", async () => {
  resetFixture({
    finalFields: [
      { id: "co0", type: "text", label: "Team" },
      { id: "co1", type: "text", label: "Phone" },
      { id: "co2", type: "text", label: "Phone" },
    ],
  });
  globalThis.__applyFixture.session.fields = [
    { id: "co0", type: "text", label: "Phone" },
    { id: "co1", type: "text", label: "Phone" },
  ];
  const done = (await postDrive({
    answers: [
      { id: "co0", label: "Phone", value: "111" },
      { id: "co1", label: "Phone", value: "222" },
    ],
  })).find((event) => event.t === "done");
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, {});
  assert.equal(done.filled, true);
  assert.ok(done.gaps.some((gap) => gap.code === "fill-unverified" && gap.message.includes("Phone")));
});

test("drive read-back follows a swapped control by its DOM id", async () => {
  resetFixture({
    finalFields: [
      { id: "co0", type: "tel", label: "Phone", nativeId: "mobile" },
      { id: "co1", type: "tel", label: "Phone", nativeId: "home" },
    ],
  });
  globalThis.__applyFixture.session.fields = [
    { id: "co0", type: "tel", label: "Phone", nativeId: "home" },
    { id: "co1", type: "tel", label: "Phone", nativeId: "mobile" },
  ];
  await postDrive({
    answers: [
      { id: "co0", label: "Phone", value: "111" },
      { id: "co1", label: "Phone", value: "222" },
    ],
  });
  assert.deepEqual(globalThis.__applyFixture.verifyAnswers, { co0: "222", co1: "111" });
});

test("every dropped answer is named on the drive result", async () => {
  const names = ["City", "State", "Country", "Postal", "Street"];
  resetFixture({ finalFields: [{ id: "co0", type: "text", label: "Team" }] });
  globalThis.__applyFixture.session.fields = [];
  const done = (await postDrive({
    answers: names.map((label, index) => ({ id: `old${index}`, label, value: "x" })),
  })).find((event) => event.t === "done");
  const gap = done.gaps.find((item) => item.code === "fill-unverified");
  assert.ok(gap);
  for (const name of names) assert.match(gap.message, new RegExp(name));
  assert.equal(gap.message.includes("…"), false);
});

test("a full drive keeps the fencing warning from finalization", async () => {
  resetFixture({
    finalizeIssues: [{ level: "warn", code: "cli-unfenced", message: "This CLI read the form without verified fencing." }],
  });
  globalThis.__applyFixture.session.fields = [
    { id: "visa", type: "radio", label: "Will you require visa sponsorship?", required: true },
  ];
  const done = (await postDrive({
    answers: [{ id: "visa", label: "Will you require visa sponsorship?", value: "No" }],
  })).find((event) => event.t === "done");
  assert.ok(done.gaps.some((gap) => gap.code === "cli-unfenced"));
  assert.equal(done.filled, true);
});
