import test from "node:test";
import assert from "node:assert/strict";

import { createOmniRouteClient } from "../../src/lib/omniroute-client.mjs";

const offers = [
  { title: "Platform Engineer", company: "North", url: "https://jobs.example/north", score: 76, reasons: ["Matchar målroll"] },
  { title: "AI Engineer", company: "South", url: "https://jobs.example/south", score: 70, reasons: ["Rätt plats"] },
];

test("OmniRoute client reports gateway health and available models", async () => {
  const calls = [];
  const inheritedModel = process.env.OMNIROUTE_MODEL;
  delete process.env.OMNIROUTE_MODEL;
  try {
    const client = createOmniRouteClient({
      baseUrl: "http://gateway.test/v1",
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("/health")) return Response.json({ status: "ok", model: "auto/reliable" });
        return Response.json({ data: [{ id: "auto/reliable" }, { id: "auto/best-free" }] });
      },
    });

    const status = await client.status();
    assert.equal(status.reachable, true);
    assert.equal(status.model, "auto/external");
    assert.deepEqual(status.models, ["auto/reliable", "auto/best-free"]);
    assert.equal(calls[0], "http://gateway.test/health");
  } finally {
    if (inheritedModel === undefined) delete process.env.OMNIROUTE_MODEL;
    else process.env.OMNIROUTE_MODEL = inheritedModel;
  }
});

test("OmniRoute client merges structured AI rankings without losing deterministic reasons", async () => {
  const client = createOmniRouteClient({
    baseUrl: "http://gateway.test/v1",
    fetchImpl: async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ rankings: [
        { url: "https://jobs.example/south", score: 96, reason: "Stark AI- och produktmatch" },
        { url: "https://jobs.example/north", score: 82, reason: "Bra plattformserfarenhet" },
      ] }) } }],
    }),
  });

  const result = await client.rank(offers, { roles: ["AI Engineer"] });
  assert.equal(result.ok, true);
  assert.equal(result.offers[0].company, "South");
  assert.equal(result.offers[0].aiScore, 96);
  assert.match(result.offers[0].aiReason, /AI-/);
  assert.deepEqual(result.offers[0].reasons, ["Rätt plats"]);
});

test("OmniRoute client degrades safely when every upstream fails", async () => {
  const client = createOmniRouteClient({
    baseUrl: "http://gateway.test/v1",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "All zero-cost upstreams failed" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
  });

  const result = await client.rank(offers, { roles: ["Engineer"] });
  assert.equal(result.ok, false);
  assert.match(result.error, /zero-cost upstreams/i);
  assert.deepEqual(result.offers, offers);
});

test("OmniRoute client returns a plain assistant reply", async () => {
  const calls = [];
  const client = createOmniRouteClient({
    baseUrl: "http://gateway.test/v1",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({ choices: [{ message: { content: "OMNI_OK" } }] });
    },
  });

  const result = await client.chat("Svara exakt OMNI_OK");
  assert.equal(result.ok, true);
  assert.equal(result.content, "OMNI_OK");
  assert.equal(calls[0].url, "http://gateway.test/v1/chat/completions");
  assert.equal(calls[0].body.stream, false);
});

test("OmniRoute chat retries one empty upstream response", async () => {
  let calls = 0;
  const client = createOmniRouteClient({
    baseUrl: "http://gateway.test/v1",
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: calls === 1 ? "" : "RETRY_OK" } }] });
    },
  });

  const result = await client.chat("Svara exakt RETRY_OK");
  assert.equal(result.ok, true);
  assert.equal(result.content, "RETRY_OK");
  assert.equal(calls, 2);
});
