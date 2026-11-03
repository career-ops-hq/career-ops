// Parity test for the core's copy of the CLI launcher.
//
// web/src/lib/cli-launch.mjs (#2626) launches an npm-installed CLI on Windows
// without a shell. rank-pipeline.mjs needs the same thing, but the core cannot
// import from web/: an install updated by update-system.mjs has no web/
// directory. So lib/cli-launch.mjs is a copy, held identical byte for byte, as
// lib/dir-lock.mjs is (see dir-lock.test.mjs). Edit one, then copy it over the
// other.
//
// Run:  node --test tests/lib/cli-launch-mirror.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CORE_FILE = path.join(ROOT, "lib", "cli-launch.mjs");
const WEB_FILE = path.join(ROOT, "web", "src", "lib", "cli-launch.mjs");

test("the core copy of the CLI launcher is byte-for-byte the web's", () => {
  const core = fs.readFileSync(CORE_FILE);
  const web = fs.readFileSync(WEB_FILE);
  if (core.equals(web)) return;
  // Name the first differing line, so the failure says what drifted.
  const coreLines = core.toString("utf8").split("\n");
  const webLines = web.toString("utf8").split("\n");
  const at = coreLines.findIndex((line, index) => line !== webLines[index]);
  const line = at === -1 ? Math.min(coreLines.length, webLines.length) : at;
  assert.fail(
    `lib/cli-launch.mjs has drifted from web/src/lib/cli-launch.mjs at line ${line + 1}:\n`
      + `  core: ${JSON.stringify(coreLines[line])}\n  web:  ${JSON.stringify(webLines[line])}\n`
      + "Edit one of them, then copy it over the other.",
  );
});
