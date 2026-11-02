// Optional live regression: use the disposable pipeline-status fixture and a
// localhost server, then set FOLLOWUPS_LOADING_TEST_URL and FOLLOWUPS_LOADING_TEST_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.FOLLOWUPS_LOADING_TEST_URL;
const root = process.env.FOLLOWUPS_LOADING_TEST_ROOT;

test("Follow-ups holds the table's place while the cadence loads", {
  skip: liveServerSkip("FOLLOWUPS_LOADING_TEST_URL", "FOLLOWUPS_LOADING_TEST_ROOT"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  assert.ok(!fs.existsSync(path.join(root, "config/profile.yml")), "no profile, so follow-ups stay enabled");
  const initial = fs.readFileSync(path.join(root, "data/applications.md"), "utf8");
  assert.match(initial, /\| Fixture Beta \| Designer \| 3\.8\/5 \| Applied \|/);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visible = (locator) => locator.filter({ visible: true });
  const table = visible(page.getByRole("table"));
  const busyBody = visible(page.locator('tbody[aria-busy="true"]'));
  const betaRow = visible(page.getByRole("row").filter({ hasText: "Fixture Beta" }));
  const isCadence = (u) => { const parsed = new URL(u); return parsed.pathname === "/api/followups" && parsed.search === "?full=1"; };

  await t.test("while the cadence is held, a busy follow-ups table stands in for it", async (subtest) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let requested = false;
    subtest.after(async () => { release(); await page.unrouteAll({ behavior: "wait" }); });
    await page.route((u) => isCadence(u.href), async (route) => {
      requested = true;
      await held;
      await route.continue();
    });
    const response = await page.goto(`${origin.origin}/followups`);
    assert.equal(response.status(), 200);
    await visible(page.getByRole("heading", { name: "Follow-up Tracker", exact: true })).waitFor();
    await busyBody.waitFor({ timeout: 15_000 });
    const started = Date.now();
    while (!requested) {
      if (Date.now() - started > 15_000) assert.fail("the cadence request never started");
      await page.waitForTimeout(50);
    }
    assert.equal(await busyBody.count(), 1, "the busy table is still up once the cadence request is in flight");
    for (const name of ["Company", "Role", "Urgency", "Next follow-up"]) {
      assert.equal(await table.getByRole("columnheader", { name: new RegExp(`^${name}`) }).isVisible(), true, `${name} header visible while loading`);
    }
    assert.ok(await busyBody.locator("tr").count() > 0);
    assert.equal(await betaRow.count(), 0);

    release();
    await betaRow.waitFor();
    assert.equal(await busyBody.count(), 0);
  });

  await t.test("a hard load asks the server for the cadence once", async () => {
    const cadenceRequests = [];
    const track = (request) => { if (isCadence(request.url())) cadenceRequests.push(request.url()); };
    page.on("request", track);
    await page.goto(`${origin.origin}/followups`);
    await betaRow.waitFor();
    await page.waitForLoadState("networkidle");
    page.off("request", track);
    assert.equal(cadenceRequests.length, 1);
  });

  assert.deepEqual(errors, []);
});
