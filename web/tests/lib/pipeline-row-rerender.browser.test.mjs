// Optional live-browser regression suite (run explicitly from web/tests/lib).
// Run a local web server with CAREER_OPS_ROOT set to a disposable fixture
// directory, then set PIPELINE_ROW_RERENDER_TEST_URL and
// PIPELINE_ROW_RERENDER_TEST_ROOT when running this file.
// Generate that directory with: node tests/fixtures/pipeline-status.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_ROW_RERENDER_TEST_URL;
const root = process.env.PIPELINE_ROW_RERENDER_TEST_ROOT;

// Production React reports every commit to __REACT_DEVTOOLS_GLOBAL_HOOK__, so
// this stand-in hook can record which tracker rows re-rendered.
function installCommitProbe() {
  const lastProps = new Map();
  window.__commits = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id, fiberRoot) {
      const rendered = [];
      const hostParent = (fiber) => {
        let parent = fiber.return;
        while (parent && typeof parent.type !== "string") parent = parent.return;
        return parent;
      };
      const walk = (fiber) => {
        for (; fiber; fiber = fiber.sibling) {
          const key = fiber.memoizedProps?.["data-application-key"];
          if (fiber.type === "tr" && key && hostParent(fiber)?.type === "tbody") {
            if (lastProps.has(key) && lastProps.get(key) !== fiber.memoizedProps) rendered.push(key);
            lastProps.set(key, fiber.memoizedProps);
          }
          walk(fiber.child);
        }
      };
      walk(fiberRoot.current.child);
      const search = document.querySelector('input[placeholder="Search company or role…"]');
      window.__commits.push({ rendered, search: search?.value ?? null });
    },
  };
}

test("tracker rows re-render only when their own content changes (disposable data only)", { skip: liveServerSkip("PIPELINE_ROW_RERENDER_TEST_URL", "PIPELINE_ROW_RERENDER_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(installCommitProbe);
  const row = (n) => page.locator("tbody tr").filter({ has: page.getByRole("link", { name: `#${n}`, exact: true }) });
  const settle = () => page.waitForTimeout(300);
  const takeCommits = () => page.evaluate(() => window.__commits.splice(0));

  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await row(13).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3);

  await t.test("ticking one row's checkbox re-renders only that row", async () => {
    await settle();
    await takeCommits();
    const checkbox = row(12).getByRole("checkbox");
    await checkbox.click();
    assert.equal(await checkbox.isChecked(), true);
    await settle();
    const rendered = (await takeCommits()).flatMap((commit) => commit.rendered);
    assert.equal(rendered.length, 1, `rows re-rendered: ${JSON.stringify(rendered)}`);
    assert.equal(rendered[0], await row(12).getAttribute("data-application-key"));
  });

  await t.test("a search keystroke's own commit re-renders no rows, and links still carry the query", async () => {
    await settle();
    await takeCommits();
    await page.getByPlaceholder("Search company or role…").pressSequentially("f");
    const href = () => row(11).getByRole("link", { name: "#11", exact: true }).getAttribute("href");
    const start = Date.now();
    while (!new URL(await href(), origin).searchParams.has("q")) {
      if (Date.now() - start > 15_000) assert.fail(`row link never gained the typed query: ${await href()}`);
      await page.waitForTimeout(50);
    }
    assert.equal(new URL(await href(), origin).searchParams.get("q"), "f");
    assert.equal(await page.locator("tbody tr").count(), 3);
    const commits = await takeCommits();
    const keystroke = commits.find((commit) => commit.search === "f");
    assert.ok(keystroke, `no commit showed the typed character: ${JSON.stringify(commits)}`);
    assert.deepEqual(keystroke.rendered, [], `the keystroke commit re-rendered rows: ${JSON.stringify(commits)}`);
  });

  assert.deepEqual(errors, []);
});
