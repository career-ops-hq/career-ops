import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

// Required core CI installs root dependencies only, without Next. Stub just
// its response adapter; exercise the actual save handler, core paths and files.
const frameworkAdapter = `data:text/javascript,${encodeURIComponent('export const NextResponse = { json: (body, init) => Response.json(body, init) };')}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: ${JSON.stringify(frameworkAdapter)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/runs/save/route.ts");

test("the actual run-log writer retains a gate's status, reason and confirmation guidance without a score", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-gated-run-log-"));
  const previousRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const body = { id: "fictional-gate", title: "Fictional evaluation", input: "https://example.invalid/role", status: "gated", gate: { reason: "agency_confirmation", message: "Confirm the intermediary before continuing.", confirmationRequired: true }, output: "Stopped before scoring." };
  const post = value => POST(new Request("http://fixture.invalid/api/runs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }));
  assert.equal((await post(body)).status, 200);
  const markdown = fs.readFileSync(path.join(root, ".career-ops-web/runs/fictional-gate.md"), "utf8");
  assert.match(markdown, /status: gated/);
  assert.match(markdown, /reason: agency_confirmation/);
  assert.match(markdown, /confirmation required: yes/);
  assert.match(markdown, /Confirm the intermediary before continuing\./);
  assert.doesNotMatch(markdown, /\d(?:\.\d+)?\/5/);
  assert.deepEqual(fs.readdirSync(root), [".career-ops-web"], "only the managed run log is written");

  assert.equal((await post({ id: "legacy-completed", result: { score: 4.2, summary: "Fictional score." }, output: "Completed evaluation." })).status, 200);
  assert.match(fs.readFileSync(path.join(root, ".career-ops-web/runs/legacy-completed.md"), "utf8"), /verdict: 4\.2\/5/);
});

test("malformed or scored stop metadata is rejected before creating a managed log", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-invalid-gate-log-"));
  const previousRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const gate = { reason: "dealbreaker", message: "Review the location rule.", confirmationRequired: true };
  for (const body of [
    { status: "gated" },
    { status: "gated", gate: { ...gate, reason: "unknown" } },
    { status: "gated", gate: { ...gate, message: "" } },
    { status: "gated", gate: { ...gate, confirmationRequired: "yes" } },
    { status: "gated", gate, result: { score: 4.2 } },
  ]) {
    const response = await POST(new Request("http://fixture.invalid/api/runs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "invalid-fixture", ...body }) }));
    assert.equal(response.status, 400);
    assert.deepEqual(fs.readdirSync(root), [], "invalid gate writes nothing");
  }
});
