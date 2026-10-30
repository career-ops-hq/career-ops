import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listEntrySync, previousMatchIndex, returnsToPrevious } from "../../src/lib/history-back.mjs";

const current = "http://localhost:3000/pipeline/60?tab=ALL&sort=tracker&dir=1";
const list = "http://localhost:3000/pipeline?tab=ALL&sort=tracker&dir=1";

test("a back link to the exact previous entry returns to it", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, list), true);
});

test("query parameter order does not matter", () => {
  assert.equal(returnsToPrevious("/pipeline?dir=1&sort=tracker&tab=ALL", current, list), true);
});

test("a different parameter value is a new navigation", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=company&dir=1", current, list), false);
});

test("a parameter the previous entry lacks is a new navigation", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1&q=Fixture", current, list), false);
});

test("a different pathname is a new navigation", () => {
  assert.equal(returnsToPrevious("/explore?tab=ALL&sort=tracker&dir=1", current, list), false);
});

test("with no previous entry the link navigates normally", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, undefined), false);
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, null), false);
});

test("a previous entry on another origin is never returned to", () => {
  assert.equal(returnsToPrevious("/pipeline?tab=ALL&sort=tracker&dir=1", current, "https://elsewhere.example/pipeline?tab=ALL&sort=tracker&dir=1"), false);
});

test("a checklist returns to the pipeline entry behind the report", () => {
  const entries = [
    { url: "http://localhost:3000/pipeline?tab=ALL&q=Fixture" },
    { url: "http://localhost:3000/pipeline/12?tab=ALL&q=Fixture" },
    { url: "http://localhost:3000/pipeline/12/apply?tab=ALL&q=Fixture" },
  ];
  const href = "/pipeline?tab=ALL&q=Fixture";
  assert.equal(previousMatchIndex(href, entries[2].url, 2, entries), 0);
  assert.equal(previousMatchIndex(href, entries[1].url, 1, entries), 0);
  const apply = readFileSync(new URL("../../src/app/pipeline/[id]/apply/page.tsx", import.meta.url), "utf8");
  assert.match(apply, /const query = pipelineQuery\(await searchParams\)/);
  const suffixAt = apply.indexOf("const suffix = query ? `?${query}` : \"\"");
  assert.ok(suffixAt > 0, "checklist links share one pipelineQuery suffix");
  const links = apply.slice(suffixAt);
  assert.match(links, /backHref=\{`\/pipeline\$\{suffix\}`\}/);
  assert.match(links, /reportHref=\{`\/pipeline\/\$\{encodeURIComponent\(id\)\}\$\{suffix\}`\}/);
});

test("the closest matching list entry wins over an older one", () => {
  const entries = [
    { url: "http://localhost:3000/pipeline?tab=ALL" },
    { url: "http://localhost:3000/pipeline?tab=APPLIED" },
    { url: "http://localhost:3000/pipeline/4?tab=APPLIED" },
  ];
  assert.equal(previousMatchIndex("/pipeline?tab=APPLIED", entries[2].url, 2, entries), 1);
});

test("a forward entry and a missing match stay normal navigations", () => {
  const entries = [
    { url: "http://localhost:3000/pipeline?tab=ALL" },
    { url: "http://localhost:3000/pipeline/4?tab=ALL" },
    { url: "http://localhost:3000/pipeline?tab=ALL" },
  ];
  assert.equal(previousMatchIndex("/pipeline?tab=ALL", entries[1].url, 1, entries), 0);
  assert.equal(previousMatchIndex("/pipeline?tab=OTHER", entries[1].url, 1, entries), -1);
  assert.equal(previousMatchIndex("/pipeline?tab=ALL", entries[0].url, 0, entries), -1);
});

test("a typed search is written onto the list entry only when the address bar lacks it", () => {
  assert.equal(listEntrySync("/pipeline", "tab=ALL&sort=tracker&dir=1", "Fixture"), "/pipeline?tab=ALL&sort=tracker&dir=1&q=Fixture");
  assert.equal(listEntrySync("/pipeline", "tab=ALL&sort=tracker&dir=1&q=Fixture", "Fixture"), "");
  assert.equal(listEntrySync("/pipeline", "tab=ALL&q=Fixture", ""), "/pipeline?tab=ALL");
});

test("the list, the studio, and the checklist walk back through the real entry", () => {
  const root = new URL("../../src/", import.meta.url);
  const pipeline = readFileSync(new URL("./components/pipeline-view.tsx", root), "utf8");
  const back = readFileSync(new URL("./components/back-link.tsx", root), "utf8");
  const studio = readFileSync(new URL("./components/cv-studio/cv-studio.tsx", root), "utf8");
  const pdf = readFileSync(new URL("./components/generate-pdf-button.tsx", root), "utf8");
  assert.match(pipeline, /listEntrySync\(pathname, params\.toString\(\), q\)/);
  assert.match(pipeline, /state\.__NA !== true/);
  const syncAt = pipeline.indexOf("function syncTypedSearch");
  const syncEnd = pipeline.indexOf("const lastUrlQ", syncAt);
  const sync = pipeline.slice(syncAt, syncEnd);
  const modifiedAt = sync.indexOf("event.button === 1) return");
  assert.ok(modifiedAt > 0 && modifiedAt < sync.indexOf("history.replaceState"), "a modified click must return before replaceState");
  assert.match(back, /previousMatchIndex\(href, location\.href, current\.index/);
  assert.match(back, /window\.history\.go\(match - current\.index\)/);
  assert.match(pdf, /cv-studio\$\{listQuery \? `\?\$\{listQuery\}` : ""\}`/);
  assert.match(studio, /pipelineQuery\(useSearchParams\(\)\.toString\(\)\)/);
});
