import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/pipeline-view.tsx"),
  "utf8",
);

test("a failed status save is shown when no rows are checked", () => {
  const toolbarAt = source.indexOf('visibleTab !== "INBOX" && selectedRows.length > 0 &&');
  const alertAt = source.indexOf('visibleTab !== "INBOX" && bulkError &&');
  assert.ok(toolbarAt > 0 && alertAt > toolbarAt);
  assert.equal(source.slice(toolbarAt, alertAt).includes('role="alert"'), false);
  assert.match(source.slice(alertAt, alertAt + 220), /role="alert"/);
});
