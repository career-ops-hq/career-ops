// Optional real-browser regression against disposable loopback data only.
// All model calls, writes and run logs are intercepted; no provider is invoked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { liveServerSkip } from "../helpers/live-server.mjs";

const target = process.env.WORKER_GATE_TEST_URL;
const missing = "This evaluation didn't produce a report to save, so it isn't in your tracker — re-run it to verify. (The agent emitted no <<report-md>> envelope, so there is no report to save.)";
const legacyText = 'Stopped before Block A.\n\nneeds_confirmation: dealbreaker "location" - rerun with "evaluate anyway" to evaluate\n\nVERDICT: N/A/5 — The role requires residence outside the allowed location.';
const agencyText = 'Stopped before Block A.\n\n```yaml\nstatus: needs_confirmation\nreason: agency_confirmation\nquestion: "Confirm the intermediary before proceeding."\n```\n\nVERDICT: N/A/5 — Agency confirmation required.';
const gateMessage = "The role requires residence outside your allowed location.";
const machineText = 'Stopped before scoring.\n<<evaluation-gate>>\n' + JSON.stringify({ status: "needs_confirmation", reason: "dealbreaker", message: gateMessage }) + '\n<</evaluation-gate>>\nVERDICT: N/A/5 — Location rule.';
const fixture = (id, text, label = missing) => ({ id, title: id, kind: "evaluate", status: "error", input: `https://example.com/${id}`, steps: [{ kind: "status", label }], text, startedAt: 1, endedAt: 2 });

