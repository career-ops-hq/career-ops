import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("first-run home does not claim no setup", () => {
  const src = readFileSync(join(root, "src/components/home/first-run-home.tsx"), "utf8");
  assert.doesNotMatch(src, /No setup/);
  // Since #6238 any configured AI CLI converts a PDF, so this line is right again.
  assert.match(src, /PDF needs an AI CLI/);
});

test("pasted CV text can start without a CLI", () => {
  const src = readFileSync(join(root, "src/components/cv/cv-ingest.tsx"), "utf8");
  assert.match(src, /Pasted text is already readable/);
  assert.match(src, /setPhase\("review"\)/);
  assert.match(src, /setSeed\(null\)/);
});

test("review does not say the CV is saved before Save", () => {
  const src = readFileSync(join(root, "src/components/cv/cv-ingest.tsx"), "utf8");
  assert.match(src, /Nothing is saved until you click Save/);
  assert.doesNotMatch(src, /Saved locally to cv\.md/);
  // The editor variant describes what Save will do, not something already done.
  assert.match(src, /Save updates cv\.md and backs up the previous version/);
  assert.doesNotMatch(src, /Parsed by your own AI/);
});
