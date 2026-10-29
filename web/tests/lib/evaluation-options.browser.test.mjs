// Disposable fictional inbox; AI calls are intercepted and never reach a CLI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";
import { FULL_EVALUATION } from "../../src/lib/evaluation-options.mjs";

const url = process.env.EVALUATION_OPTIONS_TEST_URL;
test("evaluation choices survive navigation and reach pasted-URL and shortlist workers", {
  skip: liveServerSkip("EVALUATION_OPTIONS_TEST_URL"), timeout: 60_000,
}, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" }));
    localStorage.setItem("career-ops:first-score-seen", "1");
  });
  // Refuse all unhandled writes, including accidental real AI calls.
  await page.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.route("**/api/clis", (route) => route.fulfill({ json: { clis: [{ id: "fixture-cli", installed: true }] } }));
  await page.route("**/api/run", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 422, json: { error: "Fixture: no AI run" } });
  });
  async function scoreQuick(input) {
    const request = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/run");
    await page.getByPlaceholder("Paste a job URL to evaluate…").fill(input);
    await page.getByRole("button", { name: "Evaluate", exact: true }).click();
    await request;
  }
  await page.goto(url);
  await page.getByText("Evaluation options · full evaluation", { exact: true }).click();
  const options = page.getByRole("group", { name: "Evaluation sections" });
  assert.equal(await options.getByRole("checkbox").count(), FULL_EVALUATION.length);
  assert.equal(await options.getByRole("checkbox", { checked: true }).count(), FULL_EVALUATION.length);
  await scoreQuick("https://example.com/fixture-full");
  assert.deepEqual(requests.at(-1).evaluationSections, [...FULL_EVALUATION]);
  await options.getByRole("button", { name: "Essentials", exact: true }).click();
  await options.getByRole("checkbox", { name: /Job summary/ }).uncheck();
  await scoreQuick("https://example.com/fixture-fit-only");
  assert.deepEqual(requests.at(-1).evaluationSections, []);
  await options.getByRole("checkbox", { name: /Interview preparation/ }).check();
  await page.reload();
  await page.getByText("Evaluation options · 1 optional sections", { exact: true }).click();
  assert.equal(await options.getByRole("checkbox", { name: /Interview preparation/ }).isChecked(), true);
  assert.equal(await options.getByRole("checkbox", { checked: true }).count(), 1);

  await page.goto(`${url}/pipeline`);
  await page.locator("li:visible").filter({ hasText: "Fixture Alpha" }).getByRole("button", { name: /Save/ }).click();
  await page.getByRole("button", { name: /^Score 1 ·/ }).click();
  assert.equal(await options.getByRole("checkbox", { name: /Interview preparation/ }).isChecked(), true);
  await options.getByRole("button", { name: "Essentials", exact: true }).click();
  const request = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/run");
  await page.getByRole("button", { name: "Score 1 now", exact: true }).click();
  await request;
  assert.equal(requests.at(-1).input, "https://example.com/fixture-alpha");
  assert.deepEqual(requests.at(-1).evaluationSections, ["summary"]);
  assert.equal(requests.length, 3);
  assert.deepEqual(errors, []);
});

test("invalid evaluation selections are rejected before CLI discovery", {
  skip: liveServerSkip("EVALUATION_OPTIONS_TEST_URL"),
}, async () => {
  const response = await fetch(`${url}/api/run`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "evaluate", input: "https://example.com/fixture", cliId: "nonexistent", evaluationSections: ["invented"] }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid evaluation sections/);
});
