import assert from "node:assert/strict";
import { test } from "node:test";
import { pipelineQuery, pipelineTab, rowOnPipelineTab, PIPELINE_TABS } from "../../src/lib/pipeline-navigation.mjs";
import { classifyLeaf } from "../../src/lib/pipeline-sankey.mjs";

test("direct report visits retain the default Pipeline destination", () => {
  assert.equal(pipelineQuery({}), "");
  assert.equal(pipelineQuery(""), "");
});

test("the client and server round trip every existing list filter", () => {
  const query = "tab=EVALUATED&min=3.5&sort=company&dir=1&q=Fixture";
  assert.equal(pipelineQuery(query), query);
  assert.equal(pipelineQuery(Object.fromEntries(new URLSearchParams(query))), query);
});

test("local typing overrides a stale URL search and an explicit clear removes it", () => {
  assert.equal(pipelineQuery("tab=ALL&q=old", "new"), "tab=ALL&q=new");
  assert.equal(pipelineQuery("tab=ALL&q=old", ""), "tab=ALL");
});

test("search punctuation and Unicode remain data, not query syntax", () => {
  const search = "R&D + C++ / Montréal 日本 #1?";
  const query = pipelineQuery("tab=ALL", search);
  assert.equal(new URLSearchParams(query).get("q"), search);
  assert.equal(pipelineQuery(Object.fromEntries(new URLSearchParams(query))), query);
  assert.equal(new URLSearchParams(query).get("tab"), "ALL");
});

test("only list filters travel back; no external or nested return destination", () => {
  assert.equal(pipelineQuery("tab=ALL&_rsc=abc&returnTo=https%3A%2F%2Fexample.com&from=%2Fconfig"), "tab=ALL");
});

test("repeated server search params use the same first value as the list", () => {
  assert.equal(pipelineQuery({ tab: ["ALL", "APPLIED"], q: ["first", "second"], dir: undefined }), "tab=ALL&q=first");
  assert.equal(pipelineQuery("tab=ALL&tab=APPLIED&q=first&q=second"), "tab=ALL&q=first");
});

test("empty filters do not introduce an empty query suffix", () => {
  assert.equal(pipelineQuery({ tab: "", min: undefined, q: [] }), "");
});

test("an unknown status has its own tab and is not counted as evaluated", () => {
  assert.equal(pipelineTab("other"), "OTHER");
  assert.equal(rowOnPipelineTab("Paused", "OTHER"), true);
  assert.equal(rowOnPipelineTab("Paused", "EVALUATED"), false);
  assert.equal(rowOnPipelineTab("Evaluated", "OTHER"), false);
  assert.equal(rowOnPipelineTab("Evaluated", "EVALUATED"), true);
  assert.equal(rowOnPipelineTab("Applied", "APPLIED"), true);
  assert.equal(rowOnPipelineTab("", "OTHER"), false);
  assert.equal(rowOnPipelineTab("", "DISCARDED"), true);
  const rows = ["Evaluated", "Applied", "Paused", ""];
  const stages = PIPELINE_TABS.filter((tab) => tab !== "INBOX" && tab !== "ALL" && tab !== "OTHER");
  const counted = stages.reduce((n, tab) => n + rows.filter((status) => rowOnPipelineTab(status, tab)).length, 0)
    + rows.filter((status) => rowOnPipelineTab(status, "OTHER")).length;
  assert.equal(counted, rows.length);
});

test("tabs read a status the way the Analytics sankey does", () => {
  assert.equal(rowOnPipelineTab("Not evaluated", "EVALUATED"), false);
  assert.equal(rowOnPipelineTab("Not evaluated", "OTHER"), true);
  assert.equal(rowOnPipelineTab("Aplicado 2026-08-20", "APPLIED"), true);
  assert.equal(rowOnPipelineTab("Aplicado 2026-08-20", "OTHER"), false);
  for (const status of ["Not evaluated", "Aplicado 2026-08-20", "Interview 2026-09-01", "**Rejected**", "Paused", "Evaluated", "SKIP", "", "—"]) {
    const otherLeaf = classifyLeaf({ n: 1, status }, []) === "other";
    assert.equal(rowOnPipelineTab(status, "OTHER"), otherLeaf, `${JSON.stringify(status)} OTHER tab vs sankey`);
  }
});

test("pipelineTab falls back to INBOX and reads the first repeated value", () => {
  assert.deepEqual(
    [pipelineTab(undefined), pipelineTab(""), pipelineTab("FOO"), pipelineTab("applied"), pipelineTab(["INBOX", "APPLIED"]), pipelineTab(["foo", "ALL"])],
    ["INBOX", "INBOX", "INBOX", "APPLIED", "INBOX", "INBOX"],
  );
});
