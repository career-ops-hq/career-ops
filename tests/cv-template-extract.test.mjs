import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function markup(html) {
  const close = html.lastIndexOf("</style>");
  return close === -1 ? html : html.slice(close);
}

test("Compact and Executive section titles precede their bodies", () => {
  const compact = readFileSync(path.join(ROOT, "templates/cv-template.compact.html"), "utf8");
  const executive = readFileSync(path.join(ROOT, "templates/cv-template.executive.html"), "utf8");

  for (const [name, html] of [["compact", compact], ["executive", executive]]) {
    assert.doesNotMatch(html, /font-variant\s*:\s*small-caps/i, `${name} declares small-caps`);
    assert.doesNotMatch(html, /column-count\s*:/i, `${name} lays text out in columns`);
  }

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
