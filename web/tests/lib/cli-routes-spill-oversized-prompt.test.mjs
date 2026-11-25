// Every CLI route that builds an argv from a prompt must spill an oversized one.
//
// Windows caps a command line at 32,767 UTF-16 units and POSIX at 128 KiB per
// argument, so a prompt built from user content eventually fails the spawn with
// an opaque `spawn ENAMETOOLONG` / `E2BIG`. `spillOversizedPrompt` writes the
// prompt to a file under the data root and puts a short pointer in argv.
//
// Five routes learned that one at a time (#6743, #7150, cv/ingest, explore/ai,
// the apply planner); /api/assistant was the one still passing its whole
// conversation as a single argv element. This test makes the rule structural: a
// route that spawns a CLI and does not spill fails here, instead of failing in a
// user's chat with a filled profile.
//
// The walk is `listTree` from `lib/walk-tree.mjs` rather than a local recursive
// readdir: that module applies the nested-checkout guard on every descent, and
// `tests/walk-tree.test.mjs` requires the whole repository to route its walks
// through it.
//
// Run:  node --test web/tests/lib/cli-routes-spill-oversized-prompt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const API = join(WEB, "src", "app", "api");

/** Every route.ts under app/api, as absolute paths. */
const routeFiles = () => listTree(API, { match: /route\.ts$/ });

/** A route's path relative to the web root, with forward slashes. */
const rel = (file) => file.slice(WEB.length + 1).replace(/\\/g, "/");

test('a route that spawns a CLI also spills an oversized prompt', () => {
  const offenders = [];
  for (const file of routeFiles()) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("spawnHeadlessCli")) continue;
    if (!text.includes("spillOversizedPrompt")) offenders.push(rel(file));
  }
  assert.deepEqual(offenders, [],
    `these CLI routes pass their prompt straight into argv: ${offenders.join(", ")}`);
});

test('a route that spills gives the spawn the spilled argv, not the raw one', () => {
  // Spilling and then spawning with the original argv would look right and fail
  // exactly as before, so the call has to use what the spill returned.
  for (const file of routeFiles()) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("spillOversizedPrompt")) continue;
    const name = rel(file);
    assert.match(text, /spill\.args/, `${name} spills a prompt but spawns something else`);
    assert.match(text, /spill\?\.cleanup\?\.\(\)/, `${name} never cleans up the spilled prompt`);
  }
});