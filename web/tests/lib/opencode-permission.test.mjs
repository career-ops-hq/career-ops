// opencode-permission.test.mjs — opencode's headless scope rides in
// OPENCODE_CONFIG_CONTENT (it has no per-tool argv flags), so the pdf/evo
// guardrail that #2185 asserts on claude argv must also hold here, one
// vocabulary over: pdf must never grant opencode's write-capable key (`edit`),
// and the only external path allowed must be the worker's /tmp payload.
// Lives under web/tests/lib so test-all.mjs's #2185 gate discovers it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { opencodePermissionBlock, opencodeBlockGrantsWrite } from "../../src/lib/opencode-permission.mjs";
import { toolScopeFor } from "../../src/lib/claude-invocation.mjs";

const READY_KEYS = ["read", "glob", "grep", "webfetch", "websearch"];

function blockFor(kind) {
  const scope = toolScopeFor(kind);
  return JSON.parse(opencodePermissionBlock({ allowed: scope.allowed, disallowed: scope.disallowed }));
}

test("pdf permission block denies the write-capable key and bash stays allowed", () => {
  const block = blockFor("pdf");
  assert.equal(block.permission.edit, "deny", "pdf must never grant opencode's write key (#2172/#2185)");
  assert.equal(block.permission.bash, "allow", "pdf shells out to generate-pdf.mjs");
  assert.equal(block.permission.task, "deny", "pdf must not spawn subagents");
  for (const key of READY_KEYS) assert.equal(block.permission[key], "allow");
  assert.equal(block.permission["*"], "deny", "everything unlisted is denied");
});

test("every write-capable kind leaves the pdf write guard meaningful", () => {
  // evaluate/fix-portal/cover persist canonical artifacts → edit allow;
  // research is read-only → edit deny. Guards the invariant that the block is
  // derived from the SAME scope claude uses, not a hand-rolled opencode policy.
  for (const kind of ["evaluate", "fix-portal", "cover"]) {
    const block = blockFor(kind);
    assert.equal(block.permission.edit, "allow", `${kind} must be allowed to write canonical artifacts`);
    assert.equal(block.permission.bash, "allow", `${kind} shells out to core scripts`);
  }
  assert.equal(blockFor("research").permission.edit, "deny");
});

test("external_directory allows /tmp payload paths and nothing else", () => {
  const block = blockFor("pdf");
  assert.deepEqual(block.permission.external_directory, { "/tmp/*": "allow", "/tmp": "allow" });
  assert.ok(!JSON.stringify(block.permission).includes("/home"), "no home-directory escape hatch");
});

test("opencodeBlockGrantsWrite agrees with the edit key", () => {
  assert.ok(!opencodeBlockGrantsWrite(opencodePermissionBlock(toolScopeFor("pdf"))));
  assert.ok(opencodeBlockGrantsWrite(opencodePermissionBlock(toolScopeFor("evaluate"))));
  assert.ok(opencodeBlockGrantsWrite("not-json{"), "unparseable block must assume the worst (writable) so the guard fails safe");
});