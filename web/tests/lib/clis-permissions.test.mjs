// No runtime in KNOWN may grant itself blanket write permission.
//
// The web's permission model is per-worker AND per-CLI, but only the worker
// axis is written down: WRITE_CAPABLE_TOOLS and the per-kind deny lists live in
// claude-invocation.mjs, on Claude's path. So a CLI entry carrying a global
// auto-approve flag does not break a rule — it enters where the rule does not
// exist, and nothing goes red.
//
// The concrete failure: `pdf` has Bash explicitly denied (#2172). Pair a CLI
// with `--always-approve` and that same worker gets Write and Bash
// auto-approved, so the user's runtime choice silently changes what a worker
// may do to their files — with both paths identical in the UI.
//
// clis.ts is TypeScript and this test is .mjs, so KNOWN is read as text. Same
// deliberate choice as clis-coverage.test.mjs: a regex over the shipped source
// is enough to catch a forgotten flag and needs no build step.
//
// Run:  node --test tests/lib/clis-permissions.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIS_TS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "clis.ts");
const src = readFileSync(CLIS_TS, "utf8");

/** The KNOWN array body — the shipped argv, not the surrounding prose. A flag
 *  named in the header comment as forbidden must not make this test fail.
 *
 *  Anchored past the `=` on purpose: `indexOf("[")` finds the bracket in the
 *  TYPE (`CliSpec[]`), not the array literal. That still produced the right
 *  answer, since the extra four characters carry no flags and the closing
 *  `\n];` is the real one — but a parser that is accidentally correct is the
 *  thing this whole file exists to distrust. `[^=]*` skips the annotation, so
 *  `CliSpec[]`, `Array<CliSpec>` and `readonly CliSpec[]` all land on the
 *  literal itself. (Caught by career-ops-maintainer in review.) */
function knownBody(text) {
  return text.match(/export const KNOWN[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? "";
}

/** Flags that hand a CLI blanket approval for write-capable tools. */
const AUTO_APPROVE = [
  "--always-approve",
  "--dangerously-skip-permissions",
  "--yolo",
  "--auto-approve",
  "--approve-all",
  "--skip-permissions",
  "--no-confirm",
];

const body = knownBody(src);

test("the fixture this guard reads still looks like itself", () => {
  // Without this, a refactor that moves or renames KNOWN would leave every
  // check below scanning an empty string and passing vacuously — green by
  // measuring nothing, which is the failure mode this whole file exists for.
  assert.notEqual(body, "", "KNOWN not found in clis.ts — has the file changed shape?");
  const entries = [...body.matchAll(/id:\s*"([^"]+)"/g)].length;
  assert.ok(entries >= 7, `KNOWN parsed as ${entries} entries — the regex has stopped seeing the array`);
});

test("no runtime grants itself blanket write permission", () => {
  const found = AUTO_APPROVE.filter((flag) => body.includes(flag));
  assert.deepEqual(
    found,
    [],
    `KNOWN contains auto-approve flag(s): ${found.join(", ")}. A CLI with no per-tool deny list must be given fewer workers, not blanket approval — see the comment above KNOWN and claude-invocation.mjs.`,
  );
});

test("the guard actually fires (mutation check)", () => {
  // A guard nobody has seen fail is a hypothesis. Prove this one discriminates.
  const mutated = body.replace(/args:\s*\(p\)\s*=>\s*\[/, 'args: (p) => ["--always-approve", ');
  assert.notEqual(mutated, body, "mutation did not apply — the args shape changed, revisit this test");
  assert.ok(
    AUTO_APPROVE.some((flag) => mutated.includes(flag)),
    "the mutated source should trip the check above",
  );
});
