// Tests for the shared worker capability policy (#2507).
//
// This module answers one question — may this worker write, and does it need the
// network — for every CLI at once. Both claude-invocation.mjs and cli-fencing.mjs
// read it, so a wrong answer here mis-permissions every runtime simultaneously.
// These assert on exported VALUES rather than on any caller's source text, the
// same discipline claude-invocation.test.mjs states in its header.
//
// Run:  node --test tests/lib/worker-capabilities.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, KNOWN_KINDS, capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";
import { toolScopeFor, grantsWriteCapability, toolNames } from "../../src/lib/claude-invocation.mjs";

test("the fixture these guards read still looks like itself", () => {
  // Given a suite that iterates KNOWN_KINDS to reach every worker
  // When the list is empty or missing
  // Then every case below would pass by measuring nothing — refuse that first.
  assert.ok(Array.isArray(KNOWN_KINDS) && KNOWN_KINDS.length > 0, "KNOWN_KINDS must be a non-empty array");
  assert.ok(KNOWN_KINDS.includes("evaluate"), "KNOWN_KINDS must still contain the writing kinds");
});

test("every known kind has an explicit capability record", () => {
  // Given the full set of kinds /api/run dispatches
  for (const kind of KNOWN_KINDS) {
    // When its capabilities are resolved
    const caps = capabilitiesFor(kind);

    // Then it is one of the declared records — never a partial or ad-hoc object,
    // which would silently read as `writes: undefined` (falsy, so read-only) and
    // hide a mistake behind a safe-looking default.
    assert.equal(typeof caps.writes, "boolean", `${kind}.writes must be a boolean`);
    assert.ok(
      [false, "search", "fetch"].includes(caps.network),
      `${kind}.network must be false, "search" or "fetch", got ${JSON.stringify(caps.network)}`,
    );
    assert.ok(Object.values(CAPS).includes(caps), `${kind} must use a declared CAPS record`);
  }
});

test("an unreviewed kind gets the least-capable record", () => {
  // Given a kind nobody has classified — a typo, one added to the route but not
  // here, or an INHERITED property name. A bare `KIND_CAPABILITIES[kind]` resolves
  // "constructor" to Object itself, which is truthy and so survives a `??`
  // fallback; this must assert record IDENTITY to catch that. Asserting only that
  // the result behaves read-only does NOT discriminate — destructuring
  // {writes, network} off a function yields undefined for both, which is falsy, so
  // the scope-level test downstream passes either way (verified by mutation).
  for (const kind of ["kind-that-does-not-exist", "constructor", "toString", "valueOf", "__proto__"]) {
    const caps = capabilitiesFor(kind);

    // Then it can neither write nor reach the network, and it is the declared
    // record rather than something merely falsy in both fields.
    assert.equal(caps.writes, false, `${kind} must not write`);
    assert.equal(caps.network, false, `${kind} must not fetch`);
    assert.equal(caps, CAPS.localReadOnly, `${kind} must resolve to the declared least-capable record`);
  }
});

test("pdf needs neither writes nor the network", () => {
  // Given pdf returns its CV inline in an envelope the backend persists, and
  // reads only local files (modes/pdf.md, cv.md, profile, report, template)
  const caps = capabilitiesFor("pdf");

  // Then it is the one run-route kind that can take the strictest sandbox. If
  // this ever flips, the fence loosens for the worker that needs it least.
  assert.equal(caps.writes, false, "pdf must not need write access (#2172)");
  assert.equal(caps.network, false, "pdf reads local files only — no fetch");
});

test("only the persisting kinds may write", () => {
  // Given the kinds that produce canonical artifacts (reports, tracker, portals)
  const writers = KNOWN_KINDS.filter((k) => capabilitiesFor(k).writes);

  // Then exactly those two, and nothing has quietly joined them.
  assert.deepEqual(writers.sort(), ["evaluate", "fix-portal"]);
});

test("the policy and Claude's tool scope agree for every kind", () => {
  // Given claude-invocation.mjs now derives its scope from this module, the two
  // must never disagree about the same kind. Before the split they could: the
  // set of writing kinds was private to Claude's module, so a second CLI could
  // only copy it, and the copy would drift the next time a kind was added.
  for (const kind of [...KNOWN_KINDS, "unknown-kind"]) {
    // When both are asked about the same worker
    const needsWrite = capabilitiesFor(kind).writes;
    const claudeCanWrite = grantsWriteCapability(toolScopeFor(kind));

    // Then Claude hands out a write-capable tool exactly when the policy says so.
    assert.equal(
      claudeCanWrite,
      needsWrite,
      `${kind}: policy says writes=${needsWrite} but Claude's scope says ${claudeCanWrite}`,
    );
  }
});

test("Claude's scope honours the network axis, not just writes", () => {
  // Given the shared policy states two axes, and Claude used to read only one:
  // a single readOnly scope granted WebFetch/WebSearch to every non-writing kind,
  // so pdf declared network:false, was DNS-blocked under Codex's sandbox, and
  // could still fetch on Claude — the drift the policy exists to prevent,
  // surviving on the axis nobody had wired up.
  const NETWORK_TOOLS = ["WebFetch", "WebSearch"];

  for (const kind of [...KNOWN_KINDS, "unknown-kind"]) {
    // When both are asked about the same worker
    const { network } = capabilitiesFor(kind);
    const allowed = toolNames(toolScopeFor(kind).allowed);
    const canFetch = NETWORK_TOOLS.some((t) => allowed.includes(t));

    // Then Claude grants a network tool exactly when the policy says the worker
    // needs the web at all. Which KIND of web access it needs is a Codex
    // distinction — its sandbox and its native search tool are different
    // mechanisms — and Claude's tools are not sandboxed, so both web records
    // translate the same way here.
    assert.equal(
      canFetch,
      Boolean(network),
      `${kind}: policy says network=${network} but Claude's scope says ${canFetch}`,
    );
  }
});

test("pdf cannot reach the network on either runtime", () => {
  // Given pdf reads modes/pdf.md, cv.md, the profile, the report and the
  // template, then returns the CV inline for the backend to persist
  const allowed = toolNames(toolScopeFor("pdf").allowed);

  // Then it holds no network tool. This is the concrete case the axis bug hid:
  // regressing it re-opens a fetch path for the one kind that never needed one.
  for (const tool of ["WebFetch", "WebSearch"]) {
    assert.ok(!allowed.includes(tool), `pdf must not be granted ${tool}`);
  }
});
