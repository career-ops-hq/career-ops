// fillSession chooses the control from the field type and the combobox flag.
// A Greenhouse yes/no is checked through data-co-option. An ordinary select
// uses selectOption. A field the page reader already marked as a combobox
// still opens the menu.
// The frame is a fake. This test does not open a browser or a Greenhouse form.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-greenhouse-yesno-fill.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

const { fillSession } = await import("../../src/lib/apply/session.ts");

const yesNo = { id: "sponsorship", type: "radio", label: "Will you require sponsorship?", required: true, options: ["Yes", "No"] };
const location = { id: "location", type: "select", label: "Location", required: true, options: ["Remote", "Springfield"] };
const department = { id: "department", type: "select", label: "Department", required: true, options: ["Engineering"], combobox: true };

function recordingSession() {
  const calls = [];
  const frame = {
    url: () => "about:blank",
    locator(selector) {
      const control = {
        scrollIntoViewIfNeeded: async () => { calls.push({ selector, method: "scrollIntoViewIfNeeded" }); },
        click: async () => { calls.push({ selector, method: "click" }); },
        pressSequentially: async (text) => { calls.push({ selector, method: "pressSequentially", text }); },
        selectOption: async (arg) => { calls.push({ selector, method: "selectOption", arg }); },
        check: async (arg) => { calls.push({ selector, method: "check", arg }); },
        getAttribute: async () => null,
        setChecked: async () => { calls.push({ selector, method: "setChecked" }); },
        isChecked: async () => false,
      };
      return {
        count: async () => 0,
        first: () => control,
        allInnerTexts: async () => (selector.includes("select__menu") ? ["Engineering"] : []),
        nth: (index) => ({ click: async () => { calls.push({ selector, method: "optionClick", index }); } }),
      };
    },
    evaluate: async () => ({ mismatches: [], requiredEmpty: [], valErrors: [] }),
  };
  const page = {
    screenshot: async () => Buffer.from("fixture"),
    frames: () => [frame],
    waitForTimeout: async () => {},
    keyboard: { insertText: async () => {}, press: async () => {} },
  };
  return { frame, page, calls };
}

test("a Greenhouse yes/no is checked as a radio and an ordinary select still uses selectOption", async () => {
  const { frame, page, calls } = recordingSession();
  const id = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(id, { id, frame, page });
  try {
    const result = await fillSession(id, {
      sponsorship: "Yes",
      location: "Remote",
      department: "Engineering",
    }, [yesNo, location, department]);

    const checked = calls.filter((call) => call.method === "check");
    assert.deepEqual(checked.map((call) => call.selector), ['[data-co-field="sponsorship"][data-co-option="Yes"]']);

    const selected = calls.filter((call) => call.method === "selectOption");
    assert.deepEqual(selected, [{ selector: '[data-co-field="location"]', method: "selectOption", arg: { label: "Remote" } }]);
    assert.equal(calls.some((call) => call.selector === '[data-co-field="location"]' && (call.method === "click" || call.method === "pressSequentially")), false);

    const menu = calls.filter((call) => call.selector === '[data-co-field="department"]');
    assert.equal(menu.some((call) => call.method === "click"), true);
    assert.equal(menu.some((call) => call.method === "pressSequentially" && call.text === "Engineering"), true);
    assert.equal(menu.some((call) => call.method === "selectOption"), false);
    assert.equal(calls.some((call) => call.method === "optionClick"), true);

    for (const fieldId of ["sponsorship", "location", "department"]) {
      assert.equal(result.steps.find((step) => step.fieldId === fieldId)?.ok, true);
    }
  } finally {
    globalThis.__coApplySessions.delete(id);
  }
});
