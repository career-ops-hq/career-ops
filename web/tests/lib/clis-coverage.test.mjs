// Every CLI with a documented headless invocation must be selectable in the web UI.
//
// This guards the drift that let Grok Build CLI go missing: it was wired into
// doctor.mjs (VALID_CLIS), the scaffolder, docs/SUPPORTED_CLIS.md, the README
// and .grok/skills/, yet KNOWN in web/src/lib/clis.ts never listed it — so the
// web UI silently could not run on it. Nothing tied the two lists together.
//
// clis.ts is TypeScript and these tests are .mjs, so KNOWN is read as text. That
// is deliberate: a regex over `bin: "..."` is enough to catch a forgotten entry,
// and it keeps the guard free of a build step.
//
// Run:  node --test tests/lib/clis-coverage.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIS_TS = join(WEB, "src", "lib", "clis.ts");
const SUPPORTED_MD = join(WEB, "..", "docs", "SUPPORTED_CLIS.md");

/** Binaries KNOWN can spawn. */
function knownBins(src) {
  return new Set([...src.matchAll(/bin:\s*"([^"]+)"/g)].map((m) => m[1]));
}

/** Binaries docs/SUPPORTED_CLIS.md promises work headlessly. A CLI documented
 *  as interactive-only (Cursor, Kimi) is correctly absent from KNOWN — the web
 *  UI drives workers headlessly and has nothing to offer them. */
function documentedHeadlessBins(md) {
  return new Set([...md.matchAll(/Headless\/Batch:\s*`([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
}

const src = readFileSync(CLIS_TS, "utf8");
const md = readFileSync(SUPPORTED_MD, "utf8");

test("the fixtures this guard reads still look like themselves", () => {
  // If either file is refactored past these regexes, the checks below would
  // pass vacuously over empty sets. Fail loudly instead.
  assert.ok(knownBins(src).size >= 7, "KNOWN parsed as near-empty — has clis.ts changed shape?");
  assert.ok(documentedHeadlessBins(md).size >= 5, "no headless rows parsed — has the docs table changed shape?");
});

test("every documented headless CLI is selectable in the web UI", () => {
  const known = knownBins(src);
  const missing = [...documentedHeadlessBins(md)].filter((bin) => !known.has(bin));
  assert.deepEqual(missing, [], `documented headless but absent from KNOWN in clis.ts: ${missing.join(", ")}`);
});

test("Grok Build CLI is wired up", () => {
  // The regression that motivated this file. Named explicitly so a future
  // reshuffle of the docs table can't quietly drop coverage for it.
  assert.match(src, /id:\s*"grok"/, "KNOWN is missing the grok entry");
  assert.match(src, /bin:\s*"grok"/, "the grok entry must spawn the `grok` binary");
});

test("no CLI is listed twice", () => {
  const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in KNOWN: ${ids.join(", ")}`);
});
