// Compact and Executive must extract as readable text.
//
// Compact used a flex row, so a text extractor glued the side label onto the
// section body. Executive tracked headings, so "SENIOR" extracted as
// "S E N I O R". Matchable strings keep letter-spacing at zero and Compact
// sections stack title then body.
//
// A local Chromium render is extra evidence. The CSS and DOM checks always run.
// Missing Chromium does not fail the suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATCHABLE = [".header h1", ".header-title", ".section-title", ".job-company", ".job-role"];

function cssRules(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const clean = style.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

function selectorHits(selector, wanted) {
  return selector.split(",").some((part) => part.trim() === wanted);
}

function letterSpacing(body) {
  const found = body.match(/letter-spacing\s*:\s*([^;]+)/i);
  return found ? found[1].trim() : null;
}

function isPositiveTracking(value) {
  if (value == null) return false;
  const normalized = value.toLowerCase();
  if (normalized === "normal" || normalized === "0" || normalized === "0em" || normalized === "0px") return false;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0;
}

function markup(html) {
  const close = html.lastIndexOf("</style>");
  return close === -1 ? html : html.slice(close);
}

function assertReadable(name, html) {
  const rules = cssRules(html);
  for (const wanted of MATCHABLE) {
    for (const rule of rules) {
      if (!selectorHits(rule.selector, wanted)) continue;
      const spacing = letterSpacing(rule.body);
      assert.equal(
        isPositiveTracking(spacing),
        false,
        `${name} ${wanted} letter-spacing ${spacing} splits glyphs in extracted text`,
      );
      assert.doesNotMatch(rule.body, /font-variant\s*:\s*small-caps/i, `${name} ${wanted} uses small-caps`);
    }
  }
  assert.doesNotMatch(html, /font-variant\s*:\s*small-caps/i, `${name} declares small-caps`);
}

test("Compact and Executive keep matchable strings in reading order", () => {
  const compact = readFileSync(path.join(ROOT, "templates/cv-template.compact.html"), "utf8");
  const executive = readFileSync(path.join(ROOT, "templates/cv-template.executive.html"), "utf8");

  assertReadable("compact", compact);
  assertReadable("executive", executive);

  const section = cssRules(compact).find((rule) => selectorHits(rule.selector, ".section"));
  assert.ok(section, "compact has a .section rule");
  assert.match(section.body, /display\s*:\s*block/i);
  assert.doesNotMatch(section.body, /display\s*:\s*flex/i);
  assert.doesNotMatch(section.body, /column-count/i);

  for (const [file, title, body] of [
    [compact, "{{SECTION_SUMMARY}}", "summary-text"],
    [compact, "{{SECTION_EXPERIENCE}}", "experience-body"],
    [compact, "{{SECTION_SKILLS}}", "skills-body"],
    [executive, "{{SECTION_SUMMARY}}", "{{SUMMARY_TEXT}}"],
    [executive, "{{SECTION_EXPERIENCE}}", "{{EXPERIENCE}}"],
    [executive, "{{SECTION_SKILLS}}", "{{SKILLS}}"],
  ]) {
    const html = markup(file);
    const titleAt = html.indexOf(title);
    const bodyAt = html.indexOf(body);
    assert.ok(titleAt !== -1 && bodyAt !== -1 && titleAt < bodyAt, `${title} precedes ${body}`);
  }
});
