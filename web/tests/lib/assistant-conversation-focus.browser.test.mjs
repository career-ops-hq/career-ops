// Run against disposable data; all conversation writes are intercepted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

test("conversation controls restore focus without stealing Tab or later focus", { skip: liveServerSkip("ASSISTANT_CONVERSATION_FOCUS_TEST_URL"), timeout: 120_000 }, async t => {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const chat = { id: "11111111-1111-4111-8111-111111111111", revision: 1, title: "Fixture chat", messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }] };
  let deleted = false, fail = false, hold;
  await page.route("**/api/**", route => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.route("**/api/assistant/chats**", async route => {
    if (hold) { const wait = hold; hold = undefined; await wait; }
    if (fail) return route.fulfill({ status: 500, json: { error: "Fixture failure" } });
    if (route.request().method() === "DELETE") { deleted = true; return route.fulfill({ json: { ok: true } }); }
    if (route.request().method() === "PUT") { Object.assign(chat, route.request().postDataJSON()); chat.revision++; return route.fulfill({ json: chat }); }
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has("id") ? chat : { chats: deleted ? [] : [chat], errors: [] } });
  });
  await page.goto(`${process.env.ASSISTANT_CONVERSATION_FOCUS_TEST_URL}/pipeline?tab=ALL`);
  await page.getByRole("button", { name: "Ask the assistant", exact: true }).click();
  const panel = page.getByRole("region", { name: "Assistant", exact: true });
  const history = panel.getByRole("combobox");
  const editor = panel.getByRole("textbox", { name: "Conversation name", exact: true });
  const rename = panel.getByRole("button", { name: "Rename", exact: true });
  const focused = async locator => {
    await page.waitForFunction(() => document.activeElement !== document.body);
    assert.equal(await locator.evaluate(el => el === document.activeElement), true);
  };
  for (const exit of ["Enter", "Escape", "Save name", "Cancel"]) {
    await rename.click();
    await editor.fill(`Renamed ${exit}`);
    if (exit === "Enter" || exit === "Escape") await editor.press(exit);
    else await panel.getByRole("button", { name: exit, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Conversation name"]') && !document.querySelector('[role="combobox"]').disabled);
    await focused(history);
  }
  await rename.click();
  await editor.fill("IME draft");
  for (const event of [{ key: "Escape", isComposing: true }, { key: "Enter", isComposing: true }, { key: "Escape", keyCode: 229 }]) await editor.dispatchEvent("keydown", event);
  assert.equal(await editor.inputValue(), "IME draft");
  await editor.press("Escape");
  await focused(history);

  for (const title of [chat.title, "   ", "Failed rename"]) {
    await rename.click();
    await editor.fill(title);
    fail = title === "Failed rename";
    await editor.press("Enter");
    await page.waitForFunction(() => !document.querySelector('[aria-label="Conversation name"]') && !document.querySelector('[role="combobox"]').disabled);
    await focused(history);
    fail = false;
  }

  // Tabbing out commits, but keeps the user's destination.
  await rename.click();
  await editor.fill("Tab rename");
  await editor.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const destination = await page.evaluateHandle(() => document.activeElement);
  await page.waitForFunction(() => !document.querySelector('[role="combobox"]').disabled);
  assert.equal(await page.evaluate(el => document.activeElement === el, destination), true);

  for (const shouldFail of [false, true]) {
    await history.focus();
    await history.press("ArrowDown");
    await page.getByRole("option", { name: chat.title, exact: true }).focus();
    fail = shouldFail;
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const control = document.querySelector('[aria-label="Conversation history"]');
      return control?.getAttribute("aria-expanded") === "false" && !control.disabled;
    });
    await focused(history);
    fail = false;
  }
  // A user can move focus during a pending selection; completion must respect it.
  let release;
  await history.click();
  hold = new Promise(resolve => { release = resolve; });
  await page.getByRole("option", { name: chat.title, exact: true }).click();
  const close = panel.getByRole("button", { name: "Close assistant", exact: true });
  await close.focus();
  release();
  await page.waitForFunction(() => !document.querySelector('[role="combobox"]').disabled);
  await focused(close);

  const remove = panel.getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Delete conversation?" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await focused(remove);
  for (const shouldFail of [true, false]) {
    await remove.click();
    fail = shouldFail;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const newChat = panel.getByRole("button", { name: "New chat", exact: true });
    await page.waitForFunction(() => !document.querySelector('[aria-labelledby="delete-chat-title"]') && !document.querySelector('[aria-label="New chat"]').disabled);
    await focused(newChat);
    fail = false;
  }
});
