// The bind decision, tested on values.
//
// This is the module the launcher exists to apply, so these are the cases that
// decide whether the dashboard is reachable from the network. Two of them are
// regressions that shipped once and were caught in review:
//
//   - a loopback-only opt-in used to widen the socket to every interface while
//     granting no host the Host filter did not already admit;
//   - `widened` used to be read off the env value, so a caller-supplied -H could
//     open the socket with the startup warning staying silent.
//
// Run:  node --test tests/lib/bind-host.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedHosts, isLoopbackHost } from "../../src/lib/origin-guard.mjs";
import {
  LOOPBACK_BIND,
  ALL_INTERFACES_BIND,
  NEXT_COMMANDS,
  resolveBindHost,
  isWidenedBind,
  planNextRun,
} from "../../src/lib/bind-host.mjs";

// --- resolveBindHost ------------------------------------------------------

test("an absent or blank opt-in keeps the socket on loopback", () => {
  // Given no opt-in, in each of the spellings a shell or a stray comma produces
  for (const envValue of [undefined, "", " ", ",", " , , ", ":3000", "[]"]) {
    // When the bind is resolved
    const bind = resolveBindHost(envValue);
    // Then nothing outside the machine can open a connection
    assert.equal(bind, LOOPBACK_BIND, `${JSON.stringify(envValue)} must not widen the bind`);
  }
});

test("naming only loopback hosts is not an opt-in to anything", () => {
  // Given a value a user could read as a no-op, or even as a tightening
  for (const envValue of ["localhost", "127.0.0.1", "::1", "localhost, 127.0.0.1"]) {
    // When the bind is resolved
    const bind = resolveBindHost(envValue);
    // Then the socket stays closed: the Host filter admits loopback whatever
    // this value says, so widening for it would expose every interface and
    // grant no host that was not already allowed.
    assert.equal(bind, LOOPBACK_BIND, `${JSON.stringify(envValue)} grants nothing, so must not widen`);
  }
});

test("naming a host loopback cannot serve widens the bind", () => {
  // Given a host that is only reachable off-loopback
  // When the bind is resolved
  // Then the socket opens so that host can actually connect
  assert.equal(resolveBindHost("nas.local"), ALL_INTERFACES_BIND);
  assert.equal(resolveBindHost("192.168.1.50:3000"), ALL_INTERFACES_BIND);
  assert.equal(
    resolveBindHost("localhost, 10.0.0.4"),
    ALL_INTERFACES_BIND,
    "one non-loopback host among loopback ones is still a real opt-in",
  );
});

test("the bind widens exactly when the opt-in names a non-loopback host", () => {
  // Given one shared list spanning every input class above
  // When each is put through the bind decision and the filter's own parse
  // Then the two agree — a reimplementation that drifted on any input fails here
  for (const envValue of [
    undefined, "", " ", ",", ":3000", "[]",
    "localhost", "127.0.0.1", "::1", "localhost, ::1",
    "nas.local", "10.0.0.4", "localhost, 10.0.0.4", "a.local b.local",
  ]) {
    const grantsSomethingNew = [...parseAllowedHosts(envValue)].some((h) => !isLoopbackHost(h));
    assert.equal(
      resolveBindHost(envValue) === ALL_INTERFACES_BIND,
      grantsSomethingNew,
      `${JSON.stringify(envValue)}: the bind must widen iff the filter gains a non-loopback host`,
    );
  }
});

// --- isWidenedBind --------------------------------------------------------

test("a bind is widened only when it is not a loopback address", () => {
  // Given the addresses this module can produce, plus ones a future change might
  // When each is classified
  // Then the answer follows the address itself, not a comparison to one literal
  assert.equal(isWidenedBind(ALL_INTERFACES_BIND), true);
  assert.equal(isWidenedBind(LOOPBACK_BIND), false);
  assert.equal(isWidenedBind("::1"), false, "IPv6 loopback must not read as widened");
  assert.equal(isWidenedBind("127.0.0.2"), false, "the whole 127/8 range is loopback");
  assert.equal(isWidenedBind("192.168.1.50"), true);
});

// --- planNextRun ----------------------------------------------------------

test("an unknown or missing command is refused with usage", () => {
  // Given argv that names no next subcommand
  for (const command of [undefined, "", "serve", "--help"]) {
    // When a run is planned
    const plan = planNextRun({ command, envValue: undefined });
    // Then nothing is spawned and the caller is told how to invoke it
    assert.equal(plan.ok, false, `${JSON.stringify(command)} must not produce a runnable plan`);
    assert.ok(plan.error.includes("Usage: node server.mjs"), "the refusal must name the usage");
  }
});

test("each supported command builds argv with the bind ahead of forwarded flags", () => {
  // Given a supported command and a caller's own flag
  for (const command of NEXT_COMMANDS) {
    // When a run is planned with no opt-in
    const plan = planNextRun({ command, extra: ["-p", "4000"], envValue: undefined });
    // Then next is told the bind first, and the caller's flags survive verbatim
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.argv, [command, "-H", LOOPBACK_BIND, "-p", "4000"]);
    assert.equal(plan.widened, false);
    assert.equal(plan.overridden, false);
  }
});

test("an opt-in that widens is reported along with the hosts that caused it", () => {
  // Given a real opt-in
  const plan = planNextRun({ command: "start", envValue: "nas.local, 10.0.0.4" });
  // When the run is planned
  // Then the caller has everything needed to explain the exposure
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.argv, ["start", "-H", ALL_INTERFACES_BIND]);
  assert.equal(plan.widened, true);
  assert.equal(plan.overridden, false);
  assert.deepEqual(plan.allowedHosts.sort(), ["10.0.0.4", "nas.local"]);
});

