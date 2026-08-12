import test from "node:test";
import assert from "node:assert/strict";
import {
  NAVIGATION_SECTIONS,
  flattenNavigation,
  searchNavigation,
} from "../../src/lib/navigation-model.mjs";

const EXPECTED_ROUTES = [
  "/",
  "/explore",
  "/jobs/intelligence",
  "/watch",
  "/pipeline",
  "/followups",
  "/apply",
  "/application-studio",
  "/email-hub",
  "/portals",
  "/analytics",
  "/cv",
  "/cv/tailor",
  "/jobs",
  "/config",
  "/guide",
];

test("navigation exposes every primary product area exactly once", () => {
  const items = flattenNavigation();
  assert.deepEqual(items.map((item) => item.href), EXPECTED_ROUTES);
  assert.equal(new Set(items.map((item) => item.href)).size, items.length);
});

test("every destination has Swedish guidance and searchable keywords", () => {
  for (const section of NAVIGATION_SECTIONS) {
    assert.ok(section.label.length >= 3);
    for (const item of section.items) {
      assert.ok(item.label.length >= 2, `${item.href} lacks label`);
      assert.ok(item.description.length >= 18, `${item.href} lacks useful description`);
      assert.ok(item.keywords.length >= 2, `${item.href} lacks keywords`);
    }
  }
});

test("smart search matches labels, descriptions and synonyms", () => {
  assert.equal(searchNavigation("cv")[0].href, "/cv");
  assert.equal(searchNavigation("bevakning")[0].href, "/watch");
  assert.equal(searchNavigation("distansjobb")[0].href, "/watch");
  assert.equal(searchNavigation("ansökan")[0].href, "/apply");
  assert.equal(searchNavigation("statistik")[0].href, "/analytics");
  assert.equal(searchNavigation("automatisering")[0].href, "/jobs");
  assert.equal(searchNavigation("hjälp")[0].href, "/guide");
});

test("empty search returns the complete ordered menu", () => {
  assert.deepEqual(searchNavigation("").map((item) => item.href), EXPECTED_ROUTES);
});
