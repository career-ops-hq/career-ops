// gate3-telemetry-parser.test.mjs — the two string-parsing contracts behind the
// Gate 3 telemetry in the pdf lane of web/src/app/api/run/route.ts.
//
// WHY THIS EXISTS
//   Both parsers existed only as hand-verified logic inside a route handler.
//   This closes the TODO(#gate3) recorded in
//   tests/web-core-argv-contract.test.mjs. The cases are built from OBSERVED
//   output, not from what the code was supposed to produce:
//
//   - `Gate 3 halt: has_measurable_metrics: false — weak experience lines;
//     insert structured metrics` is real stdout from
//     `node jev-post-linter.mjs <payload> <jd>`. Its reason contains a
//     semicolon, so an earlier split(";") corrupted the linter's own prose.
//   - `{"url":…,"title":…,"text":…}` is real stdout from
//     `node browser-extract.mjs <url> --mode jd`.
//
// WHAT IS MIRRORED, AND WHY IT IS NOT AN IMPORT
//   route.ts has no export seam for parseGate3Output yet, and this suite runs
//   under plain `node --test` where a Next route handler cannot be imported, so
//   both functions are re-declared here byte-for-byte. extractJsonPayload IS
//   exported from the route, but importing it would pull the entire module
//   graph (clis, run-registry, career-ops root) into a unit suite — so it is
//   mirrored too. When these move into web/src/lib/core/, this file should
//   import them and keep only the tables below: the mirror-with-parity-test
//   shape normalize-text-key.mjs already uses (#2666).
//
// THE INVARIANT UNDER TEST
//   `unavailable` is the safe default; `halt` means a real finding about the CV.
//   Nothing garbled, truncated or provider-errored may ever become `halt`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- mirrored from web/src/app/api/run/route.ts -----------------------------

const FALLBACK = { decision: 'unavailable', reason: 'LINTER_SUBPROCESS_FALLBACK' };

function gate3Text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function parseGate3Output(output) {
  const line = String(output).split('\n').map((l) => l.trim()).find((l) => l.startsWith('Gate 3 '));
  if (!line) return { ...FALLBACK, reason: 'UNPARSEABLE_LINTER_OUTPUT' };
  const m = /^Gate 3 (pass|halt|unavailable)\s*:?\s*([\s\S]*)$/.exec(line);
  if (!m) return { ...FALLBACK, reason: 'UNPARSEABLE_LINTER_OUTPUT' };
  const [, decision, detail] = m;
  const body = gate3Text(detail);
  if (decision === 'halt') return { decision: 'halt', reasons: body ? [body] : ['linter reported a finding'] };
  if (decision === 'unavailable') return { decision: 'unavailable', reason: body || 'LINTER_REPORTED_UNAVAILABLE' };
  return { decision: 'pass', reasons: [] };
}

