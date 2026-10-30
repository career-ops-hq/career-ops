// The CV Studio edits a tailored CV's HTML in place: these tests drive the
// parser, the edit model, and the renderer the way the page and the API do.

import test from "node:test";
import assert from "node:assert/strict";
import { parseBlocks, renderBlocks, htmlText } from "../../src/lib/cv-studio/html-blocks.mjs";
import { parseBaseCv } from "../../src/lib/cv-studio/base-cv.mjs";
import * as cvMarkdown from "../../../lib/cv-markdown.mjs";
import {
  alignBullets,
  buildStudioDoc,
  emptyEdits,
  parseEdits,
  resolveStudio,
  studioReducer,
  wordDiff,
} from "../../src/lib/cv-studio/studio.mjs";

const HTML = `<html><head><style>.page{}</style></head><body><div class="page">
  <div class="header"><h1>Jordan Rivera</h1></div>
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">Applied AI engineer shipping MLOps systems.</div>
  </div>
  <div class="section">
    <div class="section-title">Core Competencies</div>
    <div class="competencies-grid">
      <span class="competency-tag">MLOps</span>
      <span class="competency-tag">Kubernetes</span>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
  <div class="job-header"><span class="job-company">TechFin Corp</span><span class="job-period">2020-2024</span></div>
  <ul>
    <li>Led MLOps platform team (3 engineers): model registry, feature store</li>
    <li>Designed fraud pipeline on Kafka &amp; Flink</li>
    <li>Mentored new engineers in Python</li>
  </ul>
</div>
    <div class="job">
  <div class="job-header"><span class="job-company">DataStartup Inc</span><span class="job-period">2018-2020</span></div>
  <ul>
    <li>Built NLP pipeline</li>
  </ul>
</div>
  </div>
</div></body></html>`;

const CV_MD = `# Jordan Rivera

## Professional Summary

Full-stack AI engineer building production ML systems.

## Work Experience

### TechFin Corp -- Austin, TX

- Led ML platform team (3 engineers), built model registry and feature store
- Designed fraud pipeline on Kafka & Flink
- Ran the on-call rotation for the model serving stack

### DataStartup Inc -- Remote

- Built NLP pipeline
`;

const KEYWORDS = ["MLOps", "Kubernetes", "Python", "Kafka", "on-call"];
const keywordsIn = (text) => KEYWORDS.filter((k) => text.toLowerCase().includes(k.toLowerCase()));

function studio() {
  const tree = parseBlocks(HTML);
  const base = parseBaseCv(CV_MD, cvMarkdown);
  const items = new Map(tree.sections.flatMap((s) => s.items.map((i) => [i.id, i])));
  const itemText = (id) => (items.get(id).kind === "tag" ? items.get(id).label : "");
  const doc = buildStudioDoc({ tree, base, keywords: KEYWORDS, sourceHash: "h1", keywordsIn, itemText, fixedText: "Jordan Rivera" });
  return { tree, doc };
}

const visibleBullets = (html) => parseBlocks(html).sections.flatMap((s) => s.items.flatMap((i) => i.bullets.map((b) => b.text)));

test("parseBlocks reads sections, entries, and bullets with stable ids", () => {
  const { sections } = parseBlocks(HTML);
  assert.deepEqual(
    sections.map((s) => [s.id, s.kind, s.items.map((i) => `${i.id}:${i.label}:${i.bullets.length}`)]),
    [
      ["s0", "summary", ["s0i0:Professional Summary:1"]],
      ["s1", "competencies", ["s1i0:MLOps:0", "s1i1:Kubernetes:0"]],
      ["s2", "experience", ["s2i0:TechFin Corp:3", "s2i1:DataStartup Inc:1"]],
    ],
  );
  assert.equal(sections[2].items[0].bullets[1].text, "Designed fraud pipeline on Kafka & Flink");
});

test("rendering with no edits returns the tailored HTML byte for byte", () => {
  const tree = parseBlocks(HTML);
  assert.equal(renderBlocks(tree, { hidden: new Set(), order: {}, text: {} }), HTML);
});

test("parseBaseCv reads the summary and each entry's bullets from cv.md", () => {
  assert.deepEqual(parseBaseCv(CV_MD, cvMarkdown), {
    summary: "Full-stack AI engineer building production ML systems.",
    entries: [
      { company: "TechFin Corp", bullets: ["Led ML platform team (3 engineers), built model registry and feature store", "Designed fraud pipeline on Kafka & Flink", "Ran the on-call rotation for the model serving stack"] },
      { company: "DataStartup Inc", bullets: ["Built NLP pipeline"] },
    ],
  });
});

