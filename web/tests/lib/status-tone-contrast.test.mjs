import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(WEB, "src");
const GLOBALS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

function loadTheme() {
  try {
    return readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");
  } catch (err) {
    if (err?.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

const THEME = loadTheme();
const needsTheme = THEME ? false : "tailwindcss is not installed";

const FAMILIES = ["emerald", "amber", "red"];
const UNPREFIXED_TONE_TEXT_CLASS = /(?<![\w:/-])text-(emerald|amber|red)-(\d{3})(?:\/(\d+))?(?![\w-])/g;

function oklchToSrgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  });
}

function tone(family, shade) {
  const m = THEME.match(new RegExp(`--color-${family}-${shade}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
  assert.ok(m, `tailwind theme has no ${family}-${shade}`);
  return oklchToSrgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}

function themeColor(selector, name) {
  const block = GLOBALS.match(new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m"));
  const m = block?.[1].match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, "i"));
  assert.ok(m, `globals.css declares a hex --${name} under ${selector}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}

const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function sourceUses() {
  const uses = [];
  for (const file of listTree(SRC, { match: /\.(tsx?|jsx?|mjs)$/ })) {
    readFileSync(file, "utf8").split("\n").forEach((text, i) => {
      for (const [cls, family, shade, pct] of text.matchAll(UNPREFIXED_TONE_TEXT_CLASS)) {
        if (Number(shade) < 600) continue;
        uses.push({
          where: `${relative(WEB, file)}:${i + 1}`,
          cls,
          family,
          shade,
          alpha: pct ? Number(pct) / 100 : 1,
          darkPartner: text.includes(`dark:text-${family}-`),
        });
      }
    });
  }
  return uses;
}

test("the source scan finds the status tone classes it is meant to check", () => {
  const families = new Set(sourceUses().map((u) => u.family));
  assert.deepEqual([...families].sort(), [...FAMILIES].sort());
});

test("light-mode status text reaches 4.5:1 on the page and on its own tinted chip", { skip: needsTheme }, () => {
  const bg = themeColor(":root", "bg");
  const failures = [];
  for (const u of sourceUses()) {
    const tint = tone(u.family, 500);
    const surfaces = { page: bg, "tint/15": over(tint, 0.15, bg), "tint/10": over(tint, 0.1, bg) };
    for (const [name, surface] of Object.entries(surfaces)) {
      const ratio = contrast(over(tone(u.family, u.shade), u.alpha, surface), surface);
      if (ratio < 4.5) failures.push(`${u.where} ${u.cls} on ${name}: ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("status text without a dark: partner stays readable on the dark page and surface", { skip: needsTheme }, () => {
  const surfaces = { page: themeColor(".dark", "bg"), surface: themeColor(".dark", "surface") };
  const failures = [];
  for (const u of sourceUses().filter((u) => !u.darkPartner)) {
    for (const [name, surface] of Object.entries(surfaces)) {
      const ratio = contrast(over(tone(u.family, u.shade), u.alpha, surface), surface);
      if (ratio < 4.5) failures.push(`${u.where} ${u.cls} on dark ${name}: ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});
