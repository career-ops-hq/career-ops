import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractArrayFromSource } from "../update-system.mjs";

test("updater ships every pure web module imported by the scheduled runner", () => {
  const updater = fs.readFileSync(path.resolve("update-system.mjs"), "utf8");
  const manifest = extractArrayFromSource(updater, "SYSTEM_PATHS");
  const runnerPath = path.resolve("scripts/scheduled-jobs-runner.mjs");
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const runnerDir = path.dirname(runnerPath);
  const webDependencies = [...runnerSource.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)]
    .map(([, specifier]) => path.relative(process.cwd(), path.resolve(runnerDir, specifier)).split(path.sep).join("/"))
    .filter((dependency) => dependency.startsWith("web/"));
  assert.ok(webDependencies.length > 0, "expected the runner to import pure web modules");
  // The local runner intentionally reuses these side-effect-free web modules;
  // shipping them keeps scheduled scans working after a system update.
  for (const dependency of webDependencies) {
    assert.ok(fs.existsSync(path.resolve(dependency)), `${dependency} does not exist`);
    assert.ok(manifest.includes(dependency), `${dependency} is missing from SYSTEM_PATHS`);
  }
});
