import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// Config offered two disabled cards, Paste an AI key and No setup needed,
// both labeled Coming soon. Nothing behind them runs. Hide them until it does.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/config-form.tsx"),
  "utf8",
);

test("Config does not offer Coming soon choices", () => {
  assert.doesNotMatch(src, /Coming soon/);
  assert.match(src, /Use an AI tool you have/);
});

test("Config offers exactly one engine card, and not the two that were removed", () => {
  // A card could come back without the "Coming soon" badge, so the badge alone
  // proves nothing: check the cards themselves. "Paste an AI key" survives as a
  // field label further down the file, so match it as a title attribute only.
  // The title may be written as a JSX string literal or as a string
  // expression (title={"No setup needed"}), so allow both.
  assert.doesNotMatch(src, /title\s*=\s*(?:\{\s*)?["'](?:Paste an AI key|No setup needed)["']/);
  assert.equal(src.match(/<ModeCard\b/g)?.length, 1, "Config must render exactly one <ModeCard>");
});
