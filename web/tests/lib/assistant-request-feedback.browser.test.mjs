// Optional real-browser regression. Start the web server with disposable data,
// then set ASSISTANT_FEEDBACK_TEST_URL to its loopback URL. All mutations and
// assistant/worker streams are fictional; no CLI or application is submitted.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ASSISTANT_FEEDBACK_TEST_URL;
test("request feedback is transition-only, quiet when closed and user-navigated", { skip: liveServerSkip("ASSISTANT_FEEDBACK_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const replies = new Map();
  let worker;
  const fixture = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const data = JSON.parse(text);
    res.setHeader("Access-Control-Allow-Origin", origin.origin);
    if (data.message === "failure") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Fixture unavailable" }));
    } else {
      res.writeHead(200, { "Content-Type": req.url === "/run" ? "application/x-ndjson" : "text/plain" });
      res.flushHeaders();
      if (req.url === "/run") worker = res;
      else replies.set(data.message, res);
    }
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  t.after(() => { replies.forEach((r) => r.end()); worker?.end(); fixture.closeAllConnections(); fixture.close(); });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  let saved;
  let revision = 0;
  const unexpected = [];
  const writes = [];
  await page.addInitScript(() => { localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" })); localStorage.setItem("career-ops:first-score-seen", "1"); });
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/assistant/chats**", (route) => {
    const request = route.request();
    if (request.method() === "PUT" && request.postDataJSON().messages.some((m) => m.role === "user" && m.parts.some((p) => p.type === "text" && p.text === "save failure"))) return route.fulfill({ status: 503, json: { error: "Fixture save failed" } });
    if (request.method() === "PUT") { saved = { ...request.postDataJSON(), revision: ++revision, title: "Fictional feedback history" }; return route.fulfill({ json: saved }); }
    return route.fulfill({ json: new URL(request.url()).searchParams.has("id") ? saved : { chats: saved ? [{ id: saved.id, title: saved.title, revision }] : [], errors: [] } });
  });
  await page.route("**/api/status", (route) => { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, status: route.request().postDataJSON().status } }); });
  await page.route("**/api/clis", (route) => route.fulfill({ json: { clis: [{ id: "fixture-cli", installed: true }] } }));
  await page.route("**/api/runs/save", (route) => route.fulfill({ json: { ok: true } }));
  for (const path of ["assistant", "run"]) await page.route(`**/api/${path}`, (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/${path}` }));
  const input = page.getByRole("textbox", { name: "Message to assistant", exact: true });
  const status = page.getByRole("status", { name: "Assistant request status", exact: true });
  const latest = page.getByRole("group", { name: "Latest assistant reply", exact: true });
  const open = page.getByRole("button", { name: "Ask the assistant", exact: true });
  async function until(check) {
    for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
    assert.fail("expected UI state not reached");
  }
  async function focused(locator) { return locator.evaluate((el) => el === document.activeElement); }
  async function tabTo(target) {
    for (let i = 0; i < 100; i++) { if (await focused(target)) return; await page.keyboard.press("Tab"); }
    assert.fail("target not reachable by keyboard");
  }
  async function send(text) {
    await tabTo(input);
    await page.keyboard.type(text);
    await until(() => page.getByRole("button", { name: "Send", exact: true }).isEnabled());
    await page.keyboard.press("Enter");
    if (text !== "failure") {
      await until(async () => (await status.innerText()).startsWith("Processing your request."));
      await until(() => replies.has(text));
    }
  }
  async function hasLiveReply() {
    return latest.evaluate((el) => Boolean(
      el.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') ||
      el.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')
    ));
  }
  async function notices() { return page.evaluate(() => window.__assistantNotices); }
  async function watchStatus() {
    await status.evaluate((el) => {
      window.__assistantNotices = [];
      new MutationObserver(() => { const text = el.textContent.trim(); if (text) window.__assistantNotices.push(text); }).observe(el, { childList: true, subtree: true, characterData: true });
    });
  }
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await open.waitFor(); await tabTo(open); await page.keyboard.press("Enter");
  await input.waitFor();
  assert.equal(await status.count(), 1);
  assert.equal(await status.innerText(), "");
  await watchStatus();
  await send("normal");
  const processingTree = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(processingTree.nodes.some((n) => !n.ignored && n.role?.value === "status" && n.name?.value === "Assistant request status" && n.properties?.some((p) => p.name === "live" && p.value.value === "polite")));
  replies.get("normal").write("First chunk.");
  await page.getByText("First chunk.", { exact: true }).waitFor();
  replies.get("normal").write(" More text.\n\n" + "A long fictional paragraph for deliberate reading.\n\n".repeat(30));
  await page.getByText("First chunk. More text.", { exact: true }).waitFor();
  assert.deepEqual(await notices(), ["Processing your request."]);
  assert.equal(await focused(input), true);
  assert.equal(await hasLiveReply(), false);
  replies.get("normal").end();
  await until(async () => (await status.innerText()) === "Reply ready.");
  assert.deepEqual(await notices(), ["Processing your request.", "Reply ready."]);
  await latest.evaluate(async (el) => {
    const viewport = el.parentElement;
    let previous = -1;
    let stable = 0;
    while (stable < 5) {
      await new Promise(requestAnimationFrame);
      stable = viewport.scrollTop === previous ? stable + 1 : 0;
      previous = viewport.scrollTop;
    }
  });
  await page.keyboard.press("Tab");
  assert.equal(await focused(page.getByRole("button", { name: "Read latest reply", exact: true })), true);
  await page.keyboard.press("Enter");
  assert.equal(await focused(latest), true);
  await until(() => latest.evaluate((el) => {
    const viewport = el.parentElement.getBoundingClientRect();
    const reply = el.getBoundingClientRect();
    return reply.top >= viewport.top - 2 && reply.top < viewport.top + 40;
  })); // Wait for smooth scrolling to settle at the deliberate reading position.

  // Prove the guard catches live semantics on the reply, its ancestors and
  // a log descendant, then restore the DOM before testing actual behavior.
  await latest.evaluate((el) => el.setAttribute("aria-live", "polite"));
  assert.equal(await hasLiveReply(), true);
  await latest.evaluate((el) => { el.removeAttribute("aria-live"); el.parentElement.setAttribute("aria-live", "polite"); });
  assert.equal(await hasLiveReply(), true);
  await latest.evaluate((el) => { el.parentElement.removeAttribute("aria-live"); const log = document.createElement("div"); log.setAttribute("role", "log"); log.dataset.testLiveGuard = ""; el.append(log); });
  assert.equal(await hasLiveReply(), true);
  await latest.evaluate((el) => el.querySelector("[data-test-live-guard]").remove());
  assert.equal(await hasLiveReply(), false);

  await send("cards");
  replies.get("cards").write('Review the proposals.\n<<act:setStatus {"n":"11","status":"Interview"}>>\n<<act:setStatus {"n":"12","status":"Rejected"}>>');
  await page.getByRole("button", { name: "Confirm: Mark #11 → Interview?", exact: true }).waitFor();
  assert.equal(await focused(input), true);
  assert.equal(await page.getByRole("button", { name: "Review pending actions", exact: true }).count(), 1);
  assert.equal((await notices()).filter((n) => n === "Processing your request.").length, 2, "new tokens/cards do not repeat processing");
  replies.get("cards").end();
  await until(async () => (await status.innerText()) === "Reply ready. 2 actions need confirmation.");
  await tabTo(page.getByRole("button", { name: "Review pending actions", exact: true }));
  await page.keyboard.press("Enter");
  assert.equal(await focused(page.getByRole("group", { name: "Mark #11 → Interview?", exact: true })), true);
  assert.deepEqual(writes, [], "navigation must not confirm anything");
  const countBeforeDecision = (await notices()).length;
  await tabTo(page.getByRole("button", { name: "Cancel: Mark #11 → Interview?", exact: true }));
  await page.keyboard.press("Enter");
  await until(async () => (await page.locator('[id]').filter({ hasText: /^Reply ready\. 1 action needs confirmation\.$/ }).count()) > 0);
  assert.equal((await notices()).length, countBeforeDecision, "card result focus does not also generate a request announcement");
  assert.deepEqual(writes, []);

  // An unresolved proposal belongs to the conversation, not just its latest
  // reply. A new request must preserve access without approving anything.
  await send("follow-up");
  await until(async () => (await status.innerText()) === "Processing your request. 1 action needs confirmation.");
  replies.get("follow-up").end("A separate reply.");
  await until(async () => (await status.innerText()) === "Reply ready. 1 action needs confirmation.");
  await tabTo(page.getByRole("button", { name: "Review pending actions", exact: true }));
  await page.keyboard.press("Enter");
  const earlierCard = page.getByRole("group", { name: "Mark #12 → Rejected?", exact: true });
  assert.equal(await focused(earlierCard), true);
  const pendingTree = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(pendingTree.nodes.some((n) => !n.ignored && n.role?.value === "group" && n.name?.value === "Mark #12 → Rejected?" && n.properties?.some((p) => p.name === "focused" && p.value.value === true)));
  assert.deepEqual(writes, [], "revisiting an earlier proposal must not approve it");
  const beforeEarlierCancel = (await notices()).length;
  await tabTo(page.getByRole("button", { name: "Cancel: Mark #12 → Rejected?", exact: true }));
  await page.keyboard.press("Enter");
  await until(async () => (await page.getByRole("button", { name: "Review pending actions", exact: true }).count()) === 0);
  assert.equal((await notices()).length, beforeEarlierCancel);
  assert.deepEqual(writes, []);

  await send("failure");
  await page.getByText("⚠️ Fixture unavailable", { exact: true }).waitFor();
  await until(async () => (await status.innerText()) === "Request failed. Review the error.");
  await tabTo(page.getByRole("button", { name: "Review error", exact: true }));
  await page.keyboard.press("Enter");
  assert.equal(await focused(latest), true);
  await send("empty"); replies.get("empty").end();
  await until(async () => (await status.innerText()) === "Request failed. Review the error.");
  assert.equal((await notices()).filter((n) => n === "Request failed. Review the error.").length, 2, "an empty response is not reported ready");

  for (const [message, response] of [
    ["partial-action", "<<act:setStatus "],
    ["partial-opener", "<<act:set"],
    ["malformed-action", "<<act:setStatus {broken}>>"],
  ]) {
    await send(message);
    const beforeFinish = (await notices()).length;
    replies.get(message).end(response);
    await until(async () => (await status.innerText()) === "Request failed. Review the error.");
    assert.deepEqual((await notices()).slice(beforeFinish), ["Request failed. Review the error."]);
    await tabTo(page.getByRole("button", { name: "Review error", exact: true }));
    await page.keyboard.press("Enter");
    assert.equal(await focused(latest), true);
    assert.match(await latest.innerText(), /no output/);
  }
  await send("visible-partial");
  replies.get("visible-partial").end("Useful visible reply. <<act:setStatus ");
  await until(async () => (await status.innerText()) === "Reply ready.");
  assert.equal((await latest.innerText()).trim(), "Useful visible reply.");
  await send("action-only");
  replies.get("action-only").end('<<act:setStatus {"n":"13","status":"Interview"}>>');
  await until(async () => (await status.innerText()) === "Reply ready. 1 action needs confirmation.");
  assert.deepEqual(writes, [], "valid action-only output still requires human confirmation");
  await tabTo(page.getByRole("button", { name: "Review pending actions", exact: true }));
  await page.keyboard.press("Enter");
  assert.equal(await focused(page.getByRole("group", { name: "Mark #13 → Interview?", exact: true })), true);
  await tabTo(page.getByRole("button", { name: "Cancel: Mark #13 → Interview?", exact: true }));
  await page.keyboard.press("Enter");
  await until(async () => (await page.getByRole("button", { name: "Review pending actions", exact: true }).count()) === 0);
  assert.deepEqual(writes, []);

  await send("closed");
  await page.keyboard.press("Escape");
  await until(() => focused(open));
  const beforeClosedFinish = (await notices()).length;
  replies.get("closed").end("Reply finished while closed.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await status.innerText(), "");
  assert.equal((await notices()).length, beforeClosedFinish);
  await page.keyboard.press("Enter");
  await input.waitFor();
  await page.getByText("Reply finished while closed.", { exact: true }).waitFor();
  assert.equal(await status.innerText(), "");
  assert.equal((await notices()).length, beforeClosedFinish);
  assert.equal(await page.getByRole("button", { name: "Read latest reply", exact: true }).count(), 1);

  await send("worker");
  replies.get("worker").end('Worker launched.\n<<act:evaluate {"url":"https://example.com/fictional-job","title":"Fixture worker"}>>');
  await until(() => worker);
  await until(async () => (await status.innerText()) === "Reply ready.");
  const beforeWorkerFinish = (await notices()).length;
  worker.end(JSON.stringify({ type: "done", tokens: 10 }) + "\n");
  await page.getByText("10 tokens", { exact: true }).filter({ visible: true }).first().waitFor();
  assert.equal((await notices()).length, beforeWorkerFinish, "worker completion belongs to #5083");
  await until(() => saved?.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text.trim() === "Worker launched.")));
  await page.reload(); await open.waitFor(); await tabTo(open); await page.keyboard.press("Enter");
  await input.waitFor(); await page.getByText("Worker launched.", { exact: true }).waitFor();
  assert.equal(await status.innerText(), "", "restored replies never replay notifications");
  assert.equal(await page.getByRole("button", { name: "Read latest reply", exact: true }).count(), 1);
  // A failed history save prevents dispatch; its existing alert owns the error.
  await tabTo(input);
  await page.keyboard.type("save failure");
  await until(() => page.getByRole("button", { name: "Send", exact: true }).isEnabled());
  await page.keyboard.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  await page.getByText("⚠️ Request not sent: Fixture save failed", { exact: true }).waitFor();
  assert.equal(replies.has("save failure"), false);
  await until(async () => (await status.innerText()) === "");
  assert.deepEqual(unexpected, []);
});
