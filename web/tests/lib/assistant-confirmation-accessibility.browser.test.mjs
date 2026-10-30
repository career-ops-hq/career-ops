// Optional real-browser regression. Start the web server against disposable
// data, then set ASSISTANT_CONFIRM_TEST_URL to its loopback URL. All assistant
// history/status APIs are intercepted; streamed proposals come from a fixture
// server. No CLI, real tracker update or application submission is invoked.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ASSISTANT_CONFIRM_TEST_URL;

test("assistant confirmation context and keyboard continuation during streaming", { skip: liveServerSkip("ASSISTANT_CONFIRM_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  let response;
  const fixture = http.createServer(async (request, res) => {
    for await (const chunk of request) { /* consume the fictional request */ }
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": origin.origin });
    res.flushHeaders();
    response = res;
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  t.after(() => { response?.end(); fixture.closeAllConnections(); fixture.close(); });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const writes = [];
  const unexpected = [];
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" })));
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") {
      unexpected.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.route("**/api/assistant/chats**", (route) => route.fulfill({ json: route.request().method() === "PUT" ? { revision: 1, title: "Fictional audit" } : { chats: [], errors: [] } }));
  await page.route("**/api/status", (route) => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, status: route.request().postDataJSON().status } });
  });
  await page.route("**/api/assistant", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/assistant` }));
  async function until(check) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("UI did not reach the expected state");
  }
  async function tabTo(target) {
    for (let i = 0; i < 80; i++) {
      if (await target.evaluate((element) => document.activeElement === element)) return;
      await page.keyboard.press("Tab");
    }
    assert.fail("control is not reachable by Tab");
  }
  async function focused(target) {
    return target.evaluate((element) => document.activeElement === element);
  }
  const summary = (n, status) => `Mark #${n} → ${status}?`;
  const card = (n, status) => page.getByRole("group", { name: summary(n, status), exact: true });
  const decision = (verb, n, status) => page.getByRole("button", { name: `${verb}: ${summary(n, status)}`, exact: true });
  const proposal = (n, status) => `\n<<act:setStatus ${JSON.stringify({ n, status })}>>`;

  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  const open = page.getByRole("button", { name: "Ask the assistant", exact: true });
  await open.waitFor();
  await tabTo(open);
  await page.keyboard.press("Enter");
  const input = page.locator("textarea");
  await input.waitFor();
  await tabTo(input);
  await page.keyboard.type("Review the fictional status proposals");
  await page.keyboard.press("Enter");
  await until(() => response);
  response.write("Please review these changes." + proposal("11", "Interview") + proposal("12", "Rejected"));
  await until(() => page.getByRole("button", { name: /^Confirm/ }).count().then((count) => count === 2));
  assert.equal(await decision("Cancel", "11", "Interview").count(), 1);
  await decision("Confirm", "12", "Rejected").waitFor();
  assert.equal(await focused(input), true, "proposal arrival must not steal focus");
  assert.deepEqual(writes, [], "proposals must not auto-execute");
  const firstId = await card("11", "Interview").getAttribute("aria-labelledby");
  const secondId = await card("12", "Rejected").getAttribute("aria-labelledby");
  assert.ok(firstId && secondId && firstId !== secondId);

  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const visible = nodes.filter((node) => !node.ignored);
  for (const [n, status] of [["11", "Interview"], ["12", "Rejected"]]) {
    assert.equal(visible.filter((node) => node.role?.value === "group" && node.name?.value === summary(n, status)).length, 1);
    for (const verb of ["Confirm", "Cancel"]) {
      assert.equal(visible.filter((node) => node.role?.value === "button" && node.name?.value === `${verb}: ${summary(n, status)}`).length, 1);
    }
  }

  await tabTo(decision("Cancel", "11", "Interview"));
  await page.keyboard.press("Enter");
  const cancelled = card("11", "Interview").locator('[tabindex="-1"]');
  await until(() => focused(cancelled));
  assert.equal(await cancelled.innerText(), "cancelled");
  assert.deepEqual(writes, []);
  const cancelledTree = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(cancelledTree.nodes.some((node) => !node.ignored && node.name?.value === `${summary("11", "Interview")} cancelled` && node.properties?.some((p) => p.name === "focused" && p.value.value === true)));

  // More streamed text must preserve both card identity and result focus.
  response.write(" More explanation while the response continues.");
  await page.getByText(/More explanation while the response continues/).waitFor();
  assert.equal(await focused(cancelled), true);
  assert.equal(await card("11", "Interview").getAttribute("aria-labelledby"), firstId);
  await tabTo(decision("Confirm", "12", "Rejected"));
  await page.keyboard.press("Space");
  const started = card("12", "Rejected").locator('[tabindex="-1"]');
  await until(() => focused(started));
  assert.equal(await started.innerText(), "Status saved.");
  assert.deepEqual(writes, [{ n: "12", status: "Rejected" }]);
  const startedTree = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(startedTree.nodes.some((node) => !node.ignored && node.name?.value === `${summary("12", "Rejected")} Status saved.` && node.properties?.some((p) => p.name === "focused" && p.value.value === true)));

  // Automation activating a control while the user is elsewhere must not
  // relocate that user's focus. Both decisions keep the existing callback gate.
  response.write(proposal("13", "Offer") + proposal("14", "Discarded"));
  await decision("Cancel", "13", "Offer").waitFor();
  await tabTo(input);
  await decision("Cancel", "13", "Offer").evaluate((button) => button.click());
  await card("13", "Offer").getByText("cancelled", { exact: true }).waitFor();
  assert.equal(await focused(input), true);
  await decision("Confirm", "14", "Discarded").evaluate((button) => button.click());
  await card("14", "Discarded").getByText("Status saved.", { exact: true }).waitFor();
  assert.equal(await focused(input), true);
  assert.deepEqual(writes, [{ n: "12", status: "Rejected" }, { n: "14", status: "Discarded" }]);
  response.end();
  await until(() => page.getByRole("button", { name: "New chat", exact: true }).isEnabled());
  assert.equal(await focused(input), true);
  for (const [n, status] of [["11", "Interview"], ["12", "Rejected"], ["13", "Offer"], ["14", "Discarded"]]) {
    assert.equal(await card(n, status).locator('[aria-live], [role="status"], [role="alert"]').count(), 0, "focused result is not also live-announced");
  }
  assert.deepEqual(unexpected, []);
});
