import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

test("import PDF and TeX, review, back up and persist cv.md without leaving the editor", {
  skip: liveServerSkip("CV_UPLOAD_TEST_URL", "CV_UPLOAD_TEST_ROOT"), timeout: 90000,
}, async t => {
  const origin = new URL(process.env.CV_UPLOAD_TEST_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
  const root = fs.realpathSync(process.env.CV_UPLOAD_TEST_ROOT);
  assert.ok([os.tmpdir(), "/tmp"].filter(dir => fs.existsSync(dir)).some(dir => {
    const relative = path.relative(fs.realpathSync(dir), root);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  }));
  assert.equal(fs.readFileSync(path.join(root, ".cv-upload-fixture"), "utf8").trim(), "fictional-only");
  const cv = path.join(root, "cv.md");
  const initial = fs.readFileSync(cv, "utf8");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ cliId: "codex" })));
  await page.goto(`${origin.origin}/cv`);
  await page.getByLabel("CV Markdown", { exact: true }).fill(initial + "\nUnsaved draft");

  let failure = false;
  let incomplete = false;
  let proposed = "# CV -- Alex Example\n\n## Work Experience\n### Example Co -- Berlin\n**Engineer**\n2021-2026\n- Improved delivery by 25%.";
  await page.route("**/api/cv/ingest", async route => {
    const request = route.request();
    assert.match(request.headers()["content-type"], /multipart\/form-data/);
    assert.match(request.postDataBuffer().toString(), /filename="resume\.(pdf|tex)"/);
    if (failure) return route.fulfill({ status: 400, json: { error: "Fixture file could not be read." } });
    await route.fulfill({ contentType: "text/plain", body: `Reading your CV…\n<<cv:start>>\n${proposed}\n${incomplete ? "" : "<<cv:end>>"}` });
  });
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).click();
  assert.equal(await page.getByLabel("CV Markdown", { exact: true }).isDisabled(), true);
  await page.getByLabel("Upload CV file").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("fictional PDF; response mocked") });
  await page.getByLabel("Imported CV Markdown").waitFor();
  assert.equal(fs.readFileSync(cv, "utf8"), initial, "review must not write cv.md");
  await page.getByRole("button", { name: "Close upload", exact: true }).click();
  assert.equal(await page.getByLabel("CV Markdown", { exact: true }).inputValue(), initial + "\nUnsaved draft");

  // TeX also goes through conversion, then the real canonical save endpoint.
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).click();
  const tex = { name: "resume.tex", mimeType: "application/x-tex", buffer: Buffer.from("\\section{Experience} Fictional CV") };
  await page.getByLabel("Upload CV file").setInputFiles(tex);
  await page.getByLabel("Imported CV Markdown").waitFor();
  await page.route("**/api/cv", route => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { error: "Fixture save failed" } }) : route.continue());
  await page.getByRole("button", { name: "Update cv.md", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await page.getByLabel("Imported CV Markdown").inputValue(), proposed);
  assert.equal(fs.readFileSync(cv, "utf8"), initial);
  await page.unroute("**/api/cv");
  await page.getByRole("button", { name: "Update cv.md", exact: true }).click();
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).waitFor();
  assert.equal(fs.readFileSync(cv, "utf8"), proposed);
  assert.ok(fs.readdirSync(root).filter(name => name.startsWith("cv.md.bak-")).some(name => fs.readFileSync(path.join(root, name), "utf8") === initial));
  assert.equal(new URL(page.url()).pathname, "/cv");
  await page.reload();
  assert.equal(await page.getByLabel("CV Markdown", { exact: true }).inputValue(), proposed);

  // A PDF can be saved too. Failure and truncated conversion preserve it.
  proposed += "\n\n## Skills\n- TypeScript";
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).click();
  const pdf = { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("fictional PDF; response mocked") };
  await page.getByLabel("Upload CV file").setInputFiles(pdf);
  await page.getByLabel("Imported CV Markdown").waitFor();
  await page.getByRole("button", { name: "Update cv.md", exact: true }).click();
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).waitFor();
  assert.equal(fs.readFileSync(cv, "utf8"), proposed);
  for (const kind of ["failure", "incomplete"]) {
    failure = kind === "failure";
    incomplete = kind === "incomplete";
    await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).click();
    await page.getByLabel("Upload CV file").setInputFiles(pdf);
    await page.getByRole("alert").filter({ hasText: failure ? "Fixture file could not be read" : "Couldn't finish reading" }).waitFor();
    assert.equal(fs.readFileSync(cv, "utf8"), proposed);
    assert.equal(await page.getByRole("button", { name: "Update cv.md", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Close upload", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Upload PDF / TeX", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(root, "cv-upload-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
});