test("alignBullets pairs rewrites with their originals and leaves the rest unused", () => {
  const result = alignBullets(["Designed fraud pipeline on Kafka", "Something entirely new"], ["Built NLP pipeline", "Designed fraud pipeline on Kafka & Flink"]);
  assert.deepEqual(result.pairs, [1, null]);
  assert.deepEqual(result.unused, [0]);
});

test("each bullet knows its original, its change, and the keywords that drove it", () => {
  const { doc } = studio();
  const techfin = doc.sections[2].items[0];
  assert.deepEqual(
    techfin.bullets.map((b) => [b.change, b.base, b.drivenBy]),
    [
      ["edited", "Led ML platform team (3 engineers), built model registry and feature store", ["MLOps"]],
      ["same", "Designed fraud pipeline on Kafka & Flink", []],
      ["new", null, ["Python"]],
    ],
  );
  assert.deepEqual(techfin.restorable, [{ text: "Ran the on-call rotation for the model serving stack", keywords: ["on-call"] }]);
  assert.equal(doc.sections[0].items[0].bullets[0].base, "Full-stack AI engineer building production ML systems.");
});

test("using the original wording, hiding, and restoring change the render and the coverage", () => {
  const { tree, doc } = studio();
  let edits = emptyEdits("h1");
  assert.deepEqual(resolveStudio(doc, edits).coverage, { present: ["MLOps", "Kubernetes", "Python", "Kafka"], missing: ["on-call"], pct: 80 });

  edits = studioReducer(edits, { type: "use", id: "s2i0b0", use: { kind: "base" } }, doc);
  edits = studioReducer(edits, { type: "toggle", id: "s2i0b2" }, doc);
  edits = studioReducer(edits, { type: "restore", item: "s2i0", index: 0 }, doc);
  edits = studioReducer(edits, { type: "toggle", id: "s1i1" }, doc);
  const { view, added, coverage } = resolveStudio(doc, edits);
  const html = renderBlocks(tree, view, { added });

  assert.deepEqual(visibleBullets(html), [
    "Applied AI engineer shipping MLOps systems.",
    "Led ML platform team (3 engineers), built model registry and feature store",
    "Designed fraud pipeline on Kafka & Flink",
    "Ran the on-call rotation for the model serving stack",
    "Built NLP pipeline",
  ]);
  assert.equal(htmlText(html).includes("Kubernetes"), false);
  assert.deepEqual(coverage, { present: ["MLOps", "Kafka", "on-call"], missing: ["Kubernetes", "Python"], pct: 60 });
});

test("moving a bullet reorders it in the render", () => {
  const { tree, doc } = studio();
  const siblings = ["s2i0b0", "s2i0b1", "s2i0b2"];
  const edits = studioReducer(emptyEdits("h1"), { type: "move", parent: "s2i0", id: "s2i0b2", by: -1, siblings }, doc);
  assert.deepEqual(edits.order, { s2i0: ["s2i0b0", "s2i0b2", "s2i0b1"] });
  const { view, added } = resolveStudio(doc, edits);
  assert.deepEqual(visibleBullets(renderBlocks(tree, view, { added })).slice(1, 4), [
    "Led MLOps platform team (3 engineers): model registry, feature store",
    "Mentored new engineers in Python",
    "Designed fraud pipeline on Kafka & Flink",
  ]);
});

test("the one-page preset hides trailing bullets until the user shows one again", () => {
  const { doc } = studio();
  const onePage = studioReducer(emptyEdits("h1"), { type: "preset", preset: { length: "one-page" } }, doc);
  assert.deepEqual([...resolveStudio(doc, onePage).view.hidden], []);
  const big = { ...doc, sections: doc.sections.map((s) => (s.kind === "experience" ? { ...s, items: s.items.map((i, k) => (k === 1 ? { ...i, bullets: [...i.bullets, { ...i.bullets[0], id: "x1" }, { ...i.bullets[0], id: "x2" }] } : i)) } : s)) };
  assert.deepEqual([...resolveStudio(big, onePage).view.hidden], ["x2"]);
  const shown = studioReducer(onePage, { type: "toggle", id: "x2" }, big);
  assert.deepEqual([...resolveStudio(big, shown).view.hidden], []);
  const full = studioReducer(onePage, { type: "preset", preset: { length: "full" } }, big);
  assert.deepEqual([...resolveStudio(big, full).view.hidden], []);
});

test("the conservative tone keeps originals only where the tailor rewrote heavily", () => {
  const { doc } = studio();
  const edits = studioReducer(emptyEdits("h1"), { type: "preset", preset: { tone: "conservative" } }, doc);
  assert.deepEqual(resolveStudio(doc, edits).view.text, {
    s0i0b0: "Full-stack AI engineer building production ML systems.",
  });
  assert.equal(doc.sections[2].items[0].bullets[0].change, "edited", "a light rewrite keeps its tailored wording");
});

