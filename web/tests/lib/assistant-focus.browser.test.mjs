// Optional Chrome regression: start the local web server against disposable
// data containing a fictional cv.md (so Home exposes its onboarding banner),
// then ASSISTANT_FOCUS_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
// Every mutating API is intercepted; no CLI or real data write is invoked.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ASSISTANT_FOCUS_TEST_URL;
test("Assistant keyboard continuation, semantic context and modeless behavior", { skip: liveServerSkip("ASSISTANT_FOCUS_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const responses = [];
  const requests = [];
  const fixture = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": origin.origin });
    res.flushHeaders();
    responses.push(res);
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  t.after(() => { responses.forEach((res) => res.end()); fixture.closeAllConnections(); fixture.close(); });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const unexpected = [];
  async function pageFor(cli = true, width = 1280) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript((cli) => { if (cli) localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "fixture-cli" })); }, cli);
    await page.route("**/api/**", (route) => {
      if (route.request().method() === "GET") return route.continue();
      unexpected.push(route.request().url());
      return route.abort();
    });
    await page.route("**/api/assistant/chats**", (route) => route.fulfill({ json: route.request().method() === "PUT" ? { revision: 1, title: "Fictional focus fixture" } : { chats: [], errors: [] } }));
    await page.route("**/api/doctor", (route) => route.fulfill({ json: { available: true, onboardingNeeded: true, missing: ["config/profile.yml", "portals.yml"], warnings: [] } }));
    await page.route("**/api/assistant", (route) => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/assistant` }));
    return page;
  }
  async function focused(locator) { return locator.evaluate((el) => el === document.activeElement); }
  async function until(check) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail("UI did not reach expected state");
  }
  async function tabTo(page, target) {
    for (let i = 0; i < 100; i++) {
      if (await focused(target)) return;
      await page.keyboard.press("Tab");
    }
    assert.fail("control is not keyboard reachable");
  }
  const opener = (page) => page.getByRole("button", { name: "Ask the assistant", exact: true });
  const composer = (page) => page.getByRole("textbox", { name: "Message to assistant", exact: true });
  const panel = (page) => page.getByRole("region", { name: "Assistant", exact: true });
  async function openWithKeyboard(page, target = opener(page)) {
    await target.waitFor();
    await tabTo(page, target);
    await page.keyboard.press("Enter");
    await page.locator("textarea").waitFor();
    assert.equal(await panel(page).count(), 1);
  }
  const page = await pageFor();
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await openWithKeyboard(page);
  assert.equal(await focused(composer(page)), true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(nodes.some((node) => !node.ignored && node.role?.value === "region" && node.name?.value === "Assistant"));
  assert.ok(nodes.some((node) => !node.ignored && node.role?.value === "textbox" && node.name?.value === "Message to assistant" && node.description?.value === "Enter sends your message. Shift+Enter adds a new line."));
  assert.equal(await panel(page).getAttribute("aria-modal"), null);

  // IME Enter/Escape must neither send nor close; Shift+Enter inserts a line.
  await page.keyboard.type("First line");
  await composer(page).dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await composer(page).dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await composer(page).dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  assert.equal(requests.length, 0);
  assert.equal(await panel(page).count(), 1);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  assert.equal(await composer(page).inputValue(), "First line\nSecond line");
  await until(() => page.getByRole("button", { name: "Send", exact: true }).isEnabled());
  await page.keyboard.press("Enter");
  await until(() => requests.length === 1);
  assert.equal(await focused(composer(page)), true);
  assert.equal(requests[0].message, "First line\nSecond line");
  await page.keyboard.type("Unsent draft");
  await tabTo(page, page.getByRole("button", { name: "Close assistant", exact: true }));
  await page.keyboard.press("Enter");
  await until(() => focused(opener(page)));
  responses[0].end("Fictional reply while closed.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await focused(opener(page)), true);
  await page.keyboard.press("Enter");
  await until(() => focused(composer(page)));
  assert.equal(await composer(page).inputValue(), "Unsent draft");
  await page.getByText("Fictional reply while closed.", { exact: true }).waitFor();

  // Send-button activation has the same continuation as composer Enter.
  const send = page.getByRole("button", { name: "Send", exact: true });
  await until(() => send.isEnabled());
  await tabTo(page, send);
  await page.keyboard.press("Space");
  await until(() => requests.length === 2);
  assert.equal(await focused(composer(page)), true);
  assert.equal(requests[1].message, "Unsent draft");
  // Leave the modeless panel: replies and repeated open events cannot pull back.
  const search = page.getByRole("textbox", { name: "Search company or role…", exact: true });
  await tabTo(page, search);
  await page.keyboard.press("Escape");
  assert.equal(await panel(page).count(), 1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("co-assistant")));
  assert.equal(await focused(search), true);
  responses[1].end("Second fictional reply.");
  await page.getByText("Second fictional reply.", { exact: true }).waitFor();
  assert.equal(await focused(search), true);
  await tabTo(page, page.getByRole("combobox", { name: "Conversation history", exact: true }));
  await page.keyboard.press("Escape");
  assert.equal(await panel(page).count(), 1, "native select gets Escape first");
  await tabTo(page, composer(page));
  await page.keyboard.press("Escape");
  await until(() => focused(opener(page)));

  const noCli = await pageFor(false);
  await noCli.goto(`${origin.origin}/pipeline?tab=ALL`);
  await openWithKeyboard(noCli);
  const config = noCli.getByRole("link", { name: /Pick a CLI in Config/ });
  assert.equal(await composer(noCli).isDisabled(), true);
  assert.equal(await focused(config), true);
  await noCli.keyboard.press("Escape");
  await until(() => focused(opener(noCli)));
  // Narrow viewport is not a native mobile keyboard test.
  const narrow = await pageFor(true, 390);
  await narrow.goto(`${origin.origin}/pipeline?tab=ALL`);
  await opener(narrow).click();
  await until(() => focused(composer(narrow)));
  const box = await composer(narrow).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  await narrow.keyboard.press("Escape");
  await until(() => focused(opener(narrow)));

  const home = await pageFor();
  await home.goto(origin.origin);
  const setup = home.getByRole("button", { name: "Set me up with the assistant", exact: true });
  await openWithKeyboard(home, setup);
  assert.equal(await focused(composer(home)), true);
  await until(() => requests.length === 3);
  await home.keyboard.press("Escape");
  await until(() => focused(setup));
  responses[2].end("Fictional setup reply.");
  // If the opening control disappears, return to the persistent Ask affordance.
  await home.evaluate(() => window.dispatchEvent(new CustomEvent("co-assistant")));
  await until(() => focused(composer(home)));
  await until(() => home.getByRole("button", { name: "New chat", exact: true }).isEnabled());
  const pipelineLink = home.getByRole("complementary").getByRole("link", { name: "Pipeline", exact: true });
  await tabTo(home, pipelineLink);
  await home.keyboard.press("Enter");
  await home.waitForURL(/\/pipeline$/);
  await tabTo(home, composer(home));
  await home.keyboard.press("Escape");
  await until(() => focused(opener(home)));
  assert.equal(requests.length, 3);
  // A programmatic open with no meaningful origin falls back to Ask on close.
  await home.evaluate(() => { document.activeElement.blur(); window.dispatchEvent(new CustomEvent("co-assistant")); });
  await until(() => focused(composer(home)));
  await home.keyboard.press("Escape");
  await until(() => focused(opener(home)));
  assert.deepEqual(unexpected, []);
});
