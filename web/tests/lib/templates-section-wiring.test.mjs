import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// templates-state.test.mjs proves latestOnly() discards an overtaken load, but it
// cannot see whether the component starts the load that does the overtaking. A
// default chosen while an older reload is still in flight is shown correctly only
// until that reload lands with the old default, unless choosing starts a newer
// load. Source-reading, in the style of config-form-persist-wiring.test.mjs.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/templates/templates-section.tsx"),
  "utf8",
);
const choose = src.slice(src.indexOf("const choose = async"), src.indexOf("const manage = async"));

test("choosing a default starts a fresh load once the save succeeded", () => {
  assert.ok(choose.length > 0, "found the choose handler");
  assert.match(choose, /else\s*{[^}]*setTemplates[\s\S]*?\bload\(\)/, "success path reloads after applying the choice");
});

test("a failed save does not reload, so the error and the list stay as they were", () => {
  const failure = choose.slice(choose.indexOf("if (!res.ok)"), choose.indexOf("else"));
  assert.doesNotMatch(failure, /\bload\(\)/);
});
