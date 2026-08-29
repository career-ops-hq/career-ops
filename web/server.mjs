#!/usr/bin/env node
// server.mjs — starts the dashboard on the interface bind-host.mjs chooses.
//
// A thin shell on purpose: every decision lives in src/lib/bind-host.mjs, which
// is pure and unit-tested, so this file only resolves next, reports what is
// about to be exposed, and forwards the child's exit status. See that module and
// origin-guard.mjs's header for why the bind is the access control.
//
// Imports nothing outside web/: this tree is excluded from the core's packaging
// and coverage contracts (validate-system-paths-coverage.mjs EXCLUDE_PREFIXES),
// so lib/cli-flags.mjs and lib/is-main-module.mjs are out of reach by design.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planNextRun } from "./src/lib/bind-host.mjs";

const requireHere = createRequire(import.meta.url);
const [command, ...extra] = process.argv.slice(2);

const plan = planNextRun({
  command,
  extra,
  envValue: process.env.CAREER_OPS_WEB_ALLOWED_HOSTS,
});
if (!plan.ok) {
  console.error(plan.error);
  process.exit(1);
}

// Reported before next is resolved: a user whose install is broken should still
// learn their run would have been network-reachable, and the required CI job has
// no web/node_modules, so anything below the resolve is untestable there.
if (plan.widened) {
  const why = plan.overridden
    ? `-H ${plan.effectiveBindHost} overrides the resolved bind`
    : `allowed hosts: ${plan.allowedHosts.join(", ")}`;
  console.error(
    `career-ops web: binding ${plan.effectiveBindHost} — reachable from your network (${why}).`,
  );
  if (plan.overridden && plan.grantsNoNewHost) {
    // The one combination with no honest reading: an open port whose Host filter
    // names nobody it could not already serve on loopback. It refuses LAN clients
    // that identify themselves truthfully and admits any that spell
    // `Host: localhost`. A list of only loopback spellings counts as naming
    // nobody, which is why this asks what the list grants rather than its length.
    console.error(
      "career-ops web: CAREER_OPS_WEB_ALLOWED_HOSTS names no host beyond loopback, so " +
        "the request guard will refuse honest clients on this interface and admit " +
        "spoofed loopback ones. Name the hosts that should reach it in that variable.",
    );
  }
} else {
  console.error(`career-ops web: binding ${plan.effectiveBindHost} — loopback only.`);
}

// next's declared entry, not the private dist path: node_modules/.bin/next is a
// .cmd on Windows that spawn() cannot exec without a shell, and a shell would
// reparse every forwarded argument.
let nextEntry;
try {
  const manifest = requireHere.resolve("next/package.json");
  nextEntry = join(dirname(manifest), requireHere(manifest).bin.next);
} catch (err) {
  console.error(
    err.code === "MODULE_NOT_FOUND"
      ? "Cannot find next — run `npm ci` in web/ and retry."
      : `Cannot resolve next (${err.code ?? "error"}): ${err.message}`,
  );
  process.exit(1);
}

// cwd is pinned to this file's directory rather than inherited: career-ops.ts
// resolves the checkout as `resolve(process.cwd(), "..")`, so a run started from
// the repo root would otherwise read the repo's PARENT as the career-ops root.
//
// spawnSync because the child runs until Ctrl-C and this process has nothing to
// do meanwhile. The terminal delivers SIGINT to the whole foreground group, so
// next shuts itself down; re-signalling it from here would only double up.
const result = spawnSync(process.execPath, [nextEntry, ...plan.argv], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  stdio: "inherit",
});

if (result.error) {
  console.error(`Could not start next: ${result.error.message}`);
  process.exit(1);
}
// A signalled child reports status null. Exiting 128+signal keeps a SIGTERM
// distinguishable from a startup failure.
process.exit(result.signal ? 128 + (os.constants.signals[result.signal] ?? 0) : result.status ?? 1);
