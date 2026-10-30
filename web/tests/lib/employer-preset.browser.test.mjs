// Run with EXPLORE_EMPLOYER_TEST_URL=http://127.0.0.1:35423 against disposable data.
// Real Chromium DOM / AX-tree checks, not manual screen-reader speech verification.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";
const base = process.env.EXPLORE_EMPLOYER_TEST_URL;

test(
  "employer preset keyboard flow, accessible validation and all terminal outcomes",
  { skip: liveServerSkip("EXPLORE_EMPLOYER_TEST_URL"), timeout: 180_000 },
  async (t) => {
    const origin = new URL(base);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const writes = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && !r.url().includes("/__nextjs"))
        writes.push(new URL(r.url()).pathname);
    });
    let responseEvents = [];
    let requests = [];
    let release;
    await page.route("**/api/explore", async (route) => {
      requests.push(route.request().postDataJSON());
      if (release) await release.promise;
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: responseEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
      });
    });
    const unintended = [];
    await page.route("**/api/explore/add", (route) => {
      unintended.push("add");
      return route.fulfill({ json: { added: 1 } });
    });
    await page.route("**/api/jobs", (route) => {
      if (route.request().method() !== "GET") unintended.push("job");
      return route.fulfill({ json: [] });
    });
    const logo = [];
    await page.route("**/api/logo?**", (route) => {
      logo.push(route.request().url());
      return route.abort();
    });
    await page.goto(`${origin.origin}/explore`);
    const preset = page.getByRole("radio", {
      name: "Public ATS network",
      exact: true,
    });
    await preset.waitFor();
    assert.equal(await preset.isChecked(), true);
    const roles = page.getByRole("textbox", {
      name: "Roles to find",
      exact: true,
    });
    const location = page.getByRole("textbox", {
      name: "City or location",
      exact: true,
    });
    await roles.focus();
    await page.keyboard.type("工程师");
    await page.keyboard.press("Enter");
    await location.focus();
    await page.keyboard.type("北京");
    await page.keyboard.press("Enter");
    await preset.focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("checkbox", { name: "Tencent / 腾讯" }).waitFor();
    assert.equal(await page.getByText("工程师", { exact: true }).count(), 1);
    assert.equal(await page.getByText("北京", { exact: true }).count(), 1);
    assert.equal(
      await page.getByText("Posted within", { exact: true }).count(),
      0,
    );
    const checkboxes = page.getByRole("checkbox");
    assert.equal(await checkboxes.count(), 3);
    assert.equal(
      await page
        .getByRole("checkbox", { name: "ByteDance / 字节跳动", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByRole("checkbox", { name: /Alibaba/ }).count(),
      0,
    );
    for (const c of await checkboxes.all())
      assert.equal(await c.isChecked(), true);
    await page
      .getByRole("radio", { name: "China employer preset", exact: true })
      .focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Space");
    }
    const discover = page.getByRole("button", {
      name: "Discover (free)",
      exact: true,
    });
    assert.equal(await discover.isDisabled(), true);
    assert.equal(
      await discover.getAttribute("aria-describedby"),
      "employer-selection",
    );
    assert.match(
      await page.locator("#employer-selection").innerText(),
      /Select at least one/,
    );
    assert.match(await discover.ariaSnapshot(), /disabled/);
    assert.equal(requests.length, 0);
    await page
      .getByRole("radio", { name: "China employer preset", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");

    const offer = {
      company: "Tencent",
      title: "Fixture 工程师",
      url: "https://example.com/jobs/fixture-5423",
      location: "",
      postedAt: "",
      ats: "tencent",
      source: "tencent",
    };
    const status = page.locator('p[role="status"]');
    for (const [state, count] of [
      ["complete", 1],
      ["complete", 0],
      ["partial", 0],
      ["partial", 1],
      ["failed", 0],
    ]) {
      const message =
        state === "failed"
          ? "Failed — Tencent: source timed out."
          : state === "partial"
            ? `Partial / incomplete — ${count} matches. Meituan: source failed.`
            : count
              ? "Completed — 1 matches from Tencent."
              : "No matches for this scan — Tencent.";
      responseEvents = [
        {
          kind: "summary",
          companiesScanned: state === "failed" ? 0 : 1,
          unreachable: state === "complete" ? 0 : 1,
          matches: count,
          employerOutcome: { state, message },
        },
        { kind: "done", count, offers: count ? [offer] : [] },
      ];
      let resolve;
      release = {
        promise: new Promise((r) => {
          resolve = r;
        }),
      };
      const button = page.getByRole("button", {
        name: /^(Discover|Re-cast) \(free\)$/,
      });
      // Refine is closed after a result; keyboard-open it before starting again.
      if ((await button.count()) === 0) {
        const refine = page.getByRole("button", {
          name: "Refine search",
          exact: true,
        });
        await refine.focus();
        await page.keyboard.press("Enter");
      }
      const start = page.getByRole("button", {
        name: /^(Discover|Re-cast) \(free\)$/,
      });
      await start.focus();
      await page.keyboard.press("Enter");
      await page
        .getByText("Scanning selected employers…", { exact: true })
        .waitFor();
      const focusBefore = await page.evaluateHandle(
        () => document.activeElement,
      );
      resolve();
      release = null;
      await page.getByText(message, { exact: true }).waitFor();
      await page.waitForFunction(() => sessionStorage.getItem("career-ops:explore-results") === null);
      assert.equal(
        await focusBefore.evaluate(
          (element) => element === document.activeElement,
        ),
        true,
        "completion must not move focus",
      );
      assert.match(
        await status.ariaSnapshot(),
        new RegExp(
          state === "complete"
            ? count
              ? "Completed"
              : "No matches"
            : state === "partial"
              ? "Partial"
              : "Failed",
        ),
      );
      assert.equal(await status.getAttribute("aria-live"), "polite");
      assert.equal(await status.getAttribute("aria-atomic"), "true");
      assert.equal(
        await page.locator("[aria-live] h3").count(),
        0,
        "results are not a live region",
      );
      if (count) {
        await page.getByRole("heading", { name: offer.title }).waitFor();
        assert.equal(await page.getByText("Location unknown").count(), 1);
        assert.equal(await page.getByText("Posting date unknown").count(), 1);
        const link = page.getByRole("link", {
          name: "Open the posting",
          exact: true,
        });
        assert.equal(await link.getAttribute("href"), offer.url);
        await page.route(offer.url, (r) =>
          r.fulfill({ body: "Fixture original JD" }),
        );
        await link.focus();
        const popup = page.waitForEvent("popup");
        await page.keyboard.press("Enter");
        const opened = await popup;
        await opened.waitForLoadState();
        assert.equal(opened.url(), offer.url);
        await opened.close();
      }
    }
    for (const r of requests) {
      assert.equal(r.preset, "china-employers");
      assert.deepEqual(r.employers, ["tencent"]);
      assert.deepEqual(r.positive, ["工程师"]);
      assert.deepEqual(r.allow, ["北京"]);
      assert.equal(r.sinceDays, undefined);
      assert.equal(r.negative, undefined);
      assert.equal(r.ats, undefined);
    }
    assert.deepEqual(unintended, []);
    assert.deepEqual(
      logo,
      [],
      "opening preset results must not populate the disk-backed logo cache",
    );
    assert.ok(
      writes.every((p) => p === "/api/explore"),
      `unexpected writes: ${writes}`,
    );
    // Leaving the preset preserves the user-entered terms and restores ATS controls.
    await preset.focus();
    await page.keyboard.press("Space");
    await page.getByText("Posted within", { exact: true }).waitFor();
    assert.equal(await page.getByText("工程师", { exact: true }).count(), 1);
  },
);

test(
  "legacy ATS and employer cards keep pipeline-add and evaluation behind explicit actions",
  { skip: liveServerSkip("EXPLORE_EMPLOYER_TEST_URL"), timeout: 90_000 },
  async (t) => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    t.after(() => browser.close());
    for (const source of ["greenhouse", "tencent"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const added = [];
      const evaluated = [];
      const scans = [];
      const offer = {
        url: `https://example.com/fixture-${source}`,
        company: "Fixture Co",
        title: "Fixture Engineer",
        location: "北京",
        postedAt: "2026-10-18",
        ats: source,
        source,
      };
      await page.route("**/api/clis", (route) =>
        route.fulfill({ json: { clis: [{ id: "codex", installed: true }] } }),
      );
      await page.route("**/api/explore/add", (route) => {
        added.push(route.request().postDataJSON());
        return route.fulfill({ json: { added: 1 } });
      });
      await page.route("**/api/run", (route) => {
        evaluated.push(route.request().postDataJSON());
        return route.fulfill({
          status: 400,
          json: { error: "Fixture: no model is started" },
        });
      });
      await page.route("**/api/logo?**", (route) => route.abort());
      await page.route("**/api/explore", (route) => {
        scans.push(route.request().postDataJSON());
        const summary = {
          kind: "summary",
          companiesScanned: 1,
          unreachable: 0,
          matches: 1,
          ...(source === "tencent"
            ? {
                employerOutcome: {
                  state: "complete",
                  message: "Completed — Tencent fixture.",
                },
              }
            : {}),
        };
        return route.fulfill({
          contentType: "application/x-ndjson",
          body:
            [summary, { kind: "done", count: 1, offers: [offer] }]
              .map((e) => JSON.stringify(e))
              .join("\n") + "\n",
        });
      });
      await page.goto(`${new URL(base).origin}/explore`);
      const preset = page.getByRole("radio", {
        name: "Public ATS network",
        exact: true,
      });
      await preset.waitFor();
      if (source === "tencent") {
        await preset.focus();
        await page.keyboard.press("ArrowRight");
      }
      const discover = page.getByRole("button", {
        name: "Discover (free)",
        exact: true,
      });
      await discover.focus();
      await page.keyboard.press("Enter");
      const add = page.getByRole("button", {
        name: "Add to pipeline",
        exact: true,
      });
      await add.waitFor();
      assert.deepEqual(added, []);
      assert.deepEqual(evaluated, []);
      if (source === "greenhouse") {
        assert.equal(scans[0].preset, undefined);
        assert.deepEqual(scans[0].ats, [
          "greenhouse",
          "lever",
          "ashby",
          "workday",
        ]);
      }
      await add.focus();
      const addResponse = page.waitForResponse((r) =>
        r.url().endsWith("/api/explore/add"),
      );
      await page.keyboard.press("Enter");
      await addResponse;
      await page
        .getByRole("button", { name: "In pipeline", exact: true })
        .waitFor();
      assert.equal(added.length, 1);
      assert.equal(added[0].offers[0].url, offer.url);
      assert.deepEqual(evaluated, []);
      const evaluate = page.getByRole("button", {
        name: "Evaluate",
        exact: true,
      });
      await evaluate.focus();
      const runResponse = page.waitForResponse((r) =>
        r.url().endsWith("/api/run"),
      );
      await page.keyboard.press("Enter");
      await runResponse;
      assert.equal(evaluated.length, 1);
      assert.equal(evaluated[0].kind, "evaluate");
      assert.equal(evaluated[0].input, offer.url);
      assert.equal(
        added.length,
        1,
        "evaluation does not duplicate an already-added result",
      );
      await context.close();
    }
  },
);
