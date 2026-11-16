import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerStaysDismissed, setupBannerDismissKey } from "../../src/lib/home/setup-banner.mjs";

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
