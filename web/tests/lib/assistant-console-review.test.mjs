import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/components/assistant-console.tsx", import.meta.url), "utf8");

test("conversation rename distinguishes write and refresh failures", () => {
  assert.match(source, /throw new ChatHistoryRefreshError/);
  assert.match(source, /if \(!\(error instanceof ChatHistoryRefreshError\)\)/);
});

test("conversation title Enter ignores IME confirmation and blur commits outside editor", () => {
  assert.match(source, /if \(e\.nativeEvent\.isComposing \|\| e\.keyCode === 229\) return;\s+if \(e\.key === "Enter"\)/);
  assert.match(source, /!e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)/);
  assert.match(source, /titleEditorActive\.current = false/);
});

test("conversation history combobox exposes and navigates its listbox", () => {
  assert.match(source, /aria-controls=\{historyOpen \? historyListId : undefined\}/);
  assert.match(source, /id=\{historyListId\}/);
  assert.match(source, /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/);
  assert.match(source, /querySelectorAll<HTMLElement>\('\[role="option"\]'\)/);
});
