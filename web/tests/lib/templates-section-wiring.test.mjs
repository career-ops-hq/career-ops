import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The sequencing rules are tested as behavior in templates-state.test.mjs. This
// only checks the component actually goes through them, since the rules cannot
// see whether anything calls them. Source-reading, in the style of
// config-form-persist-wiring.test.mjs; deliberately no pattern spans a block.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/templates/templates-section.tsx"),
  "utf8",
);

test("choosing a default goes through settleChoice, which owns the apply-then-reload order", () => {
  assert.match(src, /import\s*{[^}]*\bsettleChoice\b[^}]*}\s*from\s*"@\/lib\/templates-state\.mjs"/);
  assert.match(src, /await settleChoice\(/);
});

test("a failed reload is classified by loadFailureView, not hard-coded", () => {
  assert.match(src, /setLoadError\(loadFailureView\(/);
});

test("Retry never passes the click event as the list-is-current flag", () => {
  assert.doesNotMatch(src, /onClick=\{load\}/);
});

test("no ref is written during render", () => {
  // A ref assigned in the component body is written by renders React may discard.
  // The one the load failure reads is set from the load success handler instead.
  assert.doesNotMatch(src, /^\s*\w+Ref\.current = templates;?\s*$/m);
});

test("the load success handler records that a list has loaded", () => {
  assert.match(src, /hasListRef\.current = true/);
});

// The <button> element that carries a given onClick call, and the expression in
// its own disabled={...} attribute (brace-balanced, so it may contain objects and
// arrow functions). A title that mentions editLocks must not satisfy a check on
// disabled.
function buttonOf(call) {
  const at = src.indexOf(call);
  assert.ok(at >= 0, `found ${call}`);
  const start = src.lastIndexOf("<button", at);
  return src.slice(start, src.indexOf("</button>", at));
}
function disabledOf(button) {
  const key = button.indexOf("disabled={");
  assert.ok(key >= 0, "the button has a disabled attribute");
  let depth = 0;
  for (let i = key + "disabled=".length; i < button.length; i++) {
    if (button[i] === "{") depth++;
    if (button[i] === "}" && --depth === 0) return button.slice(key + "disabled={".length, i);
  }
  assert.fail("unbalanced disabled attribute");
}

test("Edit, Rename and Delete each take their own lock in their disabled expression", () => {
  assert.match(src, /import\s*{[^}]*\beditLocks\b[^}]*}\s*from\s*"@\/lib\/templates-state\.mjs"/);
  const actions = {
    edit: "setEditing(t.name)",
    rename: 'ask(t.name, "rename")',
    remove: 'ask(t.name, "delete")',
  };
  for (const [lock, call] of Object.entries(actions)) {
    assert.ok(disabledOf(buttonOf(call)).includes(`editLocks(editing, t.name).${lock}`), `${lock}'s disabled expression uses its lock`);
  }
});

test("a button whose title mentions the lock but whose disabled does not is caught", () => {
  const sample = '<button type="button" disabled={busy !== null} title={editLocks(editing, t.name).edit ? "x" : undefined} onClick={() => setEditing(t.name)}>Edit</button>';
  assert.ok(!disabledOf(sample).includes("editLocks(editing, t.name).edit"));
});

test("opening the editor remembers the control that opened it, and closing returns focus there", () => {
  assert.match(buttonOf("setEditing(t.name)"), /returnFocus\.current = e\.currentTarget/);
  const closeAt = src.indexOf("onClose={");
  assert.ok(closeAt >= 0, "found the editor's onClose");
  assert.match(src.slice(closeAt, src.indexOf("/>", closeAt)), /returnFocus\.current\?\.focus\(\)/);
});
