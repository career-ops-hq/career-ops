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
} from "../../src/lib/claude-invocation.mjs";
// KNOWN_KINDS lives with the policy both CLIs read, not on Claude's path (#2507).
import { KNOWN_KINDS, capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";

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

test("toolScopeFor: research is read-only too, but is NOT pdf's scope", () => {
  // Given both are read-only, yet they differ on the other axis: research fetches
  // ("use WebFetch for URLs") and pdf reads local files only. They shared one
  // scope until the network axis was wired up, which is exactly how pdf came to
  // declare network:false while still being handed WebFetch on Claude (#2507).
  const research = toolScopeFor("research");
  const pdf = toolScopeFor("pdf");

  // Then neither can write...
  assert.equal(grantsWriteCapability(research), false);
  assert.equal(grantsWriteCapability(pdf), false);
  // ...and they are deliberately different arms, not one shared read-only arm.
  assert.equal(research, TOOL_SCOPES.networkReadOnly);
  assert.equal(pdf, TOOL_SCOPES.localReadOnly);
  assert.notEqual(research, pdf);

  // Assert the CONTENTS, not just which object was selected. Identity alone would
  // still pass if TOOL_SCOPES.networkReadOnly lost WebFetch or localReadOnly
  // gained it — a regression on precisely the axis this test exists to protect.
  assert.ok(toolNames(research.allowed).includes("WebFetch"), "research fetches its target");
  assert.ok(!toolNames(pdf.allowed).includes("WebFetch"), "pdf reads local files only");
  assert.ok(!toolNames(pdf.allowed).includes("WebSearch"), "pdf reads local files only");

  // And the same through the shipped argv, since that is what actually reaches
  // the CLI — a scope is only as good as the command line built from it.
  assert.ok(claudeCliArgs({ kind: "research", prompt: "x" }).join(" ").includes("WebFetch"));
  assert.ok(!toolNames(argValue(claudeCliArgs({ kind: "pdf", prompt: "x" }), "--allowedTools")).includes("WebFetch"));
});

test("toolScopeFor: an unknown kind falls back to the narrowest scope", () => {
  // Given a kind nobody has taught this map about, including inherited property
  // names. Note this case CANNOT catch a regression to a bare
  // `KIND_CAPABILITIES[kind]` on its own: destructuring {writes, network} off the
  // resulting function yields undefined for both, which is falsy, so the scope
  // still lands here by accident (verified by mutation). The discriminating
  // assertion is record identity, in worker-capabilities.test.mjs; this one pins
  // the scope that a correct capabilitiesFor must produce.
  for (const kind of ["some-future-kind", "constructor", "toString", "valueOf", "__proto__"]) {
    // When resolving its scope
    const scope = toolScopeFor(kind);

    // Then it is the NARROWEST scope — no write tool and no network tool. Granting
    // either to a worker nobody has classified is the unrecoverable mistake here,
    // and the fallback must be the strictest arm, not merely a non-writing one.
    assert.equal(scope, TOOL_SCOPES.localReadOnly, `${kind} must fall back to the narrowest scope`);
  }
});

test("toolScopeFor: evaluate and fix-portal keep Write and Bash on purpose", () => {
  // Given these kinds genuinely run reserve-report-num.mjs / merge-tracker.mjs /
  // verify-portals.mjs and persist canonical artifacts. Derived from the policy
  // rather than named, so a newly-added writing kind is covered automatically.
  const writingKinds = KNOWN_KINDS.filter((k) => capabilitiesFor(k).writes);
  assert.ok(writingKinds.length > 0, "the policy must classify at least one kind as writing");
  for (const kind of writingKinds) {
    // When resolving their scope
    const allowed = toolNames(toolScopeFor(kind).allowed);

    // Then they retain write access — this test exists so removing it is a
    // deliberate act, not an accident
    assert.ok(allowed.includes("Write"), `${kind} needs Write`);
    assert.ok(allowed.includes("Bash"), `${kind} needs Bash`);
  }
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
  assert.equal(grantsWriteCapability(TOOL_SCOPES.localReadOnly), false);
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

test("claudeCliArgs: MCP is locked for non-writing kinds, kept for writing ones", () => {
  // Given the gap this test's earlier version pointed at — "#2507 covers the same
  // gap for the other kinds" — now closed. A deny list describes only NATIVE tools,
  // so without --strict-mcp-config a user's MCP server could hand a `writes: false`
  // worker a write tool while the fencing certified the run as restricted.
  const nonWriting = KNOWN_KINDS.filter((k) => !capabilitiesFor(k).writes);
  const writing = KNOWN_KINDS.filter((k) => capabilitiesFor(k).writes);
  assert.ok(nonWriting.length > 0 && writing.length > 0, "both partitions must be non-empty");

  for (const kind of nonWriting) {
    assert.ok(
      claudeCliArgs({ kind, prompt: "x" }).includes("--strict-mcp-config"),
      `${kind} declares writes:false, so its tool list must describe everything it can reach`,
    );
  }

  // And the caution that version raised still holds: locking MCP on an evaluation
  // would silently stop a user's configured server (the optional Canva one, say)
  // from loading. Those kinds legitimately write, so MCP grants them nothing their
  // capability record does not already allow.
  for (const kind of writing) {
    assert.ok(
      !claudeCliArgs({ kind, prompt: "x" }).includes("--strict-mcp-config"),
      `${kind} writes by design — locking its MCP config is a behaviour change nobody asked for`,
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

test("claudeCliArgs: evaluate still ships write access", () => {
  // Given an evaluation, which genuinely persists report + tracker artifacts
  const allowed = argValue(claudeCliArgs({ kind: "evaluate", prompt: "x" }), "--allowedTools");

  // Then its argv keeps write access — so removing it is a deliberate act
  assert.equal(grantsWriteCapability({ allowed, disallowed: "" }), true);
});

test("argValue: absent or dangling flags yield an empty string, not a crash", () => {
  // Given argv missing the flag, or ending on it
  // Then reading it back is safe — a guard must not throw on malformed argv
  assert.equal(argValue(["-p", "x"], "--allowedTools"), "");
  assert.equal(argValue(["--allowedTools"], "--allowedTools"), "");
});