test("intentional evaluation stops and old missing-report history need review without concealing real errors", { skip: liveServerSkip("WORKER_GATE_TEST_URL"), timeout: 120_000 }, async () => {
  const origin = new URL(target);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const unexpectedWrites = [];
  const savedRuns = [];
  let chat;
  let revision = 0;
  try {
    await page.addInitScript(({ legacy, agency, failure }) => {
      if (!localStorage.getItem("career-ops:jobs")) localStorage.setItem("career-ops:jobs", JSON.stringify([legacy, agency, failure]));
      localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" }));
      localStorage.setItem("career-ops:first-score-seen", "1");
      window.__gateDoneEvents = 0;
      window.addEventListener("co-job-done", () => { window.__gateDoneEvents++; });
    }, { legacy: fixture("legacy-location", legacyText), agency: fixture("legacy-agency", agencyText), failure: fixture("real-connection-error", legacyText, "Connection error") });
    await page.route("**/api/**", route => {
      if (route.request().method() === "GET") return route.continue();
      unexpectedWrites.push(route.request().url());
      return route.abort();
    });
    await page.route("**/api/clis", route => route.fulfill({ json: { clis: [{ id: "fixture-cli", installed: true }] } }));
    await page.route("**/api/usage", route => route.fulfill({ json: {} }));
    await page.route("**/api/assistant/chats**", route => {
      const request = route.request();
      if (request.method() === "PUT") {
        chat = { ...request.postDataJSON(), revision: ++revision, title: "Fictional gate audit" };
        return route.fulfill({ json: chat });
      }
      return route.fulfill({ json: new URL(request.url()).searchParams.has("id") ? chat : { chats: chat ? [{ id: chat.id, revision, title: chat.title }] : [], errors: [] } });
    });
    await page.route("**/api/runs/save", route => {
      savedRuns.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/assistant", route => {
      const data = route.request().postDataJSON();
      const fatal = data.message.includes("fatal");
      return route.fulfill({ contentType: "text/plain", body: 'Starting a fictional worker.\n<<act:evaluate ' + JSON.stringify({ url: `https://example.com/${fatal ? "new-fatal" : "new-gate"}`, title: fatal ? "Fatal fixture" : "New gated fixture" }) + '>>' });
    });
    await page.route("**/api/run", route => {
      const fatal = route.request().postDataJSON().input.includes("new-fatal");
      const events = [{ type: "text", text: machineText }, ...(fatal ? [{ type: "error", msg: "Worker exited with error" }] : []), { type: "gated", reason: "dealbreaker", message: gateMessage, confirmationRequired: true, tokens: 42 }];
      return route.fulfill({ contentType: "application/x-ndjson", body: events.map(e => JSON.stringify(e)).join("\n") + "\n" });
    });
    async function until(check, label) {
      for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
      assert.fail(label);
    }
    const jobs = () => page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:jobs") || "[]"));
    async function screenshot(name) {
      if (!process.env.WORKER_GATE_ARTIFACT_DIR) return;
      await mkdir(process.env.WORKER_GATE_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.WORKER_GATE_ARTIFACT_DIR, name + ".png"), fullPage: true });
    }

    await page.goto(origin.origin + "/jobs/legacy-location");
    const review = page.getByRole("region", { name: "Evaluation needs review" });
    await review.waitFor();
    assert.match(await review.innerText(), /process exit could not be verified/);
    assert.match(await page.locator("h1").locator("..").innerText(), /needs review/i);
    assert.equal(await page.getByText(missing, { exact: true }).isVisible(), false);
    await page.getByText("Earlier run details", { exact: true }).click();
    assert.equal(await page.getByText(missing, { exact: true }).isVisible(), true);
    await page.getByText("Earlier run details", { exact: true }).click();
    await screenshot("legacy-stop");
    await page.reload(); await review.waitFor();
    assert.equal((await jobs()).find(j => j.id === "legacy-location").status, "error", "legacy process truth is not rewritten");

    await page.goto(origin.origin + "/jobs/legacy-agency");
    await review.waitFor();
    assert.match(await review.innerText(), /Confirm the intermediary/);
    await page.goto(origin.origin + "/jobs/real-connection-error");
    assert.equal(await review.count(), 0);
    assert.match(await page.locator("h1").locator("..").innerText(), /error/i);

    await page.goto(origin.origin + "/jobs/legacy-location");
    await review.waitFor();
    await review.getByRole("button", { name: "Open assistant to review", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message to assistant", exact: true });
    await input.waitFor();
    assert.equal(savedRuns.length, 0, "opening review does not run an evaluation");
    async function launch(message, wanted) {
      await input.fill(message);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const inputUrl = `https://example.com/${message.includes("fatal") ? "new-fatal" : "new-gate"}`;
      await until(async () => (await jobs()).some(j => j.input === inputUrl && j.status !== "running"), "fictional worker did not settle");
      return (await jobs()).find(j => j.input === inputUrl);
    }
    const current = await launch("gated fixture", "New gated fixture");
    assert.equal(current.status, "gated");
    assert.equal(current.result, undefined);
    assert.equal(current.reportN, null);
    assert.equal(await page.evaluate(() => window.__gateDoneEvents), 0);
    await until(() => savedRuns.length === 1, "stop log was not saved");
    assert.equal(savedRuns[0].status, "gated");
    assert.equal(savedRuns[0].result, undefined);
    await page.goto(origin.origin + "/jobs/" + current.id);
    await review.waitFor();
    assert.match(await review.innerText(), /No score or evaluation report was created/);
    const primaryOutput = page.locator(".report-prose");
    assert.doesNotMatch(await primaryOutput.innerText(), /<<evaluation-gate>>|"status":"needs_confirmation"/);
    assert.equal(await page.getByText("Raw worker output", { exact: true }).isVisible(), true);
    await screenshot("confirmed-stop");
    await review.getByRole("button", { name: "Open assistant to review", exact: true }).click();
    const failed = await launch("fatal fixture", "Fatal fixture");
    assert.equal(failed.status, "error");
    assert.equal(failed.gate, undefined);
    await page.goto(origin.origin + "/jobs/" + failed.id);
    assert.equal(await review.count(), 0);
    assert.match(await page.locator("h1").locator("..").innerText(), /error/i);
    await screenshot("fatal-error-retained");
    assert.deepEqual(unexpectedWrites, []);
  } finally { await browser.close(); }
});
