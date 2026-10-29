import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

// Exercise the real request handler without discovering or spawning any AI CLI.
const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude" }, binPath: "/fixture/never-run" });
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `export function spawnHeadlessCli() { throw new Error("No AI process may start in an instruction-loading failure test"); }`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/run/route.ts");

for (const reason of ["missing file", "incomplete instructions"]) {
  test(`focused instruction ${reason} is logged server-side with a generic 422 response`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-focused-instruction-error-"));
    const previousRoot = process.env.CAREER_OPS_ROOT;
    process.env.CAREER_OPS_ROOT = root;
    t.after(() => {
      if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = previousRoot;
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, "modes"));
    fs.writeFileSync(path.join(root, "modes/oferta.md"), "# Fictional mode with missing required sections\n");
    if (reason === "incomplete instructions") {
      fs.mkdirSync(path.join(root, "batch"));
      fs.writeFileSync(path.join(root, "modes/_shared.md"), "# Fictional incomplete shared rules\n");
      fs.writeFileSync(path.join(root, "batch/batch-prompt.md"), "# Fictional incomplete schema\n");
    }
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const response = await POST(new Request("http://fixture.invalid/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/1", evaluationSections: ["summary"] }),
    }));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "Could not load the selected evaluation instructions. No AI run was started." });
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Failed to load focused evaluation instructions/);
    assert.ok(errors[0][1] instanceof Error);
    if (reason === "missing file") {
      assert.equal(errors[0][1].code, "ENOENT");
      assert.equal(errors[0][1].path, path.join(root, "modes/_shared.md"));
    } else assert.match(errors[0][1].message, /incomplete/);
  });
}
