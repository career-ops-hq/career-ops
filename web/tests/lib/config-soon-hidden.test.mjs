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
