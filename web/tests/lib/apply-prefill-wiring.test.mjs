/**
 * apply-prefill-wiring.test.mjs: the two edits that deliver the tailored CV to
 * the planner, pinned where they live.
 *
 * apply-prefill-cv-source.test.mjs proves the library seam. resolveSessionCv()
 * finds the CV, applyCvSource() turns it into a readable path, and
 * buildAnswerPrompt() names it. None of that reaches a real application unless
 * the route passes cvSource and the provider sends the two identifiers it
 * resolves from.
 *
 * Drop `cvSource` from the buildAnswerPrompt call, or send the prefill only
 * { sessionId, cliId }. Every one of those cases still passes while the bug is
 * fully back, with the planner drafting from master cv.md beside a tailored
 * attachment.
 *
 * Driving the route itself would need a live apply session and a spawned CLI.
 * So these read the source, in the style of config-form-persist-wiring.test.mjs,
 * decision-card-cta.test.mjs and first-run-copy.test.mjs.
 *
 * Run (from web/):  node --test tests/lib/apply-prefill-wiring.test.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const route = readFileSync(join(root, "src/app/api/apply/prefill/route.ts"), "utf8");
const provider = readFileSync(join(root, "src/components/apply/apply-provider.tsx"), "utf8");

test("the prefill route hands buildAnswerPrompt the resolved cvSource", () => {
  // The call this PR exists to change. Without the argument the prompt falls
  // back to its cv.md wording and the resolver above it is dead code.
  assert.match(
    route,
    /buildAnswerPrompt\(\{[^}]*\bcvSource\b[^}]*\}\)/,
    "prefill/route.ts must pass cvSource to buildAnswerPrompt, or the planner reads master cv.md",
  );
});

test("the prefill route resolves that cvSource from the CV the fill route attaches", () => {
  assert.match(route, /import\s*\{[^}]*\bresolveSessionCv\b[^}]*\}\s*from\s*"@\/lib\/apply\/cv"/);
  assert.match(route, /import\s*\{[^}]*\bapplyCvSource\b[^}]*\}\s*from\s*"@\/lib\/apply\/cv-source\.mjs"/);
  assert.match(route, /resolveSessionCv\(\{[^}]*\bcompany\b[^}]*\bapplication\b[^}]*\}\)/);
  assert.match(route, /\bcvSource\b\s*=[^\n]*\bapplyCvSource\(/);

  const resolve = route.indexOf("resolveSessionCv(");
  const prompt = route.indexOf("buildAnswerPrompt(");
  assert.notEqual(resolve, -1);
  assert.notEqual(prompt, -1);
  assert.ok(resolve < prompt, "the CV must be resolved before the prompt that names it is built");
});

test("the prefill route reads company and application off the request body", () => {
  // The provider can send both and change nothing if the handler never unpacks
  // them. resolveSessionCv then falls through to the page title, and attaches a
  // sibling role's CV.
  assert.match(route, /const\s*\{[^}]*\bcompany\b[^}]*\bapplication\b[^}]*\}\s*=\s*body/);
  assert.match(route, /typeof\s+company\s*!==\s*"string"/);
  assert.match(route, /typeof\s+application\s*!==\s*"string"/);
});

test("the apply provider sends both identifiers to prefill", () => {
  const body = callBody("/api/apply/prefill");
  assert.match(body, /\bsessionId\b/, "located the wrong call");
  assert.match(body, /company:\s*companyRef\.current/, "prefill must send the company the fill call sends");
  assert.match(body, /application:\s*nRef\.current/, "prefill must send the application number the fill call sends");
});

test("prefill and fill read the identifiers from the same two refs", () => {
  // Two sources for one answer is how the halves drift apart again.
  const fill = callBody("/api/apply/fill");
  assert.match(fill, /company:\s*companyRef\.current/);
  assert.match(fill, /application:\s*nRef\.current/);
});

/** The JSON.stringify({...}) argument of the fetch to `path`. */
function callBody(path) {
  const at = provider.indexOf(`"${path}"`);
  assert.notEqual(at, -1, `no fetch to ${path} in apply-provider.tsx`);
  const open = provider.indexOf("JSON.stringify({", at);
  assert.notEqual(open, -1, `the fetch to ${path} sends no JSON body`);
  const close = provider.indexOf("})", open);
  assert.ok(close > open, `could not find the end of the ${path} body`);
  return provider.slice(open, close);
}
