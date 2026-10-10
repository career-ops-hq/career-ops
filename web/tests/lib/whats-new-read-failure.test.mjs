// A broken scan history must not read as "no new matches".
//
// /api/whats-new used one bare catch for every read failure:
//
//   try { rows = fs.readFileSync(...scan-history.tsv...) }
//   catch { return Response.json({ offers: [], count: 0 }) }
//
// ENOENT is the only failure that legitimately means an empty result — a user
// who has never scanned has no history. Every other failure means the file is
// BROKEN, and answering 200 with an empty payload made that indistinguishable
// from a quiet week. The home hero then settles both loops and can say "You're
// all caught up" off a file it could not open, which is the exact overclaim
// lib/home/hero-state.mjs exists to prevent, arriving one layer lower.
//
// Driven for real rather than asserted from the source: the handler is
// importable under the @/ loader, so the two cases can be distinguished by
// their actual status codes. Each runs in its own child because the loader
// registers process-wide and CAREER_OPS_ROOT is read at module load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// A file:// URL, not a bare path. `--import` takes a module SPECIFIER, and on
// Windows an absolute path begins with a drive letter — Node reads `D:` as a
// URL scheme and throws ERR_UNSUPPORTED_ESM_URL_SCHEME. POSIX happens to
// tolerate the path form, so the bug is invisible until CI runs on Windows.
// web-ts-alias-loader.test.mjs already does this; I did not copy it.
const LOADER = pathToFileURL(join(WEB, "tests", "helpers", "web-ts-alias-loader.mjs")).href;

const DRIVER = `
const { GET } = await import("@/app/api/whats-new/route.ts");
const res = await GET(new Request("http://localhost/api/whats-new"));
console.log(JSON.stringify({ status: res.status, body: await res.json() }));
`;

const roots = [];
function makeRoot(prepare) {
  const dir = mkdtempSync(join(tmpdir(), "co-whatsnew-"));
  roots.push(dir);
  mkdirSync(join(dir, "data"), { recursive: true });
  prepare?.(dir);
  return dir;
}

/** The handler's answer, from a child with the alias loader registered. */
function callRoute(root) {
  const driver = join(root, "driver.mjs");
  writeFileSync(driver, DRIVER);
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--import", LOADER, driver],
    {
      cwd: WEB,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        // Would each pull a read back out of the sandbox and make the result
        // depend on the developer's own files.
        CAREER_OPS_DATA_DIR: "",
        CAREER_OPS_TRACKER: "",
      },
    },
  );
  // The loader prints deprecation notices to stderr; the payload is the last
  // stdout line, so a future warning cannot break the parse.
  const line = out.trim().split("\n").filter(Boolean).at(-1);
  return JSON.parse(line);
}

test("no history at all is an empty week, not an error", () => {
  // The legitimate empty: nothing has ever been scanned. This is the case the
  // original bare catch was written for, and it must keep working — turning it
  // into an error would put a red panel in front of every new user.
  const res = callRoute(makeRoot());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { offers: [], count: 0 });
});

test("a scan history that cannot be read is reported, not emptied", () => {
  // A directory where the file should be: readFileSync throws EISDIR, which is
  // the file being broken rather than absent. Chosen over chmod 000 because it
  // reproduces as a non-root user and on every platform the suite runs on.
  const res = callRoute(makeRoot((dir) => mkdirSync(join(dir, "data", "scan-history.tsv"))));

  assert.notEqual(res.status, 200, "a failed read must not answer 200 — that is what made it look like an empty week");
  assert.equal(res.status, 500);
  // The message has to name the cause: "something went wrong" would leave the
  // user with a broken file and no way to find out which or why.
  assert.match(res.body.error ?? "", /scan history could not be read/i);
  assert.match(res.body.error ?? "", /EISDIR/);
  // The shape stays intact so a client that renders the payload regardless
  // cannot crash on a missing array.
  assert.deepEqual(res.body.offers, []);
  assert.equal(res.body.count, 0);
});

test("the dashboard rejects the failure response", () => {
  // The fix is only worth anything if the caller acts on it. today-dashboard's
  // refetch() throws on !r.ok, so a 500 sets freshError, and hero-state then
  // refuses all-clear. Asserted here because the status code is the contract
  // between the two halves: a route that reported the failure as 200 with an
  // `error` key would satisfy the test above and change nothing upstream.
  const res = callRoute(makeRoot((dir) => mkdirSync(join(dir, "data", "scan-history.tsv"))));
  const ok = res.status >= 200 && res.status < 300;
  assert.equal(ok, false, "r.ok must be false, or refetch() treats a broken file as fresh data");
});

process.on("exit", () => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
