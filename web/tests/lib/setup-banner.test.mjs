import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerStaysDismissed, setupBannerDismissKey, setupPaths } from "../../src/lib/home/setup-banner.mjs";

test("the same missing files stay dismissed", () => {
  const key = setupBannerDismissKey(["portals.yml", "modes/_profile.md"]);
  assert.equal(bannerStaysDismissed(key, ["modes/_profile.md", "portals.yml"]), true);
});

test("a new missing file shows the banner again", () => {
  const key = setupBannerDismissKey(["modes/_profile.md"]);
  assert.equal(bannerStaysDismissed(key, ["modes/_profile.md", "cv.md"]), false);
});

test("nothing stored is not a dismiss", () => {
  assert.equal(bannerStaysDismissed(null, ["cv.md"]), false);
  assert.equal(bannerStaysDismissed("", ["cv.md"]), false);
});

test("setup paths include empty YAML once and exclude Markdown warnings", () => {
  const portals = { path: "portals.yml", reason: "has no settings (empty or only comments)" };
  const markdown = { path: "modes/_profile.md", reason: "is empty" };
  assert.deepEqual(setupPaths({ missing: ["cv.md"], unpersonalized: [markdown, portals, portals] }),
    ["cv.md", "portals.yml"]);
  assert.deepEqual(setupPaths({ missing: ["portals.yml"], unpersonalized: [portals] }), ["portals.yml"]);
});
