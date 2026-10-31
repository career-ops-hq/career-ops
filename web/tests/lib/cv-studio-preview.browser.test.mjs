// Desktop CV Studio live preview. Needs CV_STUDIO_PREVIEW_TEST_URL, or
// `npm run test:browser`. The fixture CV is fictional (Jane Doe, Example Co).
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

test("CV Studio live preview bolds markdown and keeps the date and contact line on the page", { skip: liveServerSkip("CV_STUDIO_PREVIEW_TEST_URL"), timeout: 120_000 }, async (t) => {
  const url = process.env.CV_STUDIO_PREVIEW_TEST_URL;
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/pipeline/7/cv-studio`);
  const frame = page.frameLocator('iframe[title="Tailored CV preview"]');
  await frame.getByText("Microsoft PowerApps").first().waitFor();

  const fit = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Live preview"]');
    const box = section.querySelector(".overflow-auto");
    const doc = section.querySelector("iframe").contentDocument;
    const cw = doc.documentElement.clientWidth;
    const span = (node) => {
      const range = doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, node.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    };
    const date = span(doc.querySelector(".job-period").firstChild);
    const longDate = doc.querySelectorAll(".job-period")[1].getBoundingClientRect();
    const link = doc.querySelector('.contact-row a[href*="jane.example.com"]');
    const last = link.firstChild;
    const end = doc.createRange();
    end.setStart(last, last.length - 1);
    end.setEnd(last, last.length);
    const linkEnd = end.getBoundingClientRect().right;
    const pageHeight = doc.querySelector(".page").getBoundingClientRect().height;
    const pages = Math.max(1, Math.ceil(pageHeight / 1056));
    return {
      asterisks: (doc.body.innerText.match(/\*\*/g) || []).length,
      strong: [...doc.querySelectorAll("strong")].map((el) => el.textContent),
      date,
      longDate: { left: longDate.left, right: longDate.right, height: longDate.height },
      linkEnd,
      cw,
      sw: doc.documentElement.scrollWidth,
      outerScroll: box.scrollWidth > box.clientWidth + 1,
      label: section.querySelector(".justify-between").innerText.replace(/\s+/g, " ").trim(),
      pages,
    };
  });

  assert.equal(fit.asterisks, 0);
  assert.ok(fit.strong.includes('"Microsoft PowerApps"'));
  assert.ok(fit.strong.includes("~2,000 actionable items"));
  assert.ok(fit.date.left >= -1, `date starts on the page (${fit.date.left})`);
  assert.ok(fit.date.right <= fit.cw + 1, `date ends on the page (${fit.date.right} vs ${fit.cw})`);
  assert.ok(fit.longDate.left >= -1 && fit.longDate.right <= fit.cw + 1, `a date wider than the page wraps on it (${fit.longDate.left}..${fit.longDate.right} vs ${fit.cw})`);
  assert.ok(fit.longDate.height > 20, `the long date takes more than one line (${fit.longDate.height}px)`);
  assert.ok(fit.linkEnd <= fit.cw + 1, `contact link ends on the page (${fit.linkEnd} vs ${fit.cw})`);
  assert.ok(fit.sw <= fit.cw + 1, `preview page has no horizontal overflow (${fit.sw} vs ${fit.cw})`);
  assert.equal(fit.outerScroll, false);
  assert.equal(fit.label, `Live preview ${fit.pages} page${fit.pages > 1 ? "s" : ""} (estimate)`);
  assert.deepEqual(errors, []);
});
