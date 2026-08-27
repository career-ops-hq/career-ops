import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_MARK, CLOSE_MARK, parseCvEnvelope, createCvEnvelopeFilter } from "../../src/lib/cv-envelope.mjs";

const PAYLOAD = {
  lang: "en",
  page_format: "a4",
  candidate: { name: "Jane", email: "jane@example.com" },
  summary: "Built <safe> systems — 你好 & reliable",
  competencies: ["Agents", "Evaluation"],
};

function envelope(payload = PAYLOAD) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return `${OPEN_MARK}\n${body}\n${CLOSE_MARK}`;
}

test("parseCvEnvelope extracts a JSON object and canonicalizes page format", () => {
  const result = parseCvEnvelope(`Tailoring.\n${envelope()}\nVERDICT: 5/5 — done`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, PAYLOAD);
  assert.equal(result.format, "a4");
  assert.deepEqual(result.warnings, []);
});

test("format lives only in the payload and is normalized for builder and renderer", () => {
  const upper = parseCvEnvelope(envelope({ ...PAYLOAD, page_format: "LETTER" }));
  assert.equal(upper.ok, true);
  assert.equal(upper.format, "letter");
  assert.equal(upper.payload.page_format, "letter");

  for (const page_format of [undefined, null, "", "legal", 42]) {
    const result = parseCvEnvelope(envelope({ ...PAYLOAD, page_format }));
    assert.equal(result.ok, true);
    assert.equal(result.format, "letter");
    assert.equal(result.payload.page_format, "letter");
    assert.equal(result.warnings.length, 1);
  }
});

test("JSON values preserve Unicode, braces, and HTML-significant text", () => {
  const summary = 'José — <script> & {{SUMMARY}} "quoted"';
  const result = parseCvEnvelope(envelope({ ...PAYLOAD, summary }));
  assert.equal(result.ok, true);
  assert.equal(result.payload.summary, summary);
});

test("malformed, empty, and non-object bodies fail closed", () => {
  for (const body of ["", "{", "null", "[]", '"text"', "42", "true"]) {
    const result = parseCvEnvelope(envelope(body));
    assert.equal(result.ok, false, body);
  }
});

test("missing, unterminated, mid-line, and duplicate envelopes fail closed", () => {
  assert.equal(parseCvEnvelope("no payload").ok, false);
  assert.equal(parseCvEnvelope(`${OPEN_MARK}\n{`).ok, false);
  assert.equal(parseCvEnvelope(`mentions ${OPEN_MARK}\n{}\n${CLOSE_MARK}`).ok, false);
  const result = parseCvEnvelope(`${envelope()}\n${envelope()}`);
  assert.equal(result.ok, false);
  assert.match(result.error, /2 .*envelopes/i);
  assert.match(result.error, /refusing to guess/i);
});

test("the first line-anchored closer wins, making injected truncation invalid JSON", () => {
  const text = `${OPEN_MARK}\n{"summary":"safe"\n${CLOSE_MARK}\n,"summary":"tail"}\n${CLOSE_MARK}`;
  const result = parseCvEnvelope(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /valid JSON/i);
});

test("marker spellings inside JSON strings do not alter the envelope", () => {
  const summary = `mentions ${OPEN_MARK} and ${CLOSE_MARK} mid-line`;
  const result = parseCvEnvelope(envelope({ ...PAYLOAD, summary }));
  assert.equal(result.ok, true);
  assert.equal(result.payload.summary, summary);
});

test("CRLF and trailing marker whitespace are accepted", () => {
  const text = envelope().replace(/\n/g, "\r\n").replace(CLOSE_MARK, `${CLOSE_MARK}  `);
  const result = parseCvEnvelope(text);
  assert.equal(result.ok, true);
  assert.equal(result.payload.summary, PAYLOAD.summary);
});

test("non-string input fails instead of throwing", () => {
  assert.equal(parseCvEnvelope(undefined).ok, false);
  assert.equal(parseCvEnvelope(null).ok, false);
});

function feed(text, size) {
  const filter = createCvEnvelopeFilter();
  let display = "";
  for (let i = 0; i < text.length; i += size) display += filter.push(text.slice(i, i + size));
  display += filter.flush();
  return { display, result: filter.result() };
}

const FULL = `Tailoring now.\n${envelope()}\nAll set.\nVERDICT: 5/5 — tailored`;

test("stream filter hides payload and markers at every chunk size", () => {
  for (let size = 1; size <= FULL.length + 1; size += 1) {
    const { display, result } = feed(FULL, size);
    assert.equal(result.ok, true, `size ${size}`);
    assert.deepEqual(result.payload, PAYLOAD, `size ${size}`);
    assert.match(display, /Tailoring now/);
    assert.match(display, /VERDICT: 5\/5/);
    assert.ok(!display.includes(PAYLOAD.summary), `size ${size}: payload leaked`);
    assert.ok(!display.includes("cv-payload"), `size ${size}: marker leaked`);
  }
});

test("stream filter handles CRLF split across chunks", () => {
  const text = FULL.replace(/\n/g, "\r\n");
  for (let size = 1; size <= 16; size += 1) {
    const { display, result } = feed(text, size);
    assert.equal(result.ok, true, `size ${size}`);
    assert.ok(!display.includes(PAYLOAD.summary), `size ${size}: payload leaked`);
  }
});

test("stream filter releases ordinary text held as a possible marker prefix", () => {
  const filter = createCvEnvelopeFilter();
  assert.equal(filter.push("ordinary prose\n<"), "ordinary prose\n");
  assert.equal(filter.push("not-a-marker"), "<not-a-marker");
  assert.equal(filter.flush(), "");
});

test("stream filter flushes an unfinished marker-like prose prefix", () => {
  const filter = createCvEnvelopeFilter();
  const display = filter.push("done\n<<not-a-marker") + filter.flush();
  assert.equal(display, "done\n<<not-a-marker");
});

test("stream filter never leaks an unterminated payload body on flush", () => {
  const filter = createCvEnvelopeFilter();
  const display = filter.push(`${OPEN_MARK}\n{\"summary\":\"secret\"`) + filter.flush();
  assert.equal(display, "");
  assert.equal(filter.result().ok, false);
});

test("stream filter preserves a trailing bare carriage return in ordinary prose", () => {
  const filter = createCvEnvelopeFilter();
  assert.equal(filter.push("done\r") + filter.flush(), "done\r");
});

test("a mid-line closer stays inside the JSON string until the real line-anchored closer", () => {
  const summary = `safe ${CLOSE_MARK} text`;
  const { display, result } = feed(envelope({ ...PAYLOAD, summary }), 3);
  assert.equal(result.ok, true);
  assert.equal(result.payload.summary, summary);
  assert.equal(display, "");
});

test("old HTML envelope is intentionally not accepted", () => {
  const old = '<<cv-html format="a4">>\n<html></html>\n<</cv-html>>';
  assert.equal(parseCvEnvelope(old).ok, false);
});
