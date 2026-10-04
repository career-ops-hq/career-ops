// The bind decision, tested on values.
//
// This is the module the launcher exists to apply, so these are the cases that
// decide whether the dashboard is reachable from the network. Several are
// regressions that shipped once and were caught in review:
//
//   - a loopback-only opt-in used to widen the socket to every interface while
//     granting no host the Host filter did not already admit;
//   - the widened warning used to be read off the env value, so a caller-supplied
//     -H could open the socket with the startup notice staying silent;
//   - any string the loopback predicate rejected counted as an opt-in, so
//     CAREER_OPS_WEB_ALLOWED_HOSTS=off bound every interface;
//   - naming one LAN address bound every interface rather than that address.
//
// Run:  node --test tests/lib/bind-host.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedHosts, isLoopbackHost } from "../../src/lib/origin-guard.mjs";
import {
  LOOPBACK_BIND,
  ALL_INTERFACES_BIND,
  NEXT_COMMANDS,
  validateAllowedHosts,
  resolveBindHost,
  isWidenedBind,
  isWildcardAddress,
  hasHostFlag,
  planNextRun,
} from "../../src/lib/bind-host.mjs";

// --- validateAllowedHosts -------------------------------------------------

test("a value that reads as a switch is refused, not treated as a host", () => {
  // Given the words someone types to turn exposure OFF. Each is a syntactically
  // valid hostname, so the loopback predicate rejects it and it used to count as
  // an opt-in — binding every interface for a user asking for the opposite.
  for (const envValue of ["off", "false", "no", "0", "none", "disabled"]) {
    // When the value is validated
    const result = validateAllowedHosts(envValue);
    // Then the run is refused with the reason, rather than silently widening
    assert.equal(result.ok, false, `${JSON.stringify(envValue)} must be refused`);
    assert.match(result.error, /not a switch/, "the message must explain what the variable is");
  }
});

test("a token that is not a hostname or an address is refused", () => {
  // Given values no resolver could take
  // `10.0.0.999` and `010.0.0.1` are the near-misses: neither is a valid address,
  // and both would otherwise have passed as all-numeric "hostnames" and opened
  // the socket. A leading-zero quad is read as octal by some resolvers and
  // decimal by others, which is no basis for a bind or an allow-list comparison.
  for (const envValue of ["what?!", "-nas", "host_name", "10.0.0.999", "010.0.0.1", "192.168.1"]) {
    // When the value is validated
    const result = validateAllowedHosts(envValue);
    // Then it fails fast and names the offending token
    assert.equal(result.ok, false, `${JSON.stringify(envValue)} must be refused`);
  }
});

test("an every-interface address is refused as an allowed host", () => {
  // Given the wildcards, in each spelling. Accepting one was the worst state the
  // module can reach: the socket opens on every interface while the guard still
  // matches Host literally, so an honest LAN client gets 403 and only a client
  // spelling `Host: 0.0.0.0` is admitted — and grantsNoNewHost, which flags that
  // shape elsewhere, reads false because the list does name a non-loopback host.
  for (const envValue of ["0.0.0.0", "::", "0::0", "0:0:0:0:0:0:0:0"]) {
    // When the value is validated
    const result = validateAllowedHosts(envValue);
    // Then it is refused: a bind target is not a host identity
    assert.equal(result.ok, false, `${JSON.stringify(envValue)} must be refused`);
    assert.match(result.error, /every interface/);
  }
});

test("an incomplete IPv6 address is refused, not treated as a bind target", () => {
  // Given addresses that look right to a colon-counting check but are not valid.
  // Leniency here cannot fail safe: whatever validation admits as a literal
  // becomes the address handed to `next -H`, and listen() then refuses to start
  // the server at all. The first parser here accepted every one of these.
  for (const envValue of ["2001:db8:1", "1:2:3", "2001:db8::5::1", "12345::1", "2001:db8:zz::1"]) {
    // When the value is validated
    // Then it is refused before it can reach the bind
    assert.equal(validateAllowedHosts(envValue).ok, false, `${envValue} is not a valid address`);
  }
  // And a well-formed address of each family is still accepted, so the check
  // discriminates rather than simply rejecting anything with colons
  assert.equal(validateAllowedHosts("2001:db8::5").ok, true);
  assert.equal(validateAllowedHosts("192.168.1.50").ok, true);
});

