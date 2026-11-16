// A dashboard correction replaces a salary this session wrote. A value typed
// on the form, or a value already there before the session wrote anything,
// stays. The frame is a fake. This test does not open a browser.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-salary-correction.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

const { fillSession } = await import("../../src/lib/apply/session.ts");

const salary = { id: "salary", type: "text", label: "Desired salary", required: false };

function salaryFrame(start) {
  const values = new Map([["salary", start]]);
  const fills = [];
  const frame = {
    url: () => "https://jobs.example/apply",
    locator(selector) {
      return {
        count: async () => 0,
        first() {
          return {
            getAttribute: async (name) => (name === "type" ? "text" : null),
            inputValue: async () => values.get("salary") ?? "",
            fill: async (value) => {
              fills.push(value);
              values.set("salary", value);
            },
          };
        },
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
  return {
    frame,
    page,
    fills,
    value: () => values.get("salary") ?? "",
    type: (value) => values.set("salary", value),
  };
}

function open(session) {
  const id = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(id, { id, frame: session.frame, page: session.page });
  return {
    fill: (answers) => fillSession(id, answers, [salary]),
    close: () => globalThis.__coApplySessions.delete(id),
  };
}

test("a dashboard correction updates a salary this session wrote", async () => {
  const session = salaryFrame("");
  const live = open(session);
  try {
    const first = await live.fill({ salary: "180000" });
    assert.equal(session.value(), "180000");
    assert.deepEqual(session.fills, ["180000"]);
    assert.equal(first.steps.find((step) => step.fieldId === "salary")?.ok, true);

    const corrected = await live.fill({ salary: "190000" });
    assert.equal(session.value(), "190000");
    assert.deepEqual(session.fills, ["180000", "190000"]);
    assert.equal(corrected.steps.find((step) => step.fieldId === "salary")?.ok, true);
  } finally {
    live.close();
  }
});

test("a padded salary this session wrote can still be corrected", async () => {
  const session = salaryFrame("");
  const live = open(session);
  try {
    const first = await live.fill({ salary: " 180000 " });
    assert.equal(session.value(), "180000");
    assert.equal(first.steps.find((step) => step.fieldId === "salary")?.ok, true);

    const corrected = await live.fill({ salary: "190000" });
    assert.equal(session.value(), "190000");
    assert.deepEqual(session.fills, ["180000", "190000"]);
    assert.equal(corrected.steps.find((step) => step.fieldId === "salary")?.ok, true);
  } finally {
    live.close();
  }
});

test("a salary typed on the form stays, including one already on the form", async () => {
  const session = salaryFrame("");
  const live = open(session);
  try {
    await live.fill({ salary: "180000" });
    session.type("1");
    const kept = await live.fill({ salary: "190000" });
    assert.equal(session.value(), "1");
    assert.deepEqual(session.fills, ["180000"]);
    assert.equal(kept.steps.find((step) => step.fieldId === "salary")?.ok, true);
  } finally {
    live.close();
  }

  const prefilled = salaryFrame("50");
  const prior = open(prefilled);
  try {
    const left = await prior.fill({ salary: "180000" });
    assert.equal(prefilled.value(), "50");
    assert.deepEqual(prefilled.fills, []);
    assert.equal(left.steps.find((step) => step.fieldId === "salary")?.ok, true);
  } finally {
    prior.close();
  }
});
