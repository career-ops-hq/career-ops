// Optional browser regression: run a local web server against disposable data,
// then APPLY_FIELDS_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
// Every apply API is intercepted: no employer page, AI worker, or submission.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.APPLY_FIELDS_TEST_URL;

test("application review labels, requirements and confirmation descriptions", { skip: liveServerSkip("APPLY_FIELDS_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const fields = [
    { id: "text", type: "text", label: "Contact", required: true },
    { id: "email", type: "email", label: "Contact", required: false },
    ...["tel", "url", "number", "date", "textarea"].map((type) => ({ id: type, type, label: `Fixture ${type}`, required: true })),
    ...["select", "radio"].map((type) => ({ id: type, type, label: `Fixture ${type}`, required: true, options: ["Yes", "No"] })),
    { id: "checkbox", type: "checkbox", label: "Fixture checkbox", required: true },
    { id: "unnamed", type: "text", label: "", required: false },
    { id: "file", type: "file", label: "Portfolio attachment", required: true },
  ];
  const unexpected = [];
  await page.route("**/api/apply/**", async (route) => {
    unexpected.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/apply/session", (route) => route.fulfill({ json: { id: "fixture-session", title: "Fictional application", fields } }));
  let release;
  const drafting = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/apply/prefill", async (route) => {
    await drafting;
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ t: "done", count: fields.length, answers: Object.fromEntries(fields.map((f) => [f.id, { value: f.type === "checkbox" ? "true" : f.type === "select" || f.type === "radio" ? "Yes" : "", needs_confirmation: f.id === "text" || f.id === "checkbox" }])) }) + "\n" });
  });
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" })));
  await page.goto(`${origin.origin}/apply`);
  await page.getByPlaceholder("Paste an application form URL (Ashby, Lever, Greenhouse…)").fill("https://example.com/fictional-application");
  await page.getByRole("button", { name: "Read form", exact: true }).click();
  await page.getByRole("button", { name: "Pre-fill from my CV", exact: true }).waitFor();

  async function inspectFields() {
    const inputs = page.locator("input[id], textarea[id], select[id]");
    const properties = await inputs.evaluateAll((controls) => controls.map((c) => ({ id: c.id, name: Array.from(c.labels ?? []).map((l) => l.textContent.trim()).join(" "), required: c.getAttribute("aria-required"), nativeRequired: c.required, description: c.getAttribute("aria-describedby") ? document.getElementById(c.getAttribute("aria-describedby"))?.textContent : null })));
    assert.equal(properties.length, fields.length - 1); // file is a handoff notice
    assert.equal(new Set(properties.map((p) => p.id)).size, properties.length);
    for (const [i, p] of properties.entries()) {
      assert.equal(p.name, fields[i].label || "Untitled field");
      assert.equal(p.required, fields[i].required ? "true" : null);
      assert.equal(p.nativeRequired, false); // draft editing must remain unrestricted
    }
    return properties;
  }
  const before = await inspectFields();
  assert.equal(await page.getByRole("textbox", { name: "Contact", exact: true }).count(), 2);
  assert.equal(await page.getByRole("combobox", { name: "Fixture radio", exact: true }).count(), 1);
  for (const label of await page.locator("label[for]").all()) {
    const target = await label.getAttribute("for");
    await label.click();
    assert.equal(await page.evaluate(() => document.activeElement.id), target);
  }
  await page.getByRole("checkbox", { name: "Fixture checkbox", exact: true }).check();
  await page.getByRole("button", { name: "Pre-fill from my CV", exact: true }).click();
  await page.locator(".co-skel").first().waitFor();
  release();
  await page.getByRole("button", { name: "Pre-fill from my CV", exact: true }).waitFor();
  const after = await inspectFields();
  assert.deepEqual(after.map((p) => p.id), before.map((p) => p.id));
  assert.equal(after[0].description, "you confirm");
  assert.equal(after.find((p) => p.name === "Fixture checkbox").description, "you confirm");
  assert.equal(after[1].description, null);
  assert.equal(unexpected.length, 0);
});
