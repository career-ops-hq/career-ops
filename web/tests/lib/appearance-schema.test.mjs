// Run:  node --test tests/lib/appearance-schema.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAppearance } from "../../src/lib/appearance-schema.mjs";

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