test("a caller's -H is forwarded and reported as the effective bind", () => {
  // Given a deliberate override and no opt-in — the combination that used to
  // widen the socket in silence, because `widened` was read off the env value
  for (const extra of [["-H", "0.0.0.0"], ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"]]) {
    // When the run is planned
    const plan = planNextRun({ command: "dev", extra, envValue: undefined });
    // Then the plan reports what next will actually listen on, not what was resolved
    assert.equal(plan.ok, true, `${extra.join(" ")} must still produce a runnable plan`);
    assert.equal(plan.bindHost, LOOPBACK_BIND, "the resolved bind is unchanged");
    assert.equal(plan.effectiveBindHost, "0.0.0.0", `${extra.join(" ")} decides the real bind`);
    assert.equal(plan.widened, true, `${extra.join(" ")} must be reported as widening`);
    assert.equal(plan.overridden, true);
    assert.deepEqual(plan.allowedHosts, [], "the filter still names nobody");
  }
});

test("the attached short form -H0.0.0.0 is recognised as an override", () => {
  // Given commander's attached spelling, which next honours. Missing it did not
  // fail safe: the launcher announced the resolved bind while next opened every
  // interface — a false statement about exposure rather than a silent one.
  for (const extra of [["-H0.0.0.0"], ["-p", "3000", "-H0.0.0.0"]]) {
    // When the run is planned with no opt-in
    const plan = planNextRun({ command: "dev", extra, envValue: undefined });
    // Then the plan reports the interface next will really listen on
    assert.equal(plan.effectiveBindHost, "0.0.0.0", `${extra.join(" ")} sets the real bind`);
    assert.equal(plan.widened, true, `${extra.join(" ")} must be reported as widening`);
    assert.equal(plan.overridden, true);
  }
});

test("a -H whose next token is another flag supplies no host", () => {
  // Given a malformed invocation next will reject itself
  const plan = planNextRun({ command: "dev", extra: ["-H", "-p", "4000"], envValue: undefined });
  // When the run is planned
  // Then `-p` is not mistaken for the hostname, which would announce "binding -p"
  assert.equal(plan.effectiveBindHost, LOOPBACK_BIND);
  assert.equal(plan.widened, false);
});

test("an allow-list of only loopback hosts grants nothing new", () => {
  // Given an opt-in that names hosts the guard already admits, plus an override
  // that opens the socket — the state that used to print no second notice
  const plan = planNextRun({
    command: "dev",
    extra: ["-H", "0.0.0.0"],
    envValue: "localhost, 127.0.0.1, ::1",
  });
  // When the run is planned
  // Then it is flagged: the port is open and the filter names nobody who could
  // not already reach it on loopback
  assert.equal(plan.widened, true);
  assert.equal(plan.grantsNoNewHost, true, "a loopback-only list grants nothing");
});

test("an allow-list naming a reachable host does grant something", () => {
  // Given an opt-in that names a host loopback cannot serve
  const plan = planNextRun({ command: "dev", envValue: "nas.local" });
  // When the run is planned
  // Then the filter is meaningful and the second notice must not fire
  assert.equal(plan.grantsNoNewHost, false);
});

test("an empty -H value widens the bind, because Node treats it as unset", () => {
  // Given an override with no value — `-H ""` or `--hostname=`
  for (const extra of [["-H", ""], ["--hostname="]]) {
    // When the run is planned
    const plan = planNextRun({ command: "dev", extra, envValue: undefined });
    // Then it is reported as widening: listen(port, "") binds every interface
    // exactly as listen(port, undefined) does, so treating it as "no override"
    // would silence a warning for a socket that really is open.
    assert.equal(plan.widened, true, `${extra.join(" ")} opens every interface`);
    assert.equal(
      plan.effectiveBindHost,
      ALL_INTERFACES_BIND,
      "the notice must name the interface, not echo an empty string",
    );
  }
});

test("a bare -H at the end of argv is not read as an override", () => {
  // Given a flag with nothing following it — next will reject this itself
  for (const extra of [["-H"], ["--hostname"], ["-p", "4000", "-H"]]) {
    // When the run is planned
    const plan = planNextRun({ command: "dev", extra, envValue: undefined });
    // Then there is no value to override with, so the resolved bind stands
    assert.equal(plan.effectiveBindHost, LOOPBACK_BIND, `${extra.join(" ")} supplies no host`);
    assert.equal(plan.widened, false);
  }
});

test("the last -H wins, as next itself resolves a repeated option", () => {
  // Given a caller who passes the flag twice
  const plan = planNextRun({
    command: "dev",
    extra: ["-H", "0.0.0.0", "-H", "127.0.0.1"],
    envValue: undefined,
  });
  // When the effective bind is computed
  // Then it matches what commander will hand next, so the warning cannot disagree
  assert.equal(plan.effectiveBindHost, "127.0.0.1");
  assert.equal(plan.widened, false, "a narrowing override must not warn");
});

test("an override that narrows an opted-in bind is not reported as widening", () => {
  // Given an opt-in that widens, and a caller pulling the bind back to loopback
  const plan = planNextRun({
    command: "dev",
    extra: ["-H", "127.0.0.1"],
    envValue: "nas.local",
  });
  // When the run is planned
  // Then the resolved bind still widens, but nothing is actually exposed
  assert.equal(plan.bindHost, ALL_INTERFACES_BIND);
  assert.equal(plan.effectiveBindHost, "127.0.0.1");
  assert.equal(plan.widened, false, "the warning must follow the socket, not the env var");
});
