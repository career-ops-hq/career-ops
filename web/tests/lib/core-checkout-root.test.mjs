import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { listTree } from "../../../lib/walk-tree.mjs";

// careerOpsRoot() is the DATA root. Since #4064 it honors CAREER_OPS_ROOT,
// CAREER_OPS_DATA_DIR and the `.career-ops-data` marker, so in a split layout it
// points at a directory holding cv.md / data/ / reports/ — and no scripts, system
// modes, templates or lib/. Anything that RUNS or READS system files must resolve
// against resolveCodeRoot() (core/code-root.mjs) instead. When they were conflated, a split-layout
// install read as data-only: Explore showed "Discovery needs the full toolkit",
// and Doctor, Follow-ups and Portals verify quietly reported themselves
// unavailable, because every existsSync(rootScript(...)) looked in the data dir.
//
// Source-reading assertions, in the style of config-form-persist-wiring.test.mjs:
// career-ops.ts imports through the "@/..." alias, so it can't be loaded here.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

const sources = listTree(SRC, { match: /\.(ts|tsx|mjs)$/ }).map((p) => ({ rel: relative(SRC, p).split(sep).join("/"), src: readFileSync(p, "utf8") }));

test("rootScript resolves against the code checkout, not the data root", () => {
  const src = read("lib/career-ops.ts");
  const body = src.slice(src.indexOf("export function rootScript"), src.indexOf("export function trackerCanDelete"));
  assert.match(body, /resolveCodeRoot\(process\.cwd\(\), process\.env\)/);
  assert.doesNotMatch(body, /careerOpsRoot\(\)/);
});

test("careerOpsRoot derives the data root from the same checkout base", () => {
  const src = read("lib/career-ops.ts");
  const body = src.slice(src.indexOf("export function careerOpsRoot"), src.indexOf("export function rootScript"));
  assert.match(body, /const coreRoot = resolveCodeRoot\(process\.cwd\(\), process\.env\)/);
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
  assert.deepEqual(offenders, [], `system paths must use resolveCodeRoot():\n${offenders.join("\n")}`);
});

// `careerOpsRoot()` ends in `)`, which has no word boundary before `,` or `}` —
// so the call and the bare `root` variable are separate alternatives and only the
// variable gets a trailing \b.
const DATA_ROOT_CWD = /cwd:\s*(?:careerOpsRoot\(\)|root\b)/;

test("the cwd check detects both forbidden forms", () => {
  assert.match("{ cwd: careerOpsRoot(), timeout: 1 }", DATA_ROOT_CWD);
  assert.match("{ cwd: careerOpsRoot() }", DATA_ROOT_CWD);
  assert.match("{ cwd: root, timeout: 1 }", DATA_ROOT_CWD);
  assert.doesNotMatch("{ cwd: resolveCodeRoot(process.cwd(), process.env) }", DATA_ROOT_CWD);
  assert.doesNotMatch("{ cwd: rootDir }", DATA_ROOT_CWD);
});

// The assistant spawns an agent CLI that works on the user's files, so its cwd is
// the data root; it only imports rootScript() to load lib/personalization.
const AGENT_CWD_ALLOWED = new Set(["app/api/assistant/route.ts"]);

test("core scripts run with the code checkout as cwd", () => {
  // The CLI runs scripts from the checkout (doctor.mjs, e.g., looks for the MCP
  // config in its cwd); scripts find the data root themselves via path-resolver.
  const offenders = [];
  for (const { rel, src } of sources) {
    if (!/rootScript\(/.test(src) || rel === "lib/career-ops.ts" || AGENT_CWD_ALLOWED.has(rel)) continue;
    if (DATA_ROOT_CWD.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `script spawns must use cwd: resolveCodeRoot(process.cwd(), process.env):\n${offenders.join("\n")}`);
});
