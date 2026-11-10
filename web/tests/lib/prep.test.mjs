// Tests for the Preparation page helpers.
// Run:  node --test tests/lib/prep.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveInside, parseTaskItems, tickKey, countDone } from "../../src/lib/prep.mjs";

const base = path.resolve("/tmp/output");

test("resolveInside allows files inside the base", () => {
  assert.equal(resolveInside(base, "acme/role/evaluation.md"), path.join(base, "acme", "role", "evaluation.md"));
});

test("resolveInside rejects traversal and the base itself", () => {
  assert.equal(resolveInside(base, "../secret.md"), null);
  assert.equal(resolveInside(base, "acme/../../secret.md"), null);
  assert.equal(resolveInside(base, ".."), null);
  assert.equal(resolveInside(base, ""), null);
  assert.equal(resolveInside(base, "../output-evil/x.md"), null); // sibling sharing the prefix
});

test("parseTaskItems reads checked and unchecked items only", () => {
  const md = "# T\n- [ ] one\n  * [x] two\n- plain bullet\n+ [X] three\r\n- [ ]no space\n";
  assert.deepEqual(parseTaskItems(md), [
    { text: "one", done: false },
    { text: "two", done: true },
    { text: "three", done: true },
  ]);
});

test("countDone: a saved tick overrides the markdown state", () => {
  const items = parseTaskItems("- [ ] a\n- [x] b\n- [ ] c\n");
  assert.equal(countDone("f.md", items, {}), 1);
  assert.equal(countDone("f.md", items, { [tickKey("f.md", "a")]: true, [tickKey("f.md", "b")]: false }), 1);
  assert.equal(countDone("other.md", items, { [tickKey("f.md", "a")]: true }), 1); // other file's ticks ignored
});

test("tickKey trims and caps long text", () => {
  assert.equal(tickKey("f", "  hi  "), "f::hi");
  assert.equal(tickKey("f", "x".repeat(300)).length, "f::".length + 120);
});
