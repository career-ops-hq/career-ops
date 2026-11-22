// testBrowserChannel(): unset keeps Google Chrome (what CI runs), "bundled"
// switches the suites to Playwright's bundled Chromium, and every suite that
// launches a browser goes through it instead of hardcoding the channel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testBrowserChannel, TEST_BROWSER_CHANNEL_ENV } from "../helpers/browser-channel.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));

test("unset or empty keeps Google Chrome, so CI does not change", () => {
  assert.equal(testBrowserChannel({}), "chrome");
  assert.equal(testBrowserChannel({ [TEST_BROWSER_CHANNEL_ENV]: "" }), "chrome");
  assert.equal(testBrowserChannel({ [TEST_BROWSER_CHANNEL_ENV]: "  " }), "chrome");
});

test('"bundled" leaves the channel out, so Playwright launches its own Chromium', () => {
  assert.equal(testBrowserChannel({ [TEST_BROWSER_CHANNEL_ENV]: "bundled" }), undefined);
  assert.equal(testBrowserChannel({ [TEST_BROWSER_CHANNEL_ENV]: " bundled " }), undefined);
});

test("any other value is passed through as the channel", () => {
  assert.equal(testBrowserChannel({ [TEST_BROWSER_CHANNEL_ENV]: "msedge" }), "msedge");
});

test("no suite hardcodes the Chrome channel", () => {
  const hardcoded = fs
    .readdirSync(LIB)
    .filter((name) => name.endsWith(".test.mjs"))
    .filter((name) => /channel:\s*["']chrome["']/.test(fs.readFileSync(path.join(LIB, name), "utf8")));
  assert.deepEqual(hardcoded, [], "launch with channel: testBrowserChannel() from tests/helpers/browser-channel.mjs");
});
