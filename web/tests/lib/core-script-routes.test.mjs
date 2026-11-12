// The routes that execFile a core script directly bypass spawnHeadlessCli, so
// its windowsHide does not reach them (#3809). Each has to spell the
// Windows-safe launch itself, and two of them (doctor, portals/verify) have to
// report a failed child as a failure. #4253 fixed four of these routes and
// missed six (stats, patterns, upskill, quiet-companies, company-history,
// keyword-match), which kept launching bare "node" with an inherited console,
// so a census below keeps the routes driven here equal to every route that
// calls execFile.
//
// The Windows half of #3809: a long-lived dev server whose console has gone
// stale kills every child at DLL init with 0xC0000142 — no stdout, no stderr.
// The doctor route read that silence as `{}` and answered "fully set up"
// (available:true, onboardingNeeded:false, missing:[]) for a user with no
// cv.md. It now answers available:false; the onboarding banner reads only
// onboardingNeeded, so it still hides on that answer, as it did before.
// portals/verify dropped the error the same way and rendered an empty sweep
// as "0 broken".
//
// Driven for real: the handlers are imported under the @/ loader, the core
// scripts they run are stand-ins in a temp checkout (CAREER_OPS_CODE_ROOT), and
// node:child_process.execFile is wrapped so each launch is recorded and then
// performed. That console failure itself cannot be reproduced off Windows,
// so the stand-ins exit the way it does: non-zero, and silent.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = mkdtempSync(join(tmpdir(), "co-core-routes-code-"));
const dataRoot = mkdtempSync(join(tmpdir(), "co-core-routes-data-"));
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realExecFile = childProcess.execFile;
const launches = [];

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  // Would each pull a read back out of the sandbox.
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  // portals/verify answers "not configured" without ever spawning when there is
  // no portals.yml; the stand-in verifier never reads it.
  writeFileSync(join(dataRoot, "portals.yml"), "tracked_companies: []\n");
  childProcess.execFile = function recordingExecFile(file, args, options, callback) {
    launches.push({ file, script: args?.[0], options });
    return realExecFile.call(this, file, args, options, callback);
  };
  syncBuiltinESMExports();
});

