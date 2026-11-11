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
export async function fillSession() {
  globalThis.__applyFixture.fillCalls += 1;
  return globalThis.__applyFixture.fillResult;
}
export async function handoffSession(id) {
  globalThis.__applyFixture.handoffCalls.push(id);
}
export async function finalizeDrivenSession() { return null; }
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
export async function verifyFill() { return globalThis.__applyFixture.verifyIssues; }
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
