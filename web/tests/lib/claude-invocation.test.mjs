// Tests for the headless claude invocation — per-kind tool scopes and argv (#2185).
//
// These assert on exported VALUES and on the built command line, never on
// route.ts's source text — claude-invocation.mjs's header lists the five ways
// source-text versions of this guard were defeated. Value assertions cannot rot
// that way, so each case below pins a capability rather than a spelling.
//
// Run:  node --test tests/lib/claude-invocation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_SCOPES,
  WRITE_CAPABLE_TOOLS,
  toolScopeFor,
  grantsWriteCapability,
  claudeCliArgs,
  argValue,
  toolNames,
  KNOWN_KINDS,
  UNTRUSTED_JD_KINDS,
} from "../../src/lib/claude-invocation.mjs";

test("toolScopeFor: pdf gets no write-capable tool at all", () => {
  // Given the pdf kind, whose agent only tailors content and emits it inline
  // When resolving its tool scope
  const scope = toolScopeFor("pdf");

  // Then nothing that can write reaches the allow list...
  for (const tool of WRITE_CAPABLE_TOOLS) {
    assert.ok(!toolNames(scope.allowed).includes(tool), `pdf must not allow ${tool}`);
  }
  // ...and EVERY write-capable tool is explicitly denied, not merely omitted.
  // Derived from WRITE_CAPABLE_TOOLS on purpose: hand-listing three of them let
  // MultiEdit through, denied only by absence from the allow list, which
  // --permission-mode acceptEdits is precisely designed to paper over.
  const denied = toolNames(scope.disallowed);
  for (const tool of WRITE_CAPABLE_TOOLS) {
    assert.ok(denied.includes(tool), `pdf must explicitly deny ${tool}`);
  }
});

test("toolScopeFor: NO kind leaves a write-capable tool merely unmentioned", () => {
  // Given --permission-mode acceptEdits auto-approves edit tools, a write tool that
  // is neither allowed nor denied is reachable. This once shipped: the persisting
  // scope's deny list was hand-written and omitted MultiEdit, and the freeze only
  // probed pdf, so nothing caught it.
  for (const kind of [...KNOWN_KINDS, "some-future-kind"]) {
    const scope = toolScopeFor(kind);
    const allowed = toolNames(scope.allowed);
    const denied = toolNames(scope.disallowed);

    // Then every write-capable tool is in exactly one of the two lists
    for (const tool of WRITE_CAPABLE_TOOLS) {
      assert.ok(
        allowed.includes(tool) || denied.includes(tool),
        `${kind}: ${tool} is neither allowed nor denied — acceptEdits may auto-approve it`,
      );
    }
  }
});

test("toolScopeFor: pdf can still read what it needs to tailor", () => {
  // Given pdf must read modes/pdf.md, cv.md, profile.yml, the report and template
  // When resolving its tool scope
  const allowed = toolNames(toolScopeFor("pdf").allowed);

  // Then removing write access has not removed read access
  for (const tool of ["Read", "Glob", "Grep"]) {
    assert.ok(allowed.includes(tool), `pdf must allow ${tool}`);
  }
});

test("toolScopeFor: research is read-only too, and shares pdf's scope", () => {
  // Given research is documented as fully read-only
  // When comparing it with pdf
  // Then they are the same object — one read-only arm, not two that can drift
  assert.equal(toolScopeFor("research"), toolScopeFor("pdf"));
  assert.equal(toolScopeFor("research"), TOOL_SCOPES.readOnly);
});

test("toolScopeFor: an unknown kind falls back to the read-only scope", () => {
  // Given a kind nobody has taught this map about
  // When resolving its scope
  const scope = toolScopeFor("some-future-kind");

  // Then it is read-only — the safe default, since granting write to an unknown
  // kind is the one unrecoverable mistake here
  assert.equal(scope, TOOL_SCOPES.readOnly);
});

