// A checked radio used to count as filled even when it was the other option,
// and a combobox with nothing readable counted as the answer we hoped for.
// The green banner then said the form was pre-filled.
//
// Run from web/: node --test tests/lib/apply-readback.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readbackIssues, showPrefilledBanner, withoutReadbackIssues } from "../../src/lib/apply/prefilled-banner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "../fixtures/apply-readback.html"), "utf8");

const fields = [
  { id: "name", type: "text", label: "First name", required: true },
  { id: "visa", type: "radio", label: "Will you now or in the future require visa sponsorship?", required: true, options: ["Yes", "No"] },
  { id: "agree", type: "checkbox", label: "I agree to the privacy notice", required: false },
  { id: "office", type: "select", label: "Office", required: true, combobox: true },
];

function codes(issues) {
  return issues.map((issue) => issue.code);
}

test("a later drive drops an earlier read-back issue", () => {
  assert.deepEqual(withoutReadbackIssues([
    { code: "fill-mismatch", message: "A field did not match" },
    { code: "fill-unverified", message: "Couldn't read the form back, so it is not counted as pre-filled." },
    { code: "ai-filled", message: "AI filled the form" },
  ]), [{ code: "ai-filled", message: "AI filled the form" }]);
});

test("the green banner stays off unless read-back passed", () => {
  assert.equal(showPrefilledBanner("done", []), true);
  assert.equal(showPrefilledBanner("ready", []), false);
  assert.equal(showPrefilledBanner("done", [{ code: "fill-mismatch" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "required-empty" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "fill-unverified" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "captcha-present" }]), true);
  assert.deepEqual(
    readbackIssues([{ code: "fill-mismatch" }, { code: "captcha-present" }, { code: "fill-unverified" }]).map((issue) => issue.code),
    ["fill-mismatch", "fill-unverified"],
  );
});

