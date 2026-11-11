import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const label = /Appearance|THEME/;

test("the sidebar and the mobile drawer show the theme toggle without the extra labels", async () => {
  const sidebar = await readFile(new URL("../../src/components/app-shell.tsx", import.meta.url), "utf8");
  const drawer = await readFile(new URL("../../src/components/mobile-nav.tsx", import.meta.url), "utf8");
  for (const source of [sidebar, drawer]) {
    assert.equal(label.test(source), false);
    assert.match(source, /<ThemeToggle showLabel/);
  }
});
