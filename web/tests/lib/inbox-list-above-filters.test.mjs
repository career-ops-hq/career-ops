import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("the inbox list sits above LinkedIn and the filters", () => {
  const triage = readFileSync(join(root, "src/components/inbox/inbox-triage.tsx"), "utf8");
  const list = triage.indexOf("<ul");
  const paste = triage.indexOf("<LinkedInPaste");
  const filters = triage.indexOf("<FacetChips");
  const keys = triage.indexOf("j and k move");
  assert.ok(list > 0, "the inbox renders a list");
  assert.ok(paste > list, "LinkedIn sits under the list");
  assert.ok(filters > list, "the filters sit under the list");
  assert.ok(keys > filters, "the keyboard hint sits with the filters");

  const pipeline = readFileSync(join(root, "src/components/pipeline-view.tsx"), "utf8");
  assert.doesNotMatch(pipeline, /LinkedInPaste/);
});