test("toolScopeFor: untrusted-JD kinds get no write-capable tool at all", () => {
  // Given evaluate/oferta/auto-pipeline ingest a posting (data, never
  // instructions) and pdf already reads that same posting via the report
  for (const kind of UNTRUSTED_JD_KINDS) {
    const scope = toolScopeFor(kind);
    const allowed = toolNames(scope.allowed);
    const denied = toolNames(scope.disallowed);
    for (const tool of WRITE_CAPABLE_TOOLS) {
      assert.ok(!allowed.includes(tool), `${kind} must not allow ${tool}`);
      assert.ok(denied.includes(tool), `${kind} must explicitly deny ${tool}`);
    }
    assert.equal(grantsWriteCapability(scope), false, `${kind} must not grant write`);
  }
});

test("toolScopeFor: fix-portal keeps Write and Bash on purpose", () => {
  // Given this kind genuinely runs verify-portals.mjs and edits portals.yml
  const allowed = toolNames(toolScopeFor("fix-portal").allowed);

  // Then it retains write access — tracker merge / pdf generation live in the
  // backend, not this scope; removing fix-portal's grant is a deliberate act
  assert.ok(allowed.includes("Write"), "fix-portal needs Write");
  assert.ok(allowed.includes("Bash"), "fix-portal needs Bash");
});

test("toolScopeFor: every kind blocks sub-agents", () => {
  // Given Task spawns sub-agents (runaway cost) and is never wanted here
  for (const kind of KNOWN_KINDS) {
    // Then it is denied for all of them
    assert.ok(toolNames(toolScopeFor(kind).disallowed).includes("Task"), `${kind} must deny Task`);
  }
});

test("grantsWriteCapability: sees through parameterized specifiers", () => {
  // Given Claude Code's parameterized forms, which an exact-token comparison
  // reads as unknown tools and waves through
  for (const allowed of ["Read,Bash(node x.mjs:*),Glob", "Read,Write(output/*)", "Read,Edit(*)"]) {
    // When asking whether the scope grants a write
    // Then the argument is stripped before comparing, so it is caught
    assert.equal(grantsWriteCapability({ allowed, disallowed: "" }), true, allowed);
  }
});

test("toolNames: strips specifier arguments and blank entries", () => {
  // Given a flag value with specifiers, padding and a trailing comma
  // When splitting it into bare tool names
  // Then each entry is a plain tool name
  assert.deepEqual(toolNames("Read, Bash(node x:*) ,Edit(src/**),"), ["Read", "Bash", "Edit"]);
  assert.deepEqual(toolNames(undefined), []);
});

test("grantsWriteCapability: catches Bash and MultiEdit, not just Write/Edit", () => {
  // Given the exact scopes that slipped past the old source-regex guard
  // When asking whether each grants a way to write
  // Then all of them are caught — Bash because `sh -c` writes, MultiEdit because
  // a word-boundary match on "Edit" cannot see it
  assert.equal(grantsWriteCapability({ allowed: "Read,Bash,Glob", disallowed: "" }), true);
  assert.equal(grantsWriteCapability({ allowed: "Read,MultiEdit,Glob", disallowed: "" }), true);
  assert.equal(grantsWriteCapability({ allowed: "Read,NotebookEdit", disallowed: "" }), true);
  assert.equal(grantsWriteCapability({ allowed: "Read,Write", disallowed: "" }), true);

  // And a genuinely read-only scope is not a false positive
  assert.equal(grantsWriteCapability(TOOL_SCOPES.readOnly), false);
});

test("grantsWriteCapability: a substring of a tool name is not a match", () => {
  // Given a hypothetical future read-only tool whose name contains a write tool's
  // name as a substring, listed exactly
  // When checking it
  // Then matching is per-tool-token, so it is not mistaken for write access
  assert.equal(grantsWriteCapability({ allowed: "Read,WriteupPreview", disallowed: "" }), false);
});

// ── claudeCliArgs ──
//
// The scope only matters as it reaches the CLI. These assert the built command
// line, which is what a guard must inspect: three earlier source-text guards were
// each defeated by rewriting the call site while the values stayed correct.

