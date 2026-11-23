import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.WORKER_NAVIGATION_TEST_URL;
const skip = liveServerSkip("WORKER_NAVIGATION_TEST_URL");

async function setup(t) {
  const origin = new URL(url).origin;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const workers = new Map();
  const fixture = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { input } = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": origin });
    res.flushHeaders();
    const worker = { res, dropped: false };
    res.on("close", () => { if (!res.writableEnded) worker.dropped = true; });
    workers.set(input, worker);
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  t.after(() => fixture.close());

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saves = [];
  await page.addInitScript(() => {
    localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" }));
    localStorage.setItem("career-ops:first-score-seen", "1");
  });
  await page.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.route("**/api/clis", (route) => route.fulfill({ json: { clis: [{ id: "fixture-cli", installed: true }] } }));
  await page.route("**/api/runs/save", (route) => {
    saves.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/run", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/run` }));

  async function until(check, message) {
    for (let i = 0; i < 400; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(message);
  }
  const send = (input, event, end = false) => {
    const { res } = workers.get(input);
    res[end ? "end" : "write"](JSON.stringify(event) + "\n");
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:jobs") || "[]"));
  const markDocument = () => page.evaluate(() => { window.__workerNavigationDocument = true; });
  const sameDocument = () => page.evaluate(() => window.__workerNavigationDocument === true);

  async function startFromPipeline(company, input) {
    await page.goto(`${url}/pipeline`);
    await page.locator("li:visible").filter({ hasText: company }).getByRole("button", { name: /Save/ }).click();
    await page.getByRole("button", { name: /^Score 1 ·/ }).click();
    await page.getByRole("button", { name: "Score 1 now", exact: true }).click();
    await until(() => workers.has(input), `the ${company} worker never reached /api/run`);
    send(input, { type: "status", label: "Fictional worker started" });
    const pill = page.getByRole("complementary").getByRole("link", { name: /^Open worker: .*Running$/ });
    await pill.waitFor();
    return pill;
  }

  return { page, workers, saves, errors, until, send, stored, markDocument, sameDocument, startFromPipeline };
}

test("opening a running worker from its pill keeps the evaluation streaming to completion", {
  skip, timeout: 120_000,
}, async (t) => {
  const { page, workers, saves, errors, until, send, stored, markDocument, sameDocument, startFromPipeline } = await setup(t);
  const input = "https://example.com/fixture-alpha";
  const pill = await startFromPipeline("Fixture Alpha", input);
  const href = await pill.getAttribute("href");
  assert.match(href, /^\/jobs\/job-/);

  await markDocument();
  await pill.click();
  await page.waitForURL((u) => u.pathname === href);
  assert.equal(await sameDocument(), true, "the pill must navigate client-side, not reload the document");
  await page.getByText("working", { exact: true }).waitFor();
  assert.equal(workers.get(input).dropped, false, "the pill click closed the worker's stream");

  send(input, { type: "tool", name: "WebFetch" });
  await page.getByText("Using WebFetch", { exact: true }).waitFor();

  await page.getByRole("complementary").getByRole("link", { name: "Pipeline", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/pipeline");
  await page.getByRole("complementary").getByRole("link", { name: /^Open worker: .*Running$/ }).click();
  await page.waitForURL((u) => u.pathname === href);
  assert.equal(await sameDocument(), true);
  assert.equal(workers.get(input).dropped, false);

  send(input, { type: "text", text: "VERDICT: 4/5 — Fictional match\n" });
  send(input, { type: "done", tokens: 100 }, true);
  await page.getByText("done", { exact: true }).waitFor();
  await page.getByText("4/5", { exact: true }).waitFor();
  await until(async () => (await stored())[0]?.status === "done", "the finished job was never stored as done");
  const [job] = await stored();
  assert.equal(job.steps.some((s) => /Interrupted/.test(s.label)), false);
  assert.equal(job.steps.at(-1).label, "Done");
  await until(() => saves.length === 1, "the finished run was not saved");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].status, "done");
  assert.equal(workers.get(input).dropped, false);
  assert.deepEqual(errors, []);
});

test("a real reload still ends the run and the restored job reads as interrupted", {
  skip, timeout: 120_000,
}, async (t) => {
  const { page, workers, saves, until, stored, startFromPipeline } = await setup(t);
  const input = "https://example.com/fixture-beta";
  await startFromPipeline("Fixture Beta", input);
  await until(async () => (await stored())[0]?.status === "running", "the running job was never stored");

  await page.reload();
  await until(() => workers.get(input).dropped, "a reload must close the stream, which stops the worker");
  await until(async () => (await stored())[0]?.status === "error", "the restored job was not marked as failed");
  const [job] = await stored();
  assert.equal(job.steps.at(-1).label, "Interrupted (page reloaded)");
  assert.equal(job.result, undefined);
  assert.equal(saves.length, 0, "an interrupted run must not be saved as finished");
  await page.getByRole("complementary").getByRole("link", { name: /^Open worker: .*Failed$/ }).waitFor();
});
