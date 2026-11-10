import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { parseCvEnvelope } from "../../src/lib/cv-envelope.mjs";

const ARGS = { input: "018", memory: "", today: "2026-08-04" };

const PAYLOAD = {
  lang: "en",
  page_format: "letter",
  candidate: {
    name: "Jane Doe",
    title: "Senior Analyst",
    email: "jane.example",
    location: "Example City",
  },
  summary: "Analyst who ships reports.",
  experience: [
    { company: "Globex", role: "Analyst", dates: "2020 - 2024", bullets: ["Shipped the weekly report"] },
    { company: "Initech", role: "Associate", dates: "2016 - 2019", bullets: ["Filed the numbers"] },
  ],
};

test("the dashboard pdf prompt asks for the CLI JSON payload and keeps roles newest-first", () => {
  const prompt = buildPrompt({ kind: "pdf", ...ARGS });

  assert.match(prompt, /<<cv-json/);
  assert.match(prompt, /<<\/cv-json>>/);
  assert.match(prompt, /newest-first/i);
  assert.doesNotMatch(prompt, /reorder experience by relevance/);
  assert.doesNotMatch(prompt, /complete HTML document/i);
  assert.doesNotMatch(prompt, /<!DOCTYPE html>/);
});

test("a cv-json envelope is the tailored CV, not an HTML document", () => {
  const text = [
    "Tailoring the CV.",
    '<<cv-json format="letter">>',
    JSON.stringify(PAYLOAD),
    "<</cv-json>>",
    "VERDICT: 5/5 — tailored",
  ].join("\n");

  const result = parseCvEnvelope(text);

  assert.equal(result.ok, true);
  assert.equal(result.format, "letter");
  assert.equal(result.payload.candidate.name, "Jane Doe");
  assert.equal(result.payload.experience[0].company, "Globex");
  assert.equal(result.html, undefined);
});
