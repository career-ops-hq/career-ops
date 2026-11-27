import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestErrorMessage } from "../../src/lib/cv/ingest-error.mjs";

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a refused upload shows the server's reason, not a generic parse failure (#5369)", async () => {
  const msg = await ingestErrorMessage(json({ error: "PDF upload needs Claude Code — paste your CV text instead." }, 400));
  assert.equal(msg.message, "PDF upload needs Claude Code — paste your CV text instead.");
});

test("a non-JSON error body falls back to a message naming the status", async () => {
  const msg = await ingestErrorMessage(new Response("<html>boom</html>", { status: 500 }));
  assert.match(msg.message, /500/);
  assert.match(msg.message, /paste/i);
});

test("an error body without a usable `error` string also falls back", async () => {
  for (const body of [{}, { error: "" }, { error: 42 }]) {
    const msg = await ingestErrorMessage(json(body, 400));
    assert.match(msg.message, /400/);
  }
});

test("404 shows the route's installation instructions", async () => {
  const reason = "No supported CLI is installed. Install one, then choose it in Config.";
  assert.deepEqual(await ingestErrorMessage(json({ error: reason }, 404)), { message: reason });
});

test("404 without a usable reason keeps the Config fallback", async () => {
  const fallback = "Connect an AI CLI in Config first — it parses your CV locally.";
  assert.deepEqual(await ingestErrorMessage(json({ error: "   " }, 404)), { message: fallback, configLink: true });
  assert.deepEqual(await ingestErrorMessage(new Response("Not found", { status: 404 })), { message: fallback, configLink: true });
});

test("an OK response is not an error, and its stream is left unread", async () => {
  const r = new Response("<<cv:start>>\n# CV", { status: 200 });
  assert.equal(await ingestErrorMessage(r), null);
  assert.equal(r.bodyUsed, false);
});

test("the CV ingest component routes every failed response through it", () => {
  const src = readFileSync(new URL("../../src/components/cv/cv-ingest.tsx", import.meta.url), "utf8");
  assert.match(src, /ingestErrorMessage\(r\)/);
  assert.match(src, /showConfigLink && <Link href="\/config"/);
  assert.match(src, /setErr\(failure\.message\)/);
});
