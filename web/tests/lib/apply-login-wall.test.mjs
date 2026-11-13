// A sign-in page with an email box used to count as the application, and the
// password input was stored as text. A later fill would type into it.
//
// Run from web/: node --test tests/lib/apply-login-wall.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const loginHtml = readFileSync(join(here, "../fixtures/apply-login-wall.html"), "utf8");
const applicationHtml = readFileSync(join(here, "../fixtures/apply-login-wall-application.html"), "utf8");

test("a password box is a login wall and stays blank", async (t) => {
  const server = createServer((req, res) => {
    const body = (req.url || "").includes("application") ? applicationHtml : loginHtml;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { chromium } = await import("playwright-core");
  const { extractForm } = await import("../../src/lib/apply/extract.ts");
  const { fillSession, isApplicationFormFn } = await import("../../src/lib/apply/session.ts");
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    t.skip(`system Chrome did not launch (${reason})`);
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();

  await page.goto(`http://127.0.0.1:${port}/apply-login-wall.html`);
  const login = await extractForm(page.mainFrame());
  const password = login.fields.find((field) => field.label === "Password");
  assert.equal(password?.type, "password");
  assert.equal(isApplicationFormFn(login), false);

  const answers = Object.fromEntries(login.fields.map((field) => [field.id, "not-a-secret"]));
  const id = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(id, { id, frame: page.mainFrame(), page, title: login.title, url: page.url() });
  try {
    const filled = await fillSession(id, answers, login.fields);
    assert.equal(filled.issues.some((issue) => issue.code === "login-wall"), true);
    assert.equal(filled.steps.length, 0);
  } finally {
    globalThis.__coApplySessions.delete(id);
  }
  const values = await page.locator("input").evaluateAll((els) => els.map((el) => el.value));
  assert.deepEqual(values, ["", "", ""]);

  const secret = login.fields.find((field) => field.label === "Secret");
  const secretId = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(secretId, { id: secretId, frame: page.mainFrame(), page, title: login.title, url: page.url() });
  try {
    await fillSession(secretId, { [secret.id]: "not-a-secret" }, [{ ...secret, type: "text", label: "Secret" }]);
  } finally {
    globalThis.__coApplySessions.delete(secretId);
  }
  assert.equal(await page.locator("input[name=secret]").inputValue(), "");

  await page.goto(`http://127.0.0.1:${port}/application.html`);
  const application = await extractForm(page.mainFrame());
  assert.equal(isApplicationFormFn(application), true);
  assert.equal(application.fields.some((field) => field.type === "password"), false);

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "password";
    input.name = "late-password";
    document.body.appendChild(input);
  });
  const lateId = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(lateId, { id: lateId, frame: page.mainFrame(), page, title: application.title, url: page.url() });
  try {
    const email = application.fields.find((field) => field.type === "email");
    const filled = await fillSession(lateId, { [email.id]: "not-a-secret" }, application.fields);
    assert.equal(filled.issues.some((issue) => issue.code === "login-wall"), true);
    assert.equal(filled.steps.length, 0);
  } finally {
    globalThis.__coApplySessions.delete(lateId);
  }
  assert.equal(await page.locator("input[name=email]").inputValue(), "");
});