test("edits saved against another version of the CV are dropped, not misapplied", () => {
  const saved = { ...emptyEdits("old"), hidden: ["s2i0b0"] };
  assert.deepEqual(parseEdits(saved, "new"), { edits: emptyEdits("new"), stale: true });
  assert.deepEqual(parseEdits(saved, "old").edits.hidden, ["s2i0b0"]);
  assert.deepEqual(parseEdits({ v: 1, sourceHash: "old", use: { a: { kind: "custom" }, b: { kind: "base" } } }, "old").edits.use, { b: { kind: "base" } });
});

test("wordDiff marks removed and inserted words", () => {
  assert.deepEqual(wordDiff("Led ML platform team", "Led MLOps platform team"), [
    { op: "same", text: "Led " },
    { op: "del", text: "ML" },
    { op: "ins", text: "MLOps" },
    { op: "same", text: " platform team" },
  ]);
});

test("htmlText collapses nested tag shapes so no live tag remains", () => {
  assert.equal(htmlText("<scr<script>ipt>alert(1)</script>"), "alert(1)");
  assert.equal(htmlText("<style>a{}</style>body"), "a{}body");
  assert.equal(htmlText("<style>a{}</style>body").includes("<"), false);
});

test("parseEdits fills missing custom.keywords so shown.keywords.forEach cannot throw", () => {
  const raw = { v: 1, sourceHash: "h1", use: { s0i0b0: { kind: "custom", text: "rewrote" } } };
  const { edits } = parseEdits(raw, "h1");
  assert.deepEqual(edits.use.s0i0b0, { kind: "custom", text: "rewrote", keywords: [] });
});

test("parseEdits returns null for a body that is not a v1 edits object", () => {
  assert.equal(parseEdits({}, "h1"), null);
  assert.equal(parseEdits(undefined, "h1"), null);
  assert.equal(parseEdits({ v: 1, hidden: ["s2i0b0"] }, "h1"), null);
  assert.deepEqual(parseEdits({ v: 1, sourceHash: "h1" }, "h1"), { edits: emptyEdits("h1"), stale: false });
});

test("a summary section whose summary-text is not a div parses with no items", () => {
  const html = HTML.replace('<div class="summary-text">Applied AI engineer shipping MLOps systems.</div>', '<p class="summary-text">Applied AI engineer shipping MLOps systems.</p>');
  const summary = parseBlocks(html).sections[0];
  assert.equal(summary.title, "Professional Summary");
  assert.equal(summary.kind, "summary");
  assert.deepEqual(summary.items, []);
});

test("hiding a whole section drops it from the render and from the coverage", () => {
  const { tree, doc } = studio();
  const edits = studioReducer(emptyEdits("h1"), { type: "toggle", id: "s1" }, doc);
  const { view, added, coverage } = resolveStudio(doc, edits);
  const text = htmlText(renderBlocks(tree, view, { added }));
  assert.equal(text.includes("Core Competencies"), false);
  assert.equal(text.includes("Kubernetes"), false);
  assert.deepEqual(coverage.missing, ["Kubernetes", "on-call"]);
});

test("an entry the tailor left without bullets offers no base bullets to restore", () => {
  const html = HTML.replace(/<ul>\s*<li>Built NLP pipeline<\/li>\s*<\/ul>/, "");
  const tree = parseBlocks(html);
  const base = parseBaseCv(CV_MD, cvMarkdown);
  const doc = buildStudioDoc({ tree, base, keywords: KEYWORDS, sourceHash: "h1", keywordsIn, itemText: () => "", fixedText: "" });
  const entry = doc.sections[2].items[1];
  assert.equal(entry.label.includes("DataStartup"), true);
  assert.deepEqual(entry.bullets, []);
  assert.deepEqual(entry.restorable, []);
});

test("wordDiff keeps a trailing comma apart from its word", () => {
  assert.deepEqual(wordDiff("Built the feature store", "Built the feature store, model monitoring"), [
    { op: "same", text: "Built the feature store" },
    { op: "ins", text: ", model monitoring" },
  ]);
});

test("wordDiff folds a short unchanged run only when it sits between a deletion and an insertion", () => {
  assert.deepEqual(wordDiff("built internal MLOps tooling: model registry", "as technical lead, mentoring the model registry"), [
    { op: "del", text: "built internal MLOps tooling:" },
    { op: "ins", text: "as technical lead, mentoring" },
    { op: "same", text: " " },
    { op: "ins", text: "the " },
    { op: "same", text: "model registry" },
  ]);
});

test("wordDiff keeps a short unchanged run between two insertions out of both change runs", () => {
  assert.deepEqual(wordDiff("alpha gamma", "alpha beta, gamma delta"), [
    { op: "same", text: "alpha " },
    { op: "ins", text: "beta, " },
    { op: "same", text: "gamma" },
    { op: "ins", text: " delta" },
  ]);
});