test("claudeCliArgs: the pdf command line grants no write-capable tool", () => {
  // Given a pdf run
  const args = claudeCliArgs({ kind: "pdf", prompt: "tailor it" });

  // When reading the tool flags back off the argv
  const allowed = argValue(args, "--allowedTools");
  const disallowed = argValue(args, "--disallowedTools");

  // Then what actually ships grants no write, and denies each one by name
  assert.equal(grantsWriteCapability({ allowed, disallowed }), false, `allowed=${allowed}`);
  for (const tool of WRITE_CAPABLE_TOOLS) {
    assert.ok(toolNames(disallowed).includes(tool), `pdf argv must deny ${tool}`);
  }
});

test("claudeCliArgs: loads no MCP servers", () => {
  // Given MCP tools would appear in neither the allow nor the deny list, so a
  // write tool arriving from the user's MCP config would be invisible to every
  // check here
  const args = claudeCliArgs({ kind: "pdf", prompt: "x" });

  // Then MCP config is locked down for pdf
  assert.ok(args.includes("--strict-mcp-config"), "pdf argv must pass --strict-mcp-config");
  assert.ok(!args.includes("--mcp-config"), "no MCP server may be loaded");
});

test("claudeCliArgs: untrusted-JD kinds load no MCP servers", () => {
  // Given MCP tools would appear in neither the allow nor the deny list, so a
  // write tool arriving from the user's MCP config would be invisible to every
  // check here. evaluate ingests a posting; locking MCP is the same hole pdf
  // already closed.
  for (const kind of UNTRUSTED_JD_KINDS) {
    const args = claudeCliArgs({ kind, prompt: "x" });
    assert.ok(args.includes("--strict-mcp-config"), `${kind} argv must pass --strict-mcp-config`);
    assert.ok(!args.includes("--mcp-config"), `${kind}: no MCP server may be loaded`);
  }
});

test("claudeCliArgs: research and fix-portal keep their MCP servers", () => {
  // research investigates the user's own work; fix-portal edits portals.yml.
  // Neither ingests a posting, so a configured MCP server (optional Canva)
  // still loads. Non-Claude CLIs remain unfenced — #2507.
  for (const kind of ["research", "fix-portal"]) {
    assert.ok(
      !claudeCliArgs({ kind, prompt: "x" }).includes("--strict-mcp-config"),
      `${kind} must not have its MCP config locked down by an evaluate/pdf fix`,
    );
  }
});

test("claudeCliArgs: carries the prompt and the streaming flags", () => {
  // Given any run
  const args = claudeCliArgs({ kind: "pdf", prompt: "PROMPT-BODY" });

  // Then the prompt is passed with -p and the stream-json transport is intact —
  // the route parses that stream, so a change here breaks it silently
  assert.equal(argValue(args, "-p"), "PROMPT-BODY");
  assert.equal(argValue(args, "--output-format"), "stream-json");
  assert.ok(args.includes("--include-partial-messages"));
  // acceptEdits is load-bearing for this module's "denied by name, not by
  // omission" argument: it auto-approves edit tools, so a write tool that is
  // merely absent from the allow list would still be reachable.
  assert.equal(argValue(args, "--permission-mode"), "acceptEdits");
});

test("claudeCliArgs: evaluate command line grants no write-capable tool", () => {
  // Given an evaluation, whose agent only scores and emits the report inline
  const args = claudeCliArgs({ kind: "evaluate", prompt: "x" });
  const allowed = argValue(args, "--allowedTools");
  const disallowed = argValue(args, "--disallowedTools");

  // Then what actually ships grants no write, and denies each one by name
  assert.equal(grantsWriteCapability({ allowed, disallowed }), false, `allowed=${allowed}`);
  for (const tool of WRITE_CAPABLE_TOOLS) {
    assert.ok(toolNames(disallowed).includes(tool), `evaluate argv must deny ${tool}`);
  }
});

test("argValue: absent or dangling flags yield an empty string, not a crash", () => {
  // Given argv missing the flag, or ending on it
  // Then reading it back is safe — a guard must not throw on malformed argv
  assert.equal(argValue(["-p", "x"], "--allowedTools"), "");
  assert.equal(argValue(["--allowedTools"], "--allowedTools"), "");
});
