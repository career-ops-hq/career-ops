import test from "node:test";
import assert from "node:assert/strict";
import { previewHtml } from "../../src/lib/cv-studio/preview-html.mjs";

function shown(html) {
  return previewHtml(html).replace(/<style data-cv-preview-fit>[\s\S]*?<\/style>/, "");
}

test("live preview renders markdown bold, including quotes and a leading tilde", () => {
  const html = shown("<p>Shipped **\"Microsoft PowerApps\"** and cleared **~2,000 actionable items**.</p>");
  assert.equal(
    html,
    "<p>Shipped <strong>\"Microsoft PowerApps\"</strong> and cleared <strong>~2,000 actionable items</strong>.</p>",
  );
});

test("live preview renders markdown italic and leaves snake_case and paths alone", () => {
  const cases = [
    ["Lead developer on the puzzle game _Lantern Grove_.", "Lead developer on the puzzle game <em>Lantern Grove</em>."],
    ["Set max_retry_count in config", "Set max_retry_count in config"],
    ["See docs/_draft_/cv.md", "See docs/_draft_/cv.md"],
    ["**Bold** and _italic_", "<strong>Bold</strong> and <em>italic</em>"],
  ];
  for (const [input, want] of cases) {
    assert.equal(shown(`<p>${input}</p>`), `<p>${want}</p>`);
  }
});

test("live preview leaves markdown inside a style or script whose closing tag has a space", () => {
  const html = '<style>.x { content: "**note**"; }</style ><script>const a = "**keep**";</script\n>';
  const got = shown(html);
  assert.match(got, /content: "\*\*note\*\*"/);
  assert.match(got, /const a = "\*\*keep\*\*"/);
});

test("live preview does not rewrite markdown markers in styles, scripts, or attributes", () => {
  const html = '<style>.x { content: "**"; }</style><script>const a = "**";</script><a href="https://example.com/_x_/">**y**</a>';
  const got = shown(html);
  assert.match(got, /content: "\*\*"/);
  assert.match(got, /const a = "\*\*"/);
  assert.match(got, /href="https:\/\/example.com\/_x_\/"/);
  assert.match(got, /<strong>y<\/strong>/);
});
