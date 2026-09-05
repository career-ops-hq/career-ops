/**
 * web-ts-alias-loader.test.mjs — the resolver hook that teaches `node --test` to
 * follow the `@/…` import alias.
 *
 * web/tsconfig.json maps `"@/*" -> "./src/*"`, which webpack and SWC understand
 * natively and Node does not. Node 22 type-strips `.ts` on import, so the only
 * thing standing between `node --test` and a TS module under web/src is
 * SPECIFIER RESOLUTION — and without it the import fails as
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`, which reads in CI exactly
 * like a test that ran and passed nothing.
 *
 * Every assertion here runs in a CHILD process. The hook installs itself
 * globally and cannot be uninstalled, so an in-process "without the loader"
 * control would be contaminated by any earlier test that registered it — the
 * control would pass for the wrong reason and prove nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "..");
const LOADER = path.join(HERE, "..", "helpers", "web-ts-alias-loader.mjs");

/** Run one ESM snippet in a fresh Node process. Never throws; reports the failure. */
function run(src) {
  try {
    return { ok: true, out: execFileSync(process.execPath, ["--input-type=module", "-e", src], {
      cwd: WEB, encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim(), err: (e.stderr || "").toString() };
  }
}

const IMPORT_LOADER = `await import(${JSON.stringify(LOADER)});`;

test("CONTROL: without the loader, an @/ specifier fails to resolve", () => {
  // If this ever passes, every other assertion in this file is vacuous — the
  // alias would already be resolving and the hook would be doing nothing.
  const r = run(`await import("./src/lib/apply/cv.ts"); console.log("LOADED");`);
  assert.equal(r.ok, false, "an @/-importing module must NOT load without the hook");
  assert.match(r.err, /ERR_MODULE_NOT_FOUND/, "expected the alias to be the reason it failed");
  assert.match(r.err, /@\/lib/, "expected the unresolved specifier to be the @/ alias");
});

test("with the loader, a TS module reached through @/ loads", () => {
  const r = run(`${IMPORT_LOADER}
    const m = await import("./src/lib/apply/cv.ts");
    console.log(typeof m.resolveTailoredCv);`);
  assert.equal(r.ok, true, `expected the aliased import to succeed:\n${r.err}`);
  assert.equal(r.out, "function");
});

test("an extensionless @/ specifier resolves .ts", () => {
  const r = run(`${IMPORT_LOADER}
    const m = await import("@/lib/career-ops");
    console.log(typeof m.careerOpsRoot);`);
  assert.equal(r.ok, true, `expected @/lib/career-ops to resolve to the .ts file:\n${r.err}`);
  assert.equal(r.out, "function");
});

test("a @/ specifier that already names an extension is used as-is", () => {
  const r = run(`${IMPORT_LOADER}
    const m = await import("@/lib/company-slug.mjs");
    console.log(typeof m.companySlug);`);
  assert.equal(r.ok, true, `expected an explicit .mjs extension to pass through:\n${r.err}`);
  assert.equal(r.out, "function");
});

test("a non-@/ specifier is left to Node", () => {
  // The hook must be a no-op for everything else, or it becomes a resolution
  // bug that only shows up in tests.
  const r = run(`${IMPORT_LOADER}
    const p = await import("node:path");
    const rel = await import("./src/lib/company-slug.mjs");
    console.log(typeof p.join, typeof rel.companySlug);`);
  assert.equal(r.ok, true, `bare and relative specifiers must still resolve:\n${r.err}`);
  assert.equal(r.out, "function function");
});

test("importing the loader twice registers the hook once", () => {
  // register() re-imports the module in a separate realm; without the guard a
  // second import stacks another resolver.
  const r = run(`${IMPORT_LOADER}${IMPORT_LOADER}
    const m = await import("@/lib/career-ops");
    console.log(globalThis.__careerOpsWebAliasRegistered === true, typeof m.careerOpsRoot);`);
  assert.equal(r.ok, true, `a second import must not break resolution:\n${r.err}`);
  assert.equal(r.out, "true function");
});

test("an unresolvable @/ specifier still reports the alias it could not find", () => {
  // Falling back to the first candidate keeps Node's own error message useful:
  // a silent nextResolve() on the raw specifier would blame '@/lib' instead of
  // naming the file that is actually missing.
  const r = run(`${IMPORT_LOADER}
    await import("@/lib/definitely-not-a-real-module");`);
  assert.equal(r.ok, false, "a missing aliased module must still fail");
  assert.match(r.err, /definitely-not-a-real-module/, "the error must name the missing module");
});