test("an unscoped link-local address is refused", () => {
  // Given a link-local address, which is ambiguous across interfaces and cannot
  // be bound without a zone index — listen() would fail on it
  for (const envValue of ["fe80::1", "febf::dead:beef"]) {
    // When the value is validated
    // Then it is refused rather than accepted as a bindable address
    assert.equal(validateAllowedHosts(envValue).ok, false, `${envValue} must be refused`);
  }
  // And the scoped spelling is refused too, as `%` is not a host character
  assert.equal(validateAllowedHosts("fe80::1%en0").ok, false);
});

test("multicast and limited-broadcast addresses are refused before planning a bind", () => {
  // Given address classes that are valid IP syntax but cannot identify one TCP
  // listener interface. Accepting one would make next fail during listen()
  // instead of returning the launcher's structured configuration error.
  for (const envValue of ["224.0.0.1", "239.255.255.250", "255.255.255.255", "ff02::1", "ff0e::dead:beef"]) {
    // When the value is validated directly and through the public planner
    const validation = validateAllowedHosts(envValue);
    const plan = planNextRun({ command: "dev", envValue });
    // Then neither path produces a bind target
    assert.equal(validation.ok, false, `${envValue} must be refused`);
    assert.match(validation.error, /not a unicast address/);
    assert.deepEqual(plan, validation, `${envValue} must fail before argv is built`);
  }
});

test("every spelling of every-interface is recognised as a wildcard", () => {
  // Given the wildcards, and the specific addresses they must not be confused
  // with. `loopbackUnreachable` is derived from this rather than from equality
  // with the 0.0.0.0 literal: `::` is the IPv6 wildcard and serves loopback just
  // as 0.0.0.0 does, so a literal comparison would have the launcher announce
  // that localhost stops answering while it answers fine.
  for (const host of [ALL_INTERFACES_BIND, "::", "0::0", "0:0:0:0:0:0:0:0"]) {
    // When each is classified
    assert.equal(isWildcardAddress(host), true, `${host} is every interface`);
  }
  // Then a real address is not swept up with them
  for (const host of ["192.168.1.50", "2001:db8::5", LOOPBACK_BIND, "::1", "10.0.0.4"]) {
    assert.equal(isWildcardAddress(host), false, `${host} is one interface`);
  }
});

test("a wildcard bind is never reported as costing loopback", () => {
  // Given the wildcard bind an opt-in can still produce, via a hostname
  const plan = planNextRun({ command: "dev", envValue: "nas.local, 10.0.0.4" });
  // When the run is planned
  // Then it widens but does not claim localhost stops answering
  assert.equal(plan.bindHost, ALL_INTERFACES_BIND);
  assert.equal(plan.widened, true);
  assert.equal(plan.loopbackUnreachable, false, "a wildcard bind still answers on loopback");
});

test("a URL written where a host belongs is refused", () => {
  // Given a URL. Host-header normalization cuts at the first colon, so this
  // arrives as the bare name `http` — valid, non-loopback, and would have opened
  // the socket while appearing to name an address.
  const result = validateAllowedHosts("http://192.168.1.50");
  // When the value is validated
  // Then it is refused with the reason, not resolved to the scheme name
  assert.equal(result.ok, false);
  assert.match(result.error, /not URLs/);
});

test("real hosts and addresses are accepted", () => {
  // Given the spellings the README tells users to write
  for (const envValue of ["192.168.1.50", "nas.local", "dev-box", "2001:db8::5", "nas.local.", "a.b, 10.0.0.4"]) {
    // When the value is validated
    // Then it is accepted, so a legitimate opt-in is never blocked by the guard
    assert.equal(validateAllowedHosts(envValue).ok, true, `${JSON.stringify(envValue)} must be accepted`);
  }
});

test("an absent or blank value is accepted and names nobody", () => {
  // Given no opt-in, in each spelling a shell or a stray comma produces
  for (const envValue of [undefined, "", " ", ",", " , , ", ":3000", "[]"]) {
    // When the value is validated
    const result = validateAllowedHosts(envValue);
    // Then it passes with an empty list — blankness is not a typo
    assert.equal(result.ok, true, `${JSON.stringify(envValue)} must not be an error`);
    assert.deepEqual(result.hosts, []);
  }
});

// --- resolveBindHost ------------------------------------------------------

