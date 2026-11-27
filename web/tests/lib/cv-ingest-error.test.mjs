import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestErrorMessage } from "../../src/lib/cv/ingest-error.mjs";

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a refused upload shows the server's reason, not a generic parse failure (#5369)", async () => {
  const msg = await ingestErrorMessage(json({ error: "PDF upload needs Claude Code — paste your CV text instead." }, 400));
  assert.equal(msg, "PDF upload needs Claude Code — paste your CV text instead.");
});

test("a non-JSON error body falls back to a message naming the status", async () => {
  const msg = await ingestErrorMessage(new Response("<html>boom</html>", { status: 500 }));
  assert.match(msg, /500/);
  assert.match(msg, /paste/i);
});

test("an error body without a usable `error` string also falls back", async () => {
  for (const body of [{}, { error: "" }, { error: 42 }]) {
    const msg = await ingestErrorMessage(json(body, 400));
    assert.match(msg, /400/);
  }
});

test("404 keeps pointing at Config (no CLI connected)", async () => {
  const msg = await ingestErrorMessage(json({ error: "whatever the route says" }, 404));
  assert.equal(msg, "Connect an AI CLI in Config first — it parses your CV locally.");
});

test("an OK response is not an error, and its stream is left unread", async () => {
  const r = new Response("<<cv:start>>\n# CV", { status: 200 });
  assert.equal(await ingestErrorMessage(r), null);
  assert.equal(r.bodyUsed, false);
});

test("the CV ingest component routes every failed response through it", () => {
  const src = readFileSync(new URL("../../src/components/cv/cv-ingest.tsx", import.meta.url), "utf8");
  assert.match(src, /ingestErrorMessage\(r\)/);
});
