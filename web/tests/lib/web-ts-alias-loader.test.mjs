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
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "..");
// A file:// URL, not the path: an absolute path is only a usable ESM specifier
// where it starts with "/". On Windows it starts with a drive letter, which
// Node reads as a URL scheme ("d:") and refuses. See the file:// URL test below.
const LOADER = pathToFileURL(path.join(HERE, "..", "helpers", "web-ts-alias-loader.mjs")).href;

/** Run one ESM snippet in a fresh Node process. Never throws; reports the failure. */
function run(src, flags = []) {
  try {
    return { ok: true, out: execFileSync(process.execPath, [...flags, "--input-type=module", "-e", src], {
      cwd: WEB, encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim(), err: (e.stderr || "").toString() };
  }
}

// web/package.json allows Node >=22 (the floor `node --test` glob discovery
// needs), but four cases below reach a .ts module, and that needs type
// stripping on top: added behind --experimental-strip-types in 22.6, on by
// default only from 22.18. On 22.0-22.17 the child dies with
// ERR_UNKNOWN_FILE_EXTENSION before resolve() is ever consulted, so those four
// would fail for a reason that has nothing to do with the hook they test.
//
// Skip rather than raise the floor: web/'s engines governs the Next.js app, not
// just this suite, and apply-planner-fencing.test.mjs and
// apply-agent-interpret-fencing.test.mjs already take exactly this stance for
// the same reason. Passing --experimental-strip-types to the child instead
// would not rescue 22.0-22.5, where the flag does not yet exist. CI runs 24.
const skipTs = !process.features?.typescript
  && "this Node cannot import a .ts module (type stripping is on by default only from 22.18)";

const IMPORT_LOADER = `await import(${JSON.stringify(LOADER)});`;

test("CONTROL: without the loader, an @/ specifier fails to resolve", { skip: skipTs }, () => {
  // If this ever passes, every other assertion in this file is vacuous — the
  // alias would already be resolving and the hook would be doing nothing.
  const r = run(`await import("./src/lib/apply/cv.ts"); console.log("LOADED");`);
  assert.equal(r.ok, false, "an @/-importing module must NOT load without the hook");
  assert.match(r.err, /ERR_MODULE_NOT_FOUND/, "expected the alias to be the reason it failed");
  assert.match(r.err, /@\/lib/, "expected the unresolved specifier to be the @/ alias");
});

test("with the loader, a TS module reached through @/ loads", { skip: skipTs }, () => {
  const r = run(`${IMPORT_LOADER}
    const m = await import("./src/lib/apply/cv.ts");
    console.log(typeof m.resolveTailoredCv);`);
  assert.equal(r.ok, true, `expected the aliased import to succeed:\n${r.err}`);
  assert.equal(r.out, "function");
});

test("an extensionless @/ specifier resolves .ts", { skip: skipTs }, () => {
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

test("importing the loader twice still resolves, and leaves its flag set", { skip: skipTs }, () => {
  // Named for what it measures. It is NOT evidence that the hook registered
  // once: ESM caches this module, so the second import never re-runs its body,
  // and the flag it reads is set in this realm whether or not the loader realm
  // registered again on its own.
  const r = run(`${IMPORT_LOADER}${IMPORT_LOADER}
    const m = await import("@/lib/career-ops");
    console.log(globalThis.__careerOpsWebAliasRegistered === true, typeof m.careerOpsRoot);`);
  assert.equal(r.ok, true, `a second import must not break resolution:\n${r.err}`);
  assert.equal(r.out, "true function");
});

test("the hook is injected as a file:// URL, not a bare absolute path", () => {
  // POSITIVE CONTROL, so this is not a vacuous string check: an absolute path
  // is only importable where it starts with "/". A Windows one does not — Node
  // parses "D:\…" as protocol "d:" and refuses it, on every platform.
  const control = run(`await import(${JSON.stringify("D:\\tmp\\hook.mjs")});`);
  assert.equal(control.ok, false, "a drive-letter path must not be importable");
  assert.match(control.err, /ERR_UNSUPPORTED_ESM_URL_SCHEME/);

  // So every case above, which installs the hook by handing its path to a child
  // as a specifier, fails on Windows and only on Windows — POSIX resolves the
  // same construction because its absolute paths happen to be valid URL paths.
  assert.match(
    IMPORT_LOADER,
    /^await import\("file:\/\//,
    `the hook must reach the child as a file:// URL; got: ${IMPORT_LOADER}`,
  );
});

test("the .ts skip gate keys on the signal that actually predicts the failure", { skip: skipTs }, () => {
  // POSITIVE CONTROL for skipTs. Without it the gate is an assumption: the four
  // cases above would keep passing here and nothing would notice if the
  // predicate drifted away from the behaviour it stands for.
  //
  // --no-experimental-strip-types makes this Node behave like 22.0-22.17, so
  // both halves are measured on one runtime rather than argued from version
  // numbers. Skipped on a Node that has no stripping to turn off — there the
  // condition is not simulated, it is the live one.
  const OFF = ["--no-experimental-strip-types"];

  const predicate = run(`console.log(Boolean(process.features?.typescript));`, OFF);
  assert.equal(predicate.ok, true, `expected the probe to run:\n${predicate.err}`);
  assert.equal(predicate.out, "false", "skipTs reads process.features.typescript — it must go false here");

  const r = run(`${IMPORT_LOADER} await import("@/lib/career-ops");`, OFF);
  assert.equal(r.ok, false, "a .ts import must fail where types cannot be stripped");
  assert.match(r.err, /ERR_UNKNOWN_FILE_EXTENSION/, "and fail for that reason, before resolve() matters");
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