test("an absent or blank opt-in keeps the socket on loopback", () => {
  // Given no opt-in
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

test("naming one address binds that address, not every interface", () => {
  // Given a single IP literal — the documented way to reach one LAN box
  // When the bind is resolved
  // Then only that interface is published: 0.0.0.0 would also expose a VPN
  // tunnel or a phone hotspot that was never opted in to.
  assert.equal(resolveBindHost("192.168.1.50"), "192.168.1.50");
  assert.equal(resolveBindHost("192.168.1.50:3000"), "192.168.1.50", "a port is not part of the address");
  assert.equal(resolveBindHost("2001:db8::5"), "2001:db8::5", "an IPv6 literal binds too — 0.0.0.0 could not serve it");
});

test("naming a loopback host alongside an address opts back into every interface", () => {
  // Given a caller who wants the LAN box AND their own browser to reach it
  // When the bind is resolved
  // Then it widens, because one socket cannot carry two addresses — this is the
  // documented escape hatch from the single-address bind above
  assert.equal(resolveBindHost("192.168.1.50, localhost"), ALL_INTERFACES_BIND);
  assert.equal(resolveBindHost("127.0.0.1 10.0.0.4"), ALL_INTERFACES_BIND);
});

test("anything the launcher cannot bind to one address falls back to every interface", () => {
  // Given a hostname, which needs a resolver this module deliberately lacks, or
  // two addresses, which cannot share a socket
  // When the bind is resolved
  // Then it widens rather than guessing
  assert.equal(resolveBindHost("nas.local"), ALL_INTERFACES_BIND);
  assert.equal(resolveBindHost("10.0.0.4, 10.0.0.5"), ALL_INTERFACES_BIND);
  assert.equal(resolveBindHost("nas.local, 10.0.0.4"), ALL_INTERFACES_BIND);
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
      isWidenedBind(resolveBindHost(envValue)),
      grantsSomethingNew,
      `${JSON.stringify(envValue)}: the bind must widen iff the filter gains a non-loopback host`,
    );
  }
});

// --- isWidenedBind --------------------------------------------------------

test("a bind is widened only when it is not a loopback address", () => {
  // Given every address this module can now produce
  // When each is classified
  // Then the answer follows the address itself, not a comparison to one literal —
  // which matters more now that a specific LAN address is one of the outcomes
  assert.equal(isWidenedBind(ALL_INTERFACES_BIND), true);
  assert.equal(isWidenedBind(LOOPBACK_BIND), false);
  assert.equal(isWidenedBind("::1"), false, "IPv6 loopback must not read as widened");
  assert.equal(isWidenedBind("127.0.0.2"), false, "the whole 127/8 range is loopback");
  assert.equal(isWidenedBind("192.168.1.50"), true);
});

// --- hasHostFlag ----------------------------------------------------------

test("every spelling of next's hostname flag is detected", () => {
  // Given the forms commander accepts, including the attached short form that
  // was once missed — which made the launcher announce loopback while next
  // opened every interface
  for (const extra of [
    ["-H", "0.0.0.0"], ["-H0.0.0.0"], ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"],
    ["-H"], ["--hostname"], ["-H", ""], ["--hostname="],
    ["-p", "4000", "-H0.0.0.0"], ["-H", "0.0.0.0", "-H", "127.0.0.1"],
  ]) {
    // When argv is scanned
    // Then the flag is seen regardless of how the value is attached, or absent
    assert.equal(hasHostFlag(extra), true, `${extra.join(" ")} supplies a hostname flag`);
  }
});

