// A stale saved cliId must not 404 every AI surface but Run (#4607).
//
// #4019 re-checks the saved id on the client before a Run. Every other surface
// (Explore, CV ingest, Apply, the Assistant) sends it unchecked, and all of them
// resolve it through web/src/lib/clis.ts on the server, so the fallback lives
// there: resolveCliOrFallback() applies pickUsableCli() below.
//
// Two halves:
//  1. pickUsableCli() — the rule itself, imported from the REAL cli-pick.mjs.
//  2. The routes — read as text (like clis-coverage.test.mjs), because they are
//     TypeScript route handlers with Next imports. They must resolve through the
//     fallback AND run under the id it returns: fencing, capability checks and
//     argv are keyed on cliId, and running one CLI under another's id is the
//     mismatch #2507 is about.
//
// Run:  node --test tests/lib/cli-fallback.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedCliIds, pickUsableCli } from "../../src/lib/cli-pick.mjs";

const clis = (...installed) =>
  ["claude", "codex", "opencode"].map((id) => ({ id, installed: installed.includes(id) }));

test("an installed id is used as-is, with no substitution", () => {
  assert.deepEqual(pickUsableCli("codex", clis("claude", "codex")), { id: "codex", substitutedFrom: null });
});

test("a stale id falls back to the sole installed CLI and names what it replaced", () => {
  assert.deepEqual(pickUsableCli("opencode", clis("claude")), { id: "claude", substitutedFrom: "opencode" });
});

test("an id that is not a known CLI at all falls back the same way", () => {
  assert.deepEqual(pickUsableCli("gone-cli", clis("codex")), { id: "codex", substitutedFrom: "gone-cli" });
});

test("no fallback when the choice is ambiguous or nothing is installed", () => {
  const none = { id: null, substitutedFrom: null };
  assert.deepEqual(pickUsableCli("opencode", clis("claude", "codex")), none);
  assert.deepEqual(pickUsableCli("opencode", clis()), none);
  assert.deepEqual(pickUsableCli("opencode", undefined), none);
});

test("installedCliIds lists only installed entries, for the 404 body", () => {
  assert.deepEqual(installedCliIds(clis("claude", "opencode")), ["claude", "opencode"]);
  assert.deepEqual(installedCliIds([null, { installed: true }, { id: "codex", installed: false }]), []);
});

const API = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "app", "api");
const read = (rel) => readFileSync(join(API, rel), "utf8");

// Routes that spawn the CLI they resolve. Each must rebind cliId to the resolved
// spec's id before anything keyed on it runs.
const SPAWNING_ROUTES = ["run/route.ts", "assistant/route.ts", "cv/ingest/route.ts", "explore/ai/route.ts", "apply/prefill/route.ts"];
// Routes that hand the id to lib/apply, which resolves it again itself.
const PASS_THROUGH_ROUTES = ["apply/session/route.ts", "apply/drive/route.ts"];

for (const rel of [...SPAWNING_ROUTES, ...PASS_THROUGH_ROUTES]) {
  test(`${rel} resolves the requested CLI through the fallback, not resolveCli()`, () => {
    const src = read(rel);
    assert.match(src, /resolveCliOrFallback\(/, `${rel} does not call resolveCliOrFallback()`);
    assert.doesNotMatch(src, /\bresolveCli\(/, `${rel} still calls resolveCli() directly, so a stale saved id 404s`);
  });
}

for (const rel of SPAWNING_ROUTES) {
  test(`${rel} runs under the resolved CLI's id and reports a substitution`, () => {
    const src = read(rel);
    assert.match(src, /cliId = spec\.id;/, `${rel} does not rebind cliId to the resolved spec`);
    // The rebind must come before the first thing keyed on the id.
    const rebind = src.search(/cliId = spec\.id;/);
    for (const use of [/isClaude = cliId === "claude"/, /fencingReport\(\{ cliId/, /\{ cliId, capabilities/]) {
      const at = src.search(use);
      if (at !== -1) assert.ok(at > rebind, `${rel}: ${use} runs before cliId is rebound to the resolved CLI`);
    }
    assert.match(src, /cliSubstitutionNotice\(resolved\)/, `${rel} never reports a substitution`);
  });
}

// A PDF upload judged a stale id that has no fallback as "not Claude", so it
// answered "PDF upload needs Claude Code" (400) even with Claude installed,
// instead of the 404 that lists the installed CLIs and points to Config.
test("cv/ingest/route.ts reports an unavailable CLI before judging PDF eligibility, and resolves it once", () => {
  const src = read("cv/ingest/route.ts");
  const calls = src.match(/resolveCliOrFallback\(/g) ?? [];
  assert.equal(calls.length, 2, "expected one call for uploads and one `??=` for pasted text");
  assert.match(src, /resolved \?\?= resolveCliOrFallback\(cliId\)/, "pasted text must reuse an upload's resolution, not resolve again");
  const unavailable = src.search(/cliUnavailableError\(cliId\)/);
  const pdfCheck = src.search(/PDF upload needs Claude Code/);
  assert.ok(unavailable !== -1 && pdfCheck !== -1);
  assert.ok(unavailable < pdfCheck, "the 404 for an unavailable CLI must come before the PDF check");
  assert.doesNotMatch(src, /\?\.spec\.id \?\? cliId/, "the PDF check must not fall back to the stale id");
});
