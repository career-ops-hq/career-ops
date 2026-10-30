import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInbox } from "../../src/lib/pipeline-table.mjs";

test("a colon inside location or pay stays on the row", () => {
  const [row] = parseInbox(
    "- [ ] https://example.com/j | Acme | Engineer | Hybrid: London | OTE: 180k | posted: 2026-10-01\n",
  );
  assert.equal(row.location, "Hybrid: London");
  assert.equal(row.compensation, "OTE: 180k");
  assert.equal(row.postedAt, "2026-10-01");
});

test("posted, trust, note, and rank stay labels when the row has no city or pay", () => {
  const [row] = parseInbox(
    "- [ ] https://example.com/j | Acme | Engineer | posted: 2026-10-01 | trust: 62 stale | note: keep | rank: 3\n",
  );
  assert.equal(row.location, undefined);
  assert.equal(row.compensation, undefined);
  assert.equal(row.postedAt, "2026-10-01");
  assert.equal(row.company, "Acme");
  assert.equal(row.role, "Engineer");
});