after(() => {
  childProcess.execFile = realExecFile;
  syncBuiltinESMExports();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(codeRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

/** Write the stand-in for a core script into the temp checkout. */
function standIn(name, body) {
  writeFileSync(join(codeRoot, `${name}.mjs`), body);
}

/** Run a handler; return its JSON body and the launches it made. */
async function call(handler, req) {
  launches.length = 0;
  const res = await handler(req);
  return { body: await res.json(), launches: [...launches] };
}

const route = (p) => import(`@/app/api/${p}/route.ts`);

// ---------------------------------------------------------------------------
// Launch: the very Node serving the page, never a console it could inherit.
// ---------------------------------------------------------------------------

test("all four core-script routes launch with process.execPath and windowsHide", async () => {
  // Given each core script answers normally
  standIn("doctor", 'console.log(JSON.stringify({ onboardingNeeded: false, missing: [], warnings: [] }));');
  standIn("followup-cadence", 'console.log(JSON.stringify({ entries: [], metadata: {}, cadenceDefaults: {} }));');
  standIn("verify-portals", 'console.log("  ✅ Acme — greenhouse/acme (3 live)");');

  const { GET: doctor } = await route("doctor");
  const { GET: followups } = await route("followups");
  const { GET: cadence } = await route("followups/cadence");
  const { GET: verify } = await route("portals/verify");

  // When each route runs
  const runs = [
    ["doctor", await call(doctor)],
    ["followup-cadence", await call(followups, new Request("http://localhost/api/followups"))],
    ["followup-cadence", await call(cadence)],
    ["verify-portals", await call(verify)],
  ];

  // Then each launched its script exactly once, with the binary serving this
  // process (bare "node" is whatever PATH finds first) and without a console.
  for (const [script, { launches: made }] of runs) {
    assert.equal(made.length, 1, `${script}: one launch`);
    assert.equal(made[0].script, join(codeRoot, `${script}.mjs`));
    assert.equal(made[0].file, process.execPath, `${script}: launched with process.execPath`);
    assert.equal(made[0].options?.windowsHide, true, `${script}: launched with windowsHide`);
  }
});

test("the six analytics routes launch with process.execPath and windowsHide", async () => {
  // Given each core script answers with a JSON payload, and keyword-match has
  // a report to resolve (it never launches without one)
  for (const name of ["stats", "analyze-patterns", "upskill", "rejection-latency", "company-history", "keyword-match"]) {
    standIn(name, "console.log(JSON.stringify({}));");
  }
  mkdirSync(join(dataRoot, "reports"), { recursive: true });
  writeFileSync(join(dataRoot, "reports", "001-acme-2026-10-01.md"), "# Acme\n");

  const { GET: stats } = await route("stats");
  const { GET: patterns } = await route("patterns");
  const { GET: upskill } = await route("upskill");
  const { GET: quiet } = await route("quiet-companies");
  const { GET: history } = await route("company-history");
  const { GET: keywords } = await route("keyword-match");

  // When each route runs
  const runs = [
    ["stats", await call(stats)],
    ["analyze-patterns", await call(patterns)],
    ["upskill", await call(upskill)],
    ["rejection-latency", await call(quiet)],
    ["company-history", await call(history, new Request("http://localhost/api/company-history?company=Acme"))],
    ["keyword-match", await call(keywords, new Request("http://localhost/api/keyword-match?report=1"))],
  ];

  // Then each launched its script once, with this process's Node binary and
  // no console to inherit
  for (const [script, { launches: made }] of runs) {
    assert.equal(made.length, 1, `${script}: one launch`);
    assert.equal(made[0].script, join(codeRoot, `${script}.mjs`));
    assert.equal(made[0].file, process.execPath, `${script}: launched with process.execPath`);
    assert.equal(made[0].options?.windowsHide, true, `${script}: launched with windowsHide`);
  }
});

// Every route that calls execFile, found by reading the route tree. The two
// tests above drive exactly these; a route added later that execFiles a core
// script fails here until it is driven there too.
const DRIVEN_ROUTES = [
  "company-history",
  "doctor",
  "followups",
  "followups/cadence",
  "keyword-match",
  "patterns",
  "portals/verify",
  "quiet-companies",
  "stats",
  "upskill",
];

test("census: the routes driven above are every route that calls execFile", () => {
  const apiRoot = fileURLToPath(new URL("../../src/app/api", import.meta.url));
  const found = listTree(apiRoot, { match: /route\.ts$/ })
    .filter((f) => /\bexecFile\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(apiRoot, dirname(f)).split(sep).join("/"));
  // Premise: the walk sees the route tree at all
  assert.ok(found.includes("doctor"), `the census walk found no doctor route under ${apiRoot}`);
  assert.deepEqual(found.sort(), DRIVEN_ROUTES);
});

// ---------------------------------------------------------------------------
// doctor: "the check didn't answer" is never "you're all set up".
// ---------------------------------------------------------------------------

const UNAVAILABLE = { available: false, onboardingNeeded: false, missing: [], warnings: [] };

test("doctor reports unavailable when its child fails without output", async () => {
  // Given the doctor dies the way 0xC0000142 kills it: non-zero, nothing printed
  standIn("doctor", "process.exit(1);");
  const { GET } = await route("doctor");
  // Then that is not a verdict, and certainly not "fully set up"
  assert.deepEqual((await call(GET)).body, UNAVAILABLE);
});

test("doctor reports unavailable when its child exits cleanly but prints nothing", async () => {
  standIn("doctor", "process.exit(0);");
  const { GET } = await route("doctor");
  assert.deepEqual((await call(GET)).body, UNAVAILABLE);
});

test("doctor reports unavailable when its child prints a verdict and then fails", async () => {
  // Given a well-formed verdict followed by a non-zero exit: the error alone
  // must decide, not the fact that the output happens to parse
  standIn(
    "doctor",
    'console.log(JSON.stringify({ onboardingNeeded: false, missing: [], warnings: [] })); process.exit(1);',
  );
  const { GET } = await route("doctor");
  assert.deepEqual((await call(GET)).body, UNAVAILABLE);
});

test("doctor reports unavailable when the payload carries no onboarding verdict", async () => {
  // Given JSON that parses but says nothing: `!!undefined` used to read it as
  // onboardingNeeded:false — the same false all-clear by another road
  standIn("doctor", 'console.log("{}");');
  const { GET } = await route("doctor");
  assert.deepEqual((await call(GET)).body, UNAVAILABLE);
});

test("doctor still relays a real verdict, including that onboarding is needed", async () => {
  // Given a healthy doctor that finds cv.md missing (a banner line before the
  // payload must not matter: the verdict is the last line)
  standIn(
    "doctor",
    'console.log("banner");' +
      'console.log(JSON.stringify({ onboardingNeeded: true, missing: ["cv.md"], warnings: ["w"] }));',
  );
  const { GET } = await route("doctor");
  assert.deepEqual((await call(GET)).body, {
    available: true,
    onboardingNeeded: true,
    missing: ["cv.md"],
    warnings: ["w"],
  });
});

// ---------------------------------------------------------------------------
// portals/verify: a sweep that did not finish is a failure, not "0 broken".
// ---------------------------------------------------------------------------

test("portals/verify reports a failed sweep instead of an empty, healthy list", async () => {
  // Given the verifier fails and says why on stderr
  standIn("verify-portals", 'console.error("verify-portals failed: boom"); process.exit(1);');
  const { GET } = await route("portals/verify");
  const { body } = await call(GET);
  // Then the route says it has no answer, and carries the reason
  assert.equal(body.available, false);
  assert.deepEqual(body.companies, []);
  assert.equal(body.error, "verify-portals failed: boom");
});

test("portals/verify names an uncaught crash, not Node's version banner", async () => {
  // Given the verifier dies at import (root deps not installed): Node prints
  // the error, a stack, and ends stderr with "Node.js vXX"
  standIn("verify-portals", 'import "career-ops-dependency-that-is-not-installed";');
  const { GET } = await route("portals/verify");
  const { body } = await call(GET);
  assert.equal(body.available, false);
  assert.match(body.error, /^Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package 'career-ops-dependency/);
});

test("portals/verify keeps how the run ended ahead of a stray warning", async () => {
  // Given a provider's routine warning is the last thing on stderr
  standIn("verify-portals", 'console.error("⚠️  eightfold: Acme stopped early on HTTP 429"); process.exit(1);');
  const { GET } = await route("portals/verify");
  const { body } = await call(GET);
  assert.equal(body.available, false);
  assert.equal(body.error, "exit code 1: ⚠️  eightfold: Acme stopped early on HTTP 429");
});

test("portals/verify does not pass off a partial sweep as the whole picture", async () => {
  // Given the verifier printed one company before it died: the ones it never
  // reached would be missing from the list rather than flagged as unknown
  standIn("verify-portals", 'console.log("  ✅ Acme — greenhouse/acme (3 live)"); process.exit(1);');
  const { GET } = await route("portals/verify");
  const { body } = await call(GET);
  assert.equal(body.available, false);
  assert.deepEqual(body.companies, []);
  assert.equal(body.error, "exit code 1");
});

test("portals/verify reports a silent verifier as a failure", async () => {
  // Given the 0xC0000142 shape again, and a clean-but-silent exit
  for (const script of ["process.exit(1);", "process.exit(0);"]) {
    standIn("verify-portals", script);
    const { GET } = await route("portals/verify");
    const { body } = await call(GET);
    assert.equal(body.available, false, script);
    assert.deepEqual(body.companies, [], script);
    assert.ok(body.error, `${script}: the failure carries a reason`);
  }
});

test("portals/verify still parses a completed sweep", async () => {
  standIn(
    "verify-portals",
    'console.log("verify-portals: portals.yml\\n");' +
      'console.log("  ✅ Acme — greenhouse/acme (3 live)");' +
      'console.log("  ❌ Globex — lever/globex (not found) — 404");',
  );
  const { GET } = await route("portals/verify");
  const { body } = await call(GET);
  assert.equal(body.available, true);
  assert.equal(body.configured, true);
  assert.equal(body.error, undefined);
  assert.deepEqual(
    body.companies.map((c) => [c.name, c.status]),
    [
      ["Acme", "live"],
      ["Globex", "broken"],
    ],
  );
});
