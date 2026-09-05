// Parity + regression tests for the web's asciiFold mirror.
// Imports the core and the web copy side-by-side so they can never drift, the
// same shape normalize-text-key.test.mjs and url-key.test.mjs already use.
//
// Run:  node --test tests/lib/ascii-fold.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { asciiFold as webFold } from "../../src/lib/core/ascii-fold.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { asciiFold: coreFold } = await import(pathToFileURL(join(ROOT, "lib", "ascii-fold.mjs")).href);

const CASES = [
  "Telefónica", "Škoda", "Ørsted", "Société Générale", "Nestlé",
  "Peugeot Citroën", "Bâloise", "Sparkasse Köln", "Işık",
  // The non-decomposing Latin letters the core enumerates by hand — the part a
  // naive NFD-only mirror would get wrong.
  "Ørsted", "Æther", "Œuvre", "Straße", "Đorđević", "Łódź", "Þór", "Ðan",
  "Ħamrun", "Iğdır", "Ŋaro", "Ŧorp", "Kalaallit ĸ", "ſharp",
  // No Latin content at all.
  "日本電産", "Яндекс", "Ελλάδα",
  // Plain ASCII must be untouched.
  "Acme Inc", "AT&T", "Smith&Jones", "O'Reilly Media", "",
];

test("the web mirror folds identically to the core, in both punctuation modes", () => {
  const drift = [];
  for (const value of CASES) {
    for (const punctuation of ["space", "delete"]) {
      const web = webFold(value, { punctuation });
      const core = coreFold(value, { punctuation });
      if (web !== core) drift.push(`${JSON.stringify(value)} (${punctuation}): web ${JSON.stringify(web)} vs core ${JSON.stringify(core)}`);
    }
  }
  assert.deepEqual(drift, [], `web/src/lib/core/ascii-fold.mjs has drifted from lib/ascii-fold.mjs:\n  ${drift.join("\n  ")}`);
});

test("the default punctuation mode matches the core's default", () => {
  for (const value of CASES) assert.equal(webFold(value), coreFold(value), value);
});

test("folding transliterates rather than deleting — the whole point", () => {
  // A guard, not a parity check: if both copies were changed to delete, the
  // test above would still pass while the defect returned.
  assert.equal(webFold("Telefónica", { punctuation: "delete" }), "telefonica");
  assert.equal(webFold("Škoda", { punctuation: "delete" }), "skoda");
  assert.equal(webFold("Ørsted", { punctuation: "delete" }), "orsted");
  assert.equal(webFold("Straße", { punctuation: "delete" }), "strasse");
  assert.equal(webFold("Ŋaro", { punctuation: "delete" }), "ngaro", "ŋ is 'ng', not 'n'");
});