test("a combobox display matches the answer the fill step would click", async () => {
  const { comboboxDisplayMatches, verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  assert.equal(comboboxDisplayMatches("Springfield, IL", "Springfield"), true);
  assert.equal(comboboxDisplayMatches("Springfield, IL", "Springfield, IL"), true);
  assert.equal(comboboxDisplayMatches("Springfield, IL", "Chicago"), false);
  assert.equal(comboboxDisplayMatches("Female", "Male"), false);
  assert.equal(comboboxDisplayMatches("Australia", "US"), false);

  const frame = {
    evaluate() {
      return Promise.resolve({
        mismatches: [],
        requiredEmpty: [],
        unverified: [],
        valErrors: [],
        comboboxes: [
          { label: "Office", intended: "Springfield", actual: "Springfield, IL", required: true },
        ],
      });
    },
  };
  const matched = await verifyFill(frame, [
    { id: "office", type: "select", label: "Office", required: true, combobox: true },
  ], { office: "Springfield" });
  assert.deepEqual(codes(matched), []);

  frame.evaluate = () => Promise.resolve({
    mismatches: [],
    requiredEmpty: [],
    unverified: [],
    valErrors: [],
    comboboxes: [
      { label: "Office", intended: "Springfield", actual: "Chicago, IL", required: true },
      { label: "Site", intended: "", actual: "", required: true },
    ],
  });
  const missed = await verifyFill(frame, [
    { id: "office", type: "select", label: "Office", required: true, combobox: true },
    { id: "site", type: "select", label: "Site", required: true, combobox: true },
  ], { office: "Springfield" });
  assert.ok(codes(missed).includes("fill-mismatch"), JSON.stringify(missed));
  assert.match(missed.find((issue) => issue.code === "fill-mismatch").message, /Office/);
  assert.ok(codes(missed).includes("required-empty"), JSON.stringify(missed));
  assert.match(missed.find((issue) => issue.code === "required-empty").message, /Site/);
});

test("a required select with a blank value is empty whatever its label says", async () => {
  const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  const option = { value: "", textContent: "Please select" };
  const select = {
    tagName: "SELECT",
    value: "",
    selectedOptions: [option],
  };
  const frame = {
    evaluate(fn, arg) {
      const previous = globalThis.document;
      globalThis.document = {
        querySelector(selector) {
          return selector.includes('data-co-field="region"') ? select : null;
        },
        querySelectorAll() {
          return [];
        },
      };
      return Promise.resolve(fn(arg)).finally(() => {
        globalThis.document = previous;
      });
    },
  };
  const fields = [{ id: "region", type: "select", label: "Region", required: true }];
  const blank = await verifyFill(frame, fields, {});
  assert.ok(codes(blank).includes("required-empty"), JSON.stringify(blank));
  assert.match(blank.find((issue) => issue.code === "required-empty").message, /Region/);

  select.value = "--";
  option.value = "--";
  option.textContent = "Please select";
  const dashes = await verifyFill(frame, fields, {});
  assert.ok(codes(dashes).includes("required-empty"), JSON.stringify(dashes));

  select.value = "Please select";
  option.value = "Please select";
  option.textContent = "Pick one";
  const words = await verifyFill(frame, fields, {});
  assert.ok(codes(words).includes("required-empty"), JSON.stringify(words));

  select.value = "mw";
  option.value = "mw";
  option.textContent = "Midwest";
  const chosen = await verifyFill(frame, fields, {});
  assert.equal(codes(chosen).includes("required-empty"), false, JSON.stringify(chosen));
});

test("a failed read-back names the fields it could not see", async () => {
  const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  const frame = { evaluate() { return Promise.reject(new Error("read-back failed")); } };
  const issues = await verifyFill(frame, [
    { id: "name", type: "text", label: "First name", required: true },
  ], { name: "Fixture" });
  assert.deepEqual(codes(issues), ["fill-unverified"]);
  assert.match(issues[0].message, /First name/);
  assert.equal(showPrefilledBanner("done", issues), false);
});

test("a failed read-back with no fields is still unverified", async () => {
  const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  const frame = { evaluate() { return Promise.reject(new Error("read-back failed")); } };
  const issues = await verifyFill(frame, [], {});
  assert.deepEqual(codes(issues), ["fill-unverified"]);
  assert.match(issues[0].message, /not counted as pre-filled/);
  assert.equal(showPrefilledBanner("done", issues), false);
});

test("a wrong radio and an unread combobox are not a successful read-back", { skip: !process.env.APPLY_UPLOAD_BROWSER_TEST }, async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { chromium } = await import("playwright-core");
  const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/apply-readback.html`);

  const wrong = await verifyFill(page.mainFrame(), fields, {
    name: "Fixture",
    visa: "No",
    agree: "yes",
    office: "Springfield, IL",
  });
  assert.ok(codes(wrong).includes("fill-mismatch"), JSON.stringify(wrong));
  assert.match(wrong.find((issue) => issue.code === "fill-mismatch").message, /visa sponsorship/);
  assert.ok(codes(wrong).includes("fill-unverified"), JSON.stringify(wrong));
  assert.equal(showPrefilledBanner("done", wrong), false);

  await page.locator("#wrong").evaluate((form) => { form.remove(); });
  documentUnhide(page);
  await page.locator("#right").evaluate((form) => { form.hidden = false; });
  const right = await verifyFill(page.mainFrame(), fields.filter((field) => field.id !== "agree"), {
    name: "Fixture",
    visa: "No",
    office: "Springfield, IL",
  });
  assert.deepEqual(codes(right).filter((code) => code !== "validation"), []);
  assert.equal(showPrefilledBanner("done", right.filter((issue) => issue.code !== "validation")), true);

  await page.locator("#right").evaluate((form) => { form.remove(); });
  await page.locator("#word").evaluate((form) => { form.hidden = false; });
  const wordFields = [
    ...fields.filter((field) => field.id !== "agree"),
    { id: "pref", type: "select", label: "Preferred site", required: false, combobox: true },
  ];
  const word = await verifyFill(page.mainFrame(), wordFields, {
    name: "Fixture",
    visa: "No",
    office: "Springfield",
  });
  assert.deepEqual(codes(word).filter((code) => code !== "validation"), [], JSON.stringify(word));

  await page.locator("#word .select__single-value").evaluate((el) => { el.textContent = "Chicago, IL"; });
  const otherCity = await verifyFill(page.mainFrame(), wordFields, {
    name: "Fixture",
    visa: "No",
    office: "Springfield",
  });
  assert.ok(codes(otherCity).includes("fill-mismatch"), JSON.stringify(otherCity));
  assert.match(otherCity.find((issue) => issue.code === "fill-mismatch").message, /Office/);
  assert.equal(otherCity.find((issue) => issue.code === "fill-unverified")?.message.includes("Preferred site") ?? false, false);

  await page.locator("#word").evaluate((form) => { form.remove(); });
  await page.locator("#gaps").evaluate((form) => { form.hidden = false; });
  const gaps = await verifyFill(page.mainFrame(), [
    { id: "nickname", type: "text", label: "Nickname", required: false },
    { id: "cv", type: "file", label: "Resume", required: false },
    { id: "terms", type: "checkbox", label: "Terms", required: true },
    { id: "site", type: "select", label: "Site", required: true },
    { id: "region", type: "select", label: "Region", required: true },
  ], {
    nickname: "Fixture",
    cv: "ignored.pdf",
    terms: "false",
    site: "",
  });
  assert.ok(codes(gaps).includes("fill-unverified"), JSON.stringify(gaps));
  assert.match(gaps.find((issue) => issue.code === "fill-unverified").message, /Nickname/);
  assert.equal(gaps.find((issue) => issue.code === "fill-unverified").message.includes("Resume"), false);
  assert.ok(codes(gaps).includes("required-empty"), JSON.stringify(gaps));
  assert.match(gaps.find((issue) => issue.code === "required-empty").message, /Terms/);
  assert.match(gaps.find((issue) => issue.code === "required-empty").message, /Site/);
  assert.match(gaps.find((issue) => issue.code === "required-empty").message, /Region/);
  assert.equal(showPrefilledBanner("done", gaps), false);
});

async function documentUnhide(page) {
  await page.locator("#right").evaluate((form) => { form.hidden = false; });
}
