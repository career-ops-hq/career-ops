import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const GLOBALS = path.join(SRC, "app/globals.css");

const RAW_BRAND_FILL_AS_TEXT = /(?<![\w-])text-brand(?![\w-])/;
const RAW_BRAND_TEXT_CSS = /(?<![\w-])color:\s*var\(--color-brand\)/;

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.(tsx?|jsx?|mjs|css)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

async function rawBrandTextUses() {
  const hits = [];
  for (const file of await sourceFiles(SRC)) {
    const pattern = file.endsWith(".css") ? RAW_BRAND_TEXT_CSS : RAW_BRAND_FILL_AS_TEXT;
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

function rootTokens(css) {
  const block = css.match(/:root\s*\{([^}]*)\}/)?.[1];
  assert.ok(block, "globals.css must define a :root block");
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

function toRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hsl = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  assert.ok(hsl, `unparseable color: ${value}`);
  const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(value) {
  const [r, g, b] = toRgb(value).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast math matches known WCAG ratios", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
});

test("the light brand-text token reaches AA (4.5:1) on every light surface", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  for (const surface of ["bg", "surface", "surface-hover"]) {
    const ratio = contrast(tokens["brand-text"], tokens[surface]);
    assert.ok(ratio >= 4.5, `--brand-text on --${surface} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test("an arrow function before className still counts as faded brand text", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  const source = `<Button onClick={() => save()} className="text-brand-text/60">Save</Button>`;
  const misses = fadedBrandMisses(source, tokens, "fixture.tsx");
  assert.ok(misses.some((line) => line.includes("<Button>") && line.includes("text-brand-text/60")), misses.join("\n") || "the arrow tag was skipped");
});

test("no component colors text with the raw brand fill", async () => {
  const hits = await rawBrandTextUses();
  assert.deepEqual(
    hits,
    [],
    `${hits.length} text uses of the raw brand orange (about 3:1 on light surfaces); use text-brand-text / var(--color-brand-text):\n${hits.join("\n")}`,
  );
});

// text-brand-text/80 blends the token into the surface behind it. On --bg that
// is about 3.5:1. Icons (capitalized JSX tags such as <Sparkles>) are not text,
// but a few capitalized components render their children as text, so they are
// checked like a lowercase tag.
const TEXT_COMPONENTS = ["Link", "Button"];
const FADED_BRAND_TEXT = new RegExp(
  String.raw`<((?:[a-z][\w.]*|${TEXT_COMPONENTS.join("|")})(?![\w.]))(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?(?<![\w-])text-brand-text\/(\d+)`,
  "g",
);

function blend(fg, bg, alpha) {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  const hex = f.map((c, i) => Math.round((alpha * c + (1 - alpha) * b[i]) * 255).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

// Match the whole file, not line by line, so a tag whose className sits on a
// later line than "<span" is still checked.
function fadedBrandMisses(source, tokens, label) {
  const misses = [];
  for (const m of source.matchAll(FADED_BRAND_TEXT)) {
    const [, tag, pct] = m;
    const line = source.slice(0, m.index).split("\n").length;
    for (const surface of ["bg", "surface", "surface-hover"]) {
      const ratio = contrast(blend(tokens["brand-text"], tokens[surface], Number(pct) / 100), tokens[surface]);
      if (ratio < 4.5) misses.push(`${label}:${line}: <${tag}> text-brand-text/${pct} on --${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
  return misses;
}

test("the faded brand text check reads tags that span lines", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  const sample = '<div>\n  <span\n    className="text-brand-text/60"\n  >x</span>\n  <Sparkles\n    className="text-brand-text/60" />\n</div>';
  const misses = fadedBrandMisses(sample, tokens, "sample.tsx");
  assert.ok(misses.length > 0, "multi-line <span> was missed");
  assert.ok(misses.every((m) => m.startsWith("sample.tsx:2: <span>")), misses.join("\n"));
});

test("the faded brand text check reads a Link but not a LinkIcon", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  const sample = '<Link href="/r" className="text-brand-text/60">Report</Link>\n<LinkIcon className="text-brand-text/60" />';
  const misses = fadedBrandMisses(sample, tokens, "sample.tsx");
  assert.ok(misses.length > 0, "<Link> text was missed");
  assert.ok(misses.every((m) => m.startsWith("sample.tsx:1: <Link>")), misses.join("\n"));
});

test("faded brand text on a text element still reaches AA on every light surface", async () => {
  const tokens = rootTokens(await readFile(GLOBALS, "utf8"));
  const misses = [];
  for (const file of await sourceFiles(SRC)) {
    if (file.endsWith(".css")) continue;
    misses.push(...fadedBrandMisses(await readFile(file, "utf8"), tokens, path.relative(SRC, file)));
  }
  assert.deepEqual(misses, [], misses.join("\n"));
});
