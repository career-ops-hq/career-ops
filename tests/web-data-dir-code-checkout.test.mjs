import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
await import(pathToFileURL(path.join(REPO, "web/tests/helpers/web-ts-alias-loader.mjs")));

const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude", streamArgs: () => ["--print"], args: () => ["--print"], parseEvent: () => null }, binPath: "/fixture/never-run" }); export const cliSubstitutionNotice = () => null; export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `export function spawnHeadlessCli() { throw new Error("fixture reached spawn boundary"); }`;
const nextServerStub = `export class NextResponse extends Response { static json(body, init = {}) { return Response.json(body, init); } }`;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(specifier, context, nextResolve) { const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub, "next/server": nextServerStub })}; if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true }; return nextResolve(specifier, context); }`)}`, import.meta.url);

const { POST } = await import(pathToFileURL(path.join(REPO, "web/src/app/api/run/route.ts")));

test("/api/run accepts CAREER_OPS_DATA_DIR without CAREER_OPS_CODE_ROOT from the checkout root", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-5840-data-"));
  fs.writeFileSync(path.join(dataRoot, "cv.md"), "# Fixture candidate\n");
  const priorCwd = process.cwd();
  const saved = Object.fromEntries(["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_CODE_ROOT"].map((key) => [key, process.env[key]]));
  t.after(() => {
    process.chdir(priorCwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  process.chdir(REPO);
  delete process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_DATA_DIR = dataRoot;
  delete process.env.CAREER_OPS_CODE_ROOT;
  const response = await POST(new Request("http://fixture.invalid/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/1" }),
  }));
  const body = await response.json();

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.deepEqual(body, { error: "fixture reached spawn boundary" });
});
