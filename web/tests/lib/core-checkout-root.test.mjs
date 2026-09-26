import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNestedCheckout } from "../../../lib/mjs-files.mjs";

// careerOpsRoot() is the DATA root. Since #4064 it honors CAREER_OPS_ROOT,
// CAREER_OPS_DATA_DIR and the `.career-ops-data` marker, so in a split layout it
// points at a directory holding cv.md / data/ / reports/ — and no scripts, system
// modes, templates or lib/. Anything that RUNS or READS system files must resolve
// against coreCheckoutRoot() instead. When they were conflated, a split-layout
// install read as data-only: Explore showed "Discovery needs the full toolkit",
// and Doctor, Follow-ups and Portals verify quietly reported themselves
// unavailable, because every existsSync(rootScript(...)) looked in the data dir.
//
// Source-reading assertions, in the style of config-form-persist-wiring.test.mjs:
// career-ops.ts imports through the "@/..." alias, so it can't be loaded here.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return isNestedCheckout(p) ? [] : walk(p);
    return /\.(ts|tsx|mjs)$/.test(name) ? [p] : [];
  });
}
const sources = walk(SRC).map((p) => ({ rel: relative(SRC, p), src: readFileSync(p, "utf8") }));

test("rootScript resolves against the code checkout, not the data root", () => {
  const src = read("lib/career-ops.ts");
  const body = src.slice(src.indexOf("export function rootScript"), src.indexOf("export function trackerCanDelete"));
  assert.match(body, /coreCheckoutRoot\(\)/);
  assert.doesNotMatch(body, /careerOpsRoot\(\)/);
});

test("careerOpsRoot derives the data root from the same checkout base", () => {
  const src = read("lib/career-ops.ts");
  const body = src.slice(src.indexOf("export function careerOpsRoot"), src.indexOf("export function rootScript"));
  assert.match(body, /const coreRoot = coreCheckoutRoot\(\)/);
});

// A path that only exists in the code checkout, joined onto the data root.
// modes/_profile.md is the one user-layer file under modes/, so it is allowed.
const SYSTEM_PATH_ON_DATA_ROOT = [
  /(?:careerOpsRoot\(\)|\broot)\s*,\s*"[^"]+\.mjs"/,
  /(?:careerOpsRoot\(\)|\broot)\s*,\s*"(?:templates|lib)"/,
  /(?:careerOpsRoot\(\)|\broot)\s*,\s*"modes"\s*,\s*"(?!_profile\.md")/,
  /(?:careerOpsRoot\(\)|\broot)\s*,\s*"config"\s*,\s*"profile\.example\.yml"/,
];

test("no system file (script, template, system mode, example config) is read from the data root", () => {
  const offenders = [];
  for (const { rel, src } of sources) {
    src.split("\n").forEach((line, i) => {
      if (SYSTEM_PATH_ON_DATA_ROOT.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `system paths must use coreCheckoutRoot():\n${offenders.join("\n")}`);
});

test("core scripts run with the code checkout as cwd", () => {
  // The CLI runs scripts from the checkout (doctor.mjs, e.g., looks for the MCP
  // config in its cwd); scripts find the data root themselves via path-resolver.
  const offenders = [];
  for (const { rel, src } of sources) {
    if (!/rootScript\(/.test(src) || rel === "lib/career-ops.ts") continue;
    if (/cwd:\s*(?:careerOpsRoot\(\)|root)\b/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `script spawns must use cwd: coreCheckoutRoot():\n${offenders.join("\n")}`);
});