test("argv without a hostname flag is left alone", () => {
  // Given flags the launcher has no opinion about
  for (const extra of [[], ["-p", "4000"], ["--turbopack"], ["--experimental-https"]]) {
    // When argv is scanned
    // Then nothing is mistaken for the hostname flag, so the bind is still injected
    assert.equal(hasHostFlag(extra), false, `${extra.join(" ")} supplies no hostname flag`);
  }
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

test("an unreadable opt-in refuses the run rather than starting a widened server", () => {
  // Given a value that cannot be a host list
  const plan = planNextRun({ command: "dev", envValue: "off" });
  // When a run is planned
  // Then there is no argv to spawn — failing fast beats binding every interface
  assert.equal(plan.ok, false);
  assert.match(plan.error, /CAREER_OPS_WEB_ALLOWED_HOSTS/);
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
    assert.equal(plan.hostFlagSupplied, false);
  }
});

test("an opt-in that widens is reported along with the hosts that caused it", () => {
  // Given a real opt-in that cannot resolve to a single address
  const plan = planNextRun({ command: "start", envValue: "nas.local, 10.0.0.4" });
  // When the run is planned
  // Then the caller has everything needed to explain the exposure
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.argv, ["start", "-H", ALL_INTERFACES_BIND]);
  assert.equal(plan.widened, true);
  assert.equal(plan.hostFlagSupplied, false);
  assert.equal(plan.loopbackUnreachable, false, "0.0.0.0 still answers on loopback");
  assert.deepEqual(plan.allowedHosts.sort(), ["10.0.0.4", "nas.local"]);
});

test("a single-address bind is flagged as costing loopback", () => {
  // Given the opt-in that now binds one address instead of every interface
  const plan = planNextRun({ command: "dev", envValue: "192.168.1.50" });
  // When the run is planned
  // Then the caller is told localhost will stop answering — the symptom
  // otherwise looks like a server that failed to start
  assert.deepEqual(plan.argv, ["dev", "-H", "192.168.1.50"]);
  assert.equal(plan.widened, true);
  assert.equal(plan.loopbackUnreachable, true);
});

test("a caller's own hostname flag hands the bind decision to next", () => {
  // Given a deliberate override, in each spelling commander accepts. Injecting a
  // second -H alongside it made this launcher's warning depend on how commander
  // resolves a duplicate — a bet against a dependency it has already lost once.
  for (const extra of [
    ["-H", "0.0.0.0"], ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"], ["-H0.0.0.0"],
    ["-H", ""], ["--hostname="], ["-H"], ["-H", "0.0.0.0", "-H", "127.0.0.1"],
  ]) {
    // When the run is planned
    const plan = planNextRun({ command: "dev", extra, envValue: undefined });
    // Then argv carries the caller's flag and nothing else, so there is no
    // duplicate for commander to resolve and no bind for the launcher to assert
    assert.equal(plan.ok, true, `${extra.join(" ")} must still produce a runnable plan`);
    assert.deepEqual(plan.argv, ["dev", ...extra], `${extra.join(" ")} must be forwarded untouched`);
    assert.equal(plan.hostFlagSupplied, true, `${extra.join(" ")} must be reported as caller-owned`);
    assert.deepEqual(plan.allowedHosts, [], "the filter still names nobody");
  }
});

test("a caller's flag does not silence the resolved bind, it replaces the claim", () => {
  // Given an override alongside an opt-in that would have widened
  const plan = planNextRun({ command: "dev", extra: ["-H", "127.0.0.1"], envValue: "nas.local" });
  // When the run is planned
  // Then the launcher injects nothing and reports that next owns the bind. The
  // resolved value is still there for context, but hostFlagSupplied is what any
  // claim about exposure must be read against.
  assert.deepEqual(plan.argv, ["dev", "-H", "127.0.0.1"]);
  assert.equal(plan.hostFlagSupplied, true);
  assert.equal(plan.bindHost, ALL_INTERFACES_BIND, "the resolved bind is unchanged and unused");
  assert.equal(plan.loopbackUnreachable, false, "no claim is made about a bind next chooses");
});

test("an allow-list of only loopback hosts grants nothing new", () => {
  // Given an opt-in naming hosts the guard already admits, plus a caller's flag
  // that may open the socket — the state that used to print no second notice
  const plan = planNextRun({
    command: "dev",
    extra: ["-H", "0.0.0.0"],
    envValue: "localhost, 127.0.0.1, ::1",
  });
  // When the run is planned
  // Then it is flagged: if that flag opens the port, the filter names nobody who
  // could not already reach it on loopback
  assert.equal(plan.hostFlagSupplied, true);
  assert.equal(plan.grantsNoNewHost, true, "a loopback-only list grants nothing");
});

test("an allow-list naming a reachable host does grant something", () => {
  // Given an opt-in that names a host loopback cannot serve
  const plan = planNextRun({ command: "dev", envValue: "nas.local" });
  // When the run is planned
  // Then the filter is meaningful and the second notice must not fire
  assert.equal(plan.grantsNoNewHost, false);
});
