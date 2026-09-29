// Integrity checks for the Turkish UI dictionary (src/lib/i18n/tr.mjs).
//
// A dictionary can go wrong silently: a dropped {placeholder} renders a sentence
// without its number, a renamed <tag> loses its link, a duplicate key quietly
// overrides an earlier entry, and a t("…") call with no entry falls back to
// English with nobody noticing. Each of those is asserted here.
//
// Run:  node --test tests/lib/i18n-tr.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isNestedCheckout } from "../../../lib/mjs-files.mjs";
import { tr } from "../../src/lib/i18n/tr.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(WEB, "src");
const DICT_FILE = join(SRC, "lib", "i18n", "tr.mjs");

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

test("every translation keeps exactly the placeholders of its key", () => {
  const bad = Object.entries(tr).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
  assert.deepEqual(bad, []);
});

test("every translation keeps exactly the rich-text tags of its key", () => {
  const bad = Object.entries(tr).filter(([k, v]) => tags(k).join() !== tags(v).join());
  assert.deepEqual(bad, []);
});

test("no translation is empty", () => {
  assert.deepEqual(Object.entries(tr).filter(([, v]) => !String(v).trim()), []);
});

test("the dictionary source declares no key twice", () => {
  const text = readFileSync(DICT_FILE, "utf8");
  const keys = [...text.matchAll(/^\s{2}("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*):/gm)].map((m) =>
    m[1].startsWith('"') ? JSON.parse(m[1]) : m[1],
  );
  const seen = new Set();
  const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepEqual(dupes, []);
});

// A nested checkout under src/ holds another tree's code (#3499, #3762).
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (isNestedCheckout(full)) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(tsx?|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// String-literal arguments of t("…"), t.n("…", "…"), t.ctx("ctx", "…") and the
// tRef.current variants. Dynamic keys (t(label)) are covered by the entries
// their source constants declare, not by this scan.
function literalKeys(code) {
  const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
  const keys = [];
  for (const m of code.matchAll(new RegExp(String.raw`\bt(?:Ref\.current)?\(\s*${lit}`, "g"))) keys.push(m[1]);
  for (const m of code.matchAll(new RegExp(String.raw`\bt(?:Ref\.current)?\.n\([^,]+,\s*${lit},\s*${lit}`, "g"))) keys.push(m[2]);
  for (const m of code.matchAll(new RegExp(String.raw`\bt(?:Ref\.current)?\.ctx\(\s*${lit},\s*${lit}`, "g"))) keys.push(`${m[1]}|${m[2]}`);
  return keys.map((raw) => JSON.parse(`"${raw}"`));
}

test("every literal t() key used in src has a Turkish entry", () => {
  const missing = [];
  for (const file of sourceFiles(SRC)) {
    if (file.includes(join("lib", "i18n"))) continue; // the core's own docs/examples
    const code = readFileSync(file, "utf8");
    for (const key of literalKeys(code)) {
      const resolvable = Object.prototype.hasOwnProperty.call(tr, key) || (key.includes("|") && tr[key.split("|")[1]]);
      if (!resolvable) missing.push(`${relative(WEB, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
