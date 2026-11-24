import { test } from "node:test";
import assert from "node:assert/strict";
import { checkboxOptionWanted, checkboxSelections, confirmCheckbox } from "../../src/lib/apply/checkbox-options.mjs";

const teams = ["Sales, Marketing", "Engineering"];

test("one option that contains a comma stays one option", () => {
  assert.deepEqual(checkboxSelections("Sales, Marketing", teams), ["Sales, Marketing"]);
});

test("a joined answer selects each real option, longest first", () => {
  assert.deepEqual(checkboxSelections("Sales, Marketing, Engineering", teams), ["Sales, Marketing", "Engineering"]);
  assert.deepEqual(
    checkboxSelections("Sales, Marketing, Engineering", ["Sales", "Sales, Marketing", "Engineering"]),
    ["Sales, Marketing", "Engineering"],
  );
});

test("options can arrive in either order, and the form's spelling is kept", () => {
  assert.deepEqual(checkboxSelections("Engineering, Sales, Marketing", teams), ["Engineering", "Sales, Marketing"]);
  assert.deepEqual(checkboxSelections("engineering, sales, marketing", teams), ["Engineering", "Sales, Marketing"]);
});

test("plain options still split on commas", () => {
  assert.deepEqual(checkboxSelections("Sales, Marketing", ["Sales", "Marketing"]), ["Sales", "Marketing"]);
});

test("an unknown piece is kept so the fill can report it", () => {
  assert.deepEqual(checkboxSelections("Health, Vision", ["Health", "Dental"]), ["Health", "Vision"]);
});

test("an empty answer selects nothing", () => {
  assert.deepEqual(checkboxSelections("  ", teams), []);
  assert.deepEqual(checkboxSelections("", []), []);
});

test("a label cut on a space still matches the tidied option", () => {
  const cut = "word ".repeat(32);
  assert.equal(cut.length, 160);
  assert.equal(cut.endsWith(" "), true);
  const wanted = checkboxSelections(cut.trim(), [cut, "Dental"]);
  assert.deepEqual(wanted, [cut.trim()]);
  assert.equal(checkboxOptionWanted(wanted, cut), true);
  assert.equal(checkboxOptionWanted(wanted, "Dental"), false);
});

test("a checkbox read that fails is not a successful uncheck", async () => {
  const fail = async () => {
    throw new Error("unreadable");
  };
  assert.equal(await confirmCheckbox(fail, fail, false), false);
  assert.equal(await confirmCheckbox(fail, fail, true), false);
  assert.equal(await confirmCheckbox(fail, async () => false, false), true);
  assert.equal(await confirmCheckbox(fail, async () => true, false), false);
  assert.equal(await confirmCheckbox(async () => {}, fail, true), true);
});
