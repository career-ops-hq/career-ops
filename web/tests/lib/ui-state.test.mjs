// Run:  node --test tests/lib/ui-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAppearance, normalizeProgress, readJsonFile, writeJsonAtomic } from "../../src/lib/ui-state.mjs";

test("normalizeAppearance clamps sizes and rejects unknown widths", () => {
  const a = normalizeAppearance({ uiSize: 9999, previewSize: "big", width: "huge" });
  assert.deepEqual(a, { fonts: {}, uiSize: 140, previewSize: 100, width: "small" });
  assert.equal(normalizeAppearance(null).width, "small");
  assert.equal(normalizeAppearance([1]).uiSize, 100);
});

test("normalizeAppearance keeps valid system fonts and drops CSS-injection attempts", () => {
  const a = normalizeAppearance({
    fonts: {
      ui: { kind: "system", family: "Segoe UI" },
      code: { kind: "system", family: 'x"}; body{display:none} /*' },
      heading: { kind: "system", family: "A" + String.fromCharCode(92) + "B" },
      nope: { kind: "system", family: "Arial" },
    },
  });
  assert.deepEqual(a.fonts, { ui: { kind: "system", family: "Segoe UI" } });
});

test("normalizeAppearance accepts base64 font data URLs only, and forces the family name", () => {
  const ok = "data:font/ttf;base64,AAEAAAAKAIAAAwAgT1MvMg==";
  const a = normalizeAppearance({
    fonts: {
      ui: { kind: "upload", family: "Evil", data: ok },
      code: { kind: "upload", family: "x", data: "url(javascript:alert(1))" },
      preview: { kind: "upload", family: "x", data: "data:font/ttf;base64,AA);}body{x:y" },
    },
  });
  assert.deepEqual(a.fonts, { ui: { kind: "upload", family: "UserFont-ui", data: ok } });
});

test("normalizeProgress keeps well-formed ticks and tasks only", () => {
  const p = normalizeProgress({
    ticks: { "a::b": true, c: "yes" },
    tasks: { acme: [{ id: "1", text: "t", done: 1 }, { id: 2, text: "bad" }], bad: "x" },
  });
  assert.deepEqual(p, { ticks: { "a::b": true }, tasks: { acme: [{ id: "1", text: "t", done: false }] } });
  assert.deepEqual(normalizeProgress(undefined), { ticks: {}, tasks: {} });
});

test("readJsonFile: missing file -> fallback; broken file throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-state-"));
  try {
    const f = path.join(dir, "x.json");
    assert.deepEqual(readJsonFile(f, { d: 1 }), { d: 1 });
    fs.writeFileSync(f, "{ broken");
    assert.throws(() => readJsonFile(f, null), SyntaxError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJsonAtomic creates parent dirs and leaves no temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-state-"));
  try {
    const f = path.join(dir, "sub", "x.json");
    writeJsonAtomic(f, { a: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { a: 1 });
    assert.deepEqual(fs.readdirSync(path.join(dir, "sub")), ["x.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