function extractJsonPayload(output) {
  const raw = String(output ?? '').trim();
  if (!raw) return null;
  const firstStructural = raw.search(/[[{]/);
  if (firstStructural === -1 || raw[firstStructural] !== '{') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const text = parsed.text;
  return typeof text === 'string' && text.trim() !== '' ? { text } : null;
}

const clip = (s, n = 56) => (s.length > n ? s.slice(0, n) + '…' : s);

// --- matrix 1: linter stdout -> telemetry -----------------------------------

const LINTER_CASES = [
  // the three real outcomes
  ['Gate 3 pass: clean', 'pass', null],
  ['Gate 3 unavailable: gate timed out after 30000ms', 'unavailable', 'gate timed out after 30000ms'],
  // OBSERVED halt output — the semicolon lives INSIDE the reason
  ['Gate 3 halt: has_measurable_metrics: false — weak experience lines; insert structured metrics',
    'halt', null],
  // two semicolons: still exactly ONE reason, prose intact
  ['Gate 3 halt: is_ai_sibling: true — a; b: c', 'halt', null],
  // messy stdout fragments
  ['Usage: node jev-post-linter.mjs <resume.md>', 'unavailable', 'UNPARSEABLE_LINTER_OUTPUT'],
  ['', 'unavailable', 'UNPARSEABLE_LINTER_OUTPUT'],
  ['\n\nGate 3 pass: clean\n\nwarning: 4 warnings\n', 'pass', null],
  ['warning: provider slow\nGate 3 pass: clean', 'pass', null],
  // provider error payloads arrive on the SAME channel as a verdict
  ['{"error":"API_KEY_INVALID"}', 'unavailable', 'UNPARSEABLE_LINTER_OUTPUT'],
  ['gate exited 1 without a linter verdict', 'unavailable', 'UNPARSEABLE_LINTER_OUTPUT'],
  ['<html><body>500</body></html>', 'unavailable', 'UNPARSEABLE_LINTER_OUTPUT'],
];

test('linter stdout maps to the right telemetry decision', () => {
  for (const [input, wantDecision, wantReason] of LINTER_CASES) {
    const got = parseGate3Output(input);
    assert.equal(got.decision, wantDecision, `decision for ${JSON.stringify(clip(input))}`);
    if (wantReason !== null) {
      assert.equal(got.reason, wantReason, `reason for ${JSON.stringify(clip(input))}`);
    }
  }
});

test('a halt reason containing ";" stays ONE reason, un-mangled', () => {
  const h = parseGate3Output(
    'Gate 3 halt: has_measurable_metrics: false — weak experience lines; insert structured metrics',
  );
  assert.equal(h.decision, 'halt');
  assert.equal(h.reasons.length, 1, 'must not split on the semicolon inside the reason');
  assert.ok(h.reasons[0].includes('lines; insert'), 'reason prose must survive verbatim');
});

test('multiple semicolons do not multiply reasons', () => {
  const h = parseGate3Output('Gate 3 halt: is_ai_sibling: true — a; b: c');
  assert.equal(h.reasons.length, 1);
  assert.ok(h.reasons[0].includes('a; b: c'));
});

test('fail-open: no unparseable input can ever be reported as halt', () => {
  const garbage = LINTER_CASES.filter(([i]) => !/^Gate 3 (pass|halt|unavailable)/.test(i.trim()));
  assert.ok(garbage.length >= 5, 'the garbled corpus must be substantial to mean anything');
  for (const [input] of garbage) {
    assert.notEqual(parseGate3Output(input).decision, 'halt', `${JSON.stringify(clip(input))} became halt`);
  }
});

// --- matrix 2: browser-extract stdout -> JD text ----------------------------

const EXTRACT_CASES = [
  // real browser-extract.mjs --mode jd output
  ['{"url":"https://job-boards.greenhouse.io/vercel?error=true","title":"Current openings at Vercel","text":"Account Executive Job Apply now…"}', true],
  // stderr noise ahead of the JSON — the reason the slice exists at all
  ['some warning\n{"url":"u","title":"t","text":"Real JD body here"}', true],
  // noise AFTER the JSON too (runCoreScript concatenates both channels)
  ['{"url":"u","title":"t","text":"JD"}trailing warning', true],
  // error shapes -> null (EMPTY_OR_BLOCKED_JD_CAPTURE upstream)
  ['', false],
  ['{"error":"extracted 40 chars of JD text (minimum 200)","code":"empty_text","url":"u"}', false],
  ['{"url":"u","title":"t","text":""}', false],
  ['{"url":"u","title":"t"}', false],
  ['{"url":"u","title":"t","text":null}', false],
  ['{"url":"u","title":"t","text":123}', false],
  ['[{"url":"u","title":"t","text":"listing shape"}]', false],   // --mode listing: an ARRAY, never a JD
  ['warning: noise\n[{"url":"u","text":"listing behind stderr"}]', false],
  ['not json at all', false],
  ['{ broken json', false],
  ['{"a":1}{"b":2}', false],   // slice-to-last-brace yields invalid JSON
];

test('browser-extract stdout yields JD text only when it is usable', () => {
  for (const [input, wantText] of EXTRACT_CASES) {
    const got = extractJsonPayload(input);
    if (wantText) {
      assert.ok(got, `expected text for ${JSON.stringify(clip(input))}`);
      assert.equal(typeof got.text, 'string');
      assert.ok(got.text.trim() !== '');
    } else {
      assert.equal(got, null, `expected null (EMPTY_OR_BLOCKED_JD_CAPTURE) for ${JSON.stringify(clip(input))}`);
    }
  }
});

test('stderr-prefixed JSON: bare JSON.parse() throws, the first-{..last-} slice recovers it', () => {
  const noisy = 'warning: slow provider\n{"url":"u","title":"t","text":"JD"}';
  let bareThrew = false;
  try { JSON.parse(noisy); } catch { bareThrew = true; }
  assert.ok(bareThrew, 'precondition: the concatenated stream is not directly parseable');
  assert.notEqual(extractJsonPayload(noisy), null, 'the slice boundary is what recovers it');
});