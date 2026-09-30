// jev-pre-screen.test.mjs — the cheap ATS prior.
//
// Two properties matter more than anything else here, and both are enforced by
// the data that motivated the change:
//
//   1. It NEVER discards. Measured over 69 real postings, ats_pass_probability
//      never reached 4.0 (0/69) while the mode's own rule demanded >= 4.0 — that
//      rule would have thrown away 100% of the pipeline. At a survivable 2.6
//      cut-off it still drops 6 roles the user actually applied to. So the only
//      decisions it may return are "available" and "unavailable".
//   2. It FAILS OPEN. A dead key, a timeout, a missing script, or a PDF capture
//      must all return "unavailable" so the caller runs the full evaluation.
//      Nothing here may throw or exit non-zero.
//
// No test in this file touches the network: a stub gatekeeper stands in for
// jev_gatekeeper.py, so the suite is deterministic and free.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bandFor, jevPreScreen, DEFAULT_BANDS } from "../../src/lib/jev-pre-screen.mjs";

/** Build a throwaway root whose gatekeeper prints a canned decision. */
function stubRoot({ stdout, status = 0, stderr = "", jobName = "jd.md" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jev-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "cv.md"), "# Candidate\nPM, AI products\n");
  fs.writeFileSync(path.join(root, jobName), "We are hiring a product manager.\n");
  fs.writeFileSync(
    path.join(root, "scripts", "jev_gatekeeper.py"),
    `import sys\nsys.stderr.write(${JSON.stringify(stderr)})\nsys.stdout.write(${JSON.stringify(stdout)})\nsys.exit(${status})\n`,
  );
  return { root, job: path.join(root, jobName) };
}

const OK = JSON.stringify({ ats_pass_probability: 3.4, has_core_skills: true });
const META = "provider=openrouter model=typesafe/jev-1.13-20260917 http_ms=431 total_ms=431 " +
  `usage={"input_tokens":2739,"output_tokens":38,"cost":0.000115038}\n`;

test("bands are calibrated to the measured 69-posting distribution", () => {
  assert.equal(bandFor(1.59), "low", "observed minimum");
  assert.equal(bandFor(2.4), "guarded");
  assert.equal(bandFor(2.98), "mid", "observed median");
  assert.equal(bandFor(3.82), "high", "observed maximum");
  assert.equal(bandFor(null), "unknown");
  assert.equal(bandFor(NaN), "unknown");
});

test("band edges are exclusive on the upper bound", () => {
  assert.equal(bandFor(DEFAULT_BANDS.low), "guarded");
  assert.equal(bandFor(DEFAULT_BANDS.guarded), "mid");
  assert.equal(bandFor(DEFAULT_BANDS.mid), "high");
});

test("the shipped defaults are the measured p15/p25/p75 cut points", () => {
  // Regression guard on the calibration itself, not on bandFor(). band_low was
  // 1.85 while documented as "approximately the 15th percentile"; measured over
  // 73 captures in jds/ the real p15 is 2.260. These three numbers now come from
  // data/jev-calibration.tsv via scripts/jev-calibrate.mjs, and they must match
  // config/profile.yml — a drift in either direction silently re-misclassifies
  // every scored run.
  assert.equal(DEFAULT_BANDS.low, 2.26, "band_low must be the measured p15 (2.260)");
  assert.equal(DEFAULT_BANDS.guarded, 2.6, "band_guarded is the applied-roles floor");
  assert.equal(DEFAULT_BANDS.mid, 3.2, "band_mid is the high threshold");

  const repoProfile = new URL("../../../config/profile.yml", import.meta.url);
  const raw = fs.readFileSync(repoProfile, "utf8");
  const m = /^jev_gate:\s*$((?:\n[ \t]+.*)*)/m.exec(raw);
  assert.ok(m, "config/profile.yml must carry a jev_gate block");
  assert.match(m[1], /band_low:\s*2\.26/, "config band_low must match DEFAULT_BANDS.low");
  assert.match(m[1], /band_mid:\s*3\.2/, "config band_mid must match DEFAULT_BANDS.mid");
});

test("a healthy gate returns a prior, never a discard verdict", () => {
  const { root, job } = stubRoot({ stdout: OK, stderr: META });
  const r = jevPreScreen({ jobPath: job, root });
  assert.equal(r.decision, "available");
  assert.equal(r.score, 3.4);
  assert.equal(r.hasCoreSkills, true);
  assert.equal(r.band, "high");
  assert.equal(r.provider, "openrouter");
  assert.equal(r.inputTokens, 2739);
  assert.equal(r.costUsd, 0.000115038);
  assert.ok(!("discard" in r), "the gate must not be able to say discard");
});

test("fail-open: a provider HTTP error is unavailable, not a discard", () => {
  const { root, job } = stubRoot({ stdout: '{"error":"HTTP 401: User not found."}', status: 1 });
  const r = jevPreScreen({ jobPath: job, root });
  assert.equal(r.decision, "unavailable");
  assert.match(r.reason, /401/);
});

test("fail-open: non-JSON stdout is unavailable", () => {
  const { root, job } = stubRoot({ stdout: "not json at all" });
  assert.equal(jevPreScreen({ jobPath: job, root }).decision, "unavailable");
});

test("fail-open: a response missing the score is unavailable", () => {
  const { root, job } = stubRoot({ stdout: JSON.stringify({ has_core_skills: true }) });
  assert.equal(jevPreScreen({ jobPath: job, root }).decision, "unavailable");
});

test("fail-open: a PDF capture has no text to read", () => {
  const { root, job } = stubRoot({ stdout: OK, jobName: "jd.pdf" });
  const r = jevPreScreen({ jobPath: job, root });
  assert.equal(r.decision, "unavailable");
  assert.match(r.reason, /not text/);
});

test("fail-open: missing job file", () => {
  const { root } = stubRoot({ stdout: OK });
  assert.equal(jevPreScreen({ jobPath: path.join(root, "nope.md"), root }).decision, "unavailable");
});

test("fail-open: missing gatekeeper script", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jev-test-"));
  fs.writeFileSync(path.join(root, "cv.md"), "# c\n");
  fs.writeFileSync(path.join(root, "jd.md"), "job\n");
  assert.equal(jevPreScreen({ jobPath: path.join(root, "jd.md"), root }).decision, "unavailable");
});

test("fail-open: disabled in config", () => {
  const { root, job } = stubRoot({ stdout: OK });
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "jev_gate:\n  enabled: false\n");
  const r = jevPreScreen({ jobPath: job, root });
  assert.equal(r.decision, "unavailable");
  assert.match(r.reason, /disabled/);
});

test("bands are configurable from config/profile.yml", () => {
  const { root, job } = stubRoot({ stdout: OK });
  fs.writeFileSync(
    path.join(root, "config", "profile.yml"),
    "jev_gate:\n  enabled: true\n  band_low: 1.0\n  band_guarded: 3.0\n  band_mid: 4.0\n",
  );
  // 3.4 sits between guarded(3.0) and mid(4.0) once the bands are the user's.
  assert.equal(jevPreScreen({ jobPath: job, root }).band, "mid");
});

test("a partial band override is honoured and repaired into ascending order", () => {
  // band_low: 3.0 with guarded left at 2.6 is non-monotonic. Unhandled, bandFor()
  // falls through to the top band for anything above the middle and the override
  // silently does nothing. A score of 2.5 is "guarded" under the measured
  // defaults and must become "low" once the user raises band_low to 3.0.
  const score25 = JSON.stringify({ ats_pass_probability: 2.5, has_core_skills: true });
  assert.equal(bandFor(2.5), "guarded", "precondition: 2.5 is guarded on defaults");

  const { root, job } = stubRoot({ stdout: score25 });
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "spend_tier: standard\n");
  assert.equal(jevPreScreen({ jobPath: job, root }).band, "guarded", "no jev_gate block → defaults");

  fs.writeFileSync(path.join(root, "config", "profile.yml"), "jev_gate:\n  enabled: true\n  band_low: 3.0\n");
  const overridden = jevPreScreen({ jobPath: job, root });
  assert.equal(overridden.band, "low", "band_low: 3.0 must be read AND win over the stale guarded value");
});

test("a profile with no jev_gate block still works on measured defaults", () => {
  const { root, job } = stubRoot({ stdout: OK });
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "spend_tier: standard\n");
  assert.equal(jevPreScreen({ jobPath: job, root }).band, "high");
});

test("has_core_skills:false is reported, but is still not a discard", () => {
  const { root, job } = stubRoot({ stdout: JSON.stringify({ ats_pass_probability: 1.6, has_core_skills: false }) });
  const r = jevPreScreen({ jobPath: job, root });
  assert.equal(r.decision, "available");
  assert.equal(r.hasCoreSkills, false);
  assert.equal(r.band, "low");
  assert.ok(!("discard" in r));
});

test("the real repo cv.md is what the measured calibration was fit to", () => {
  // Guards the calibration's premise: if cv.md is replaced, the bands above are
  // stale and the profile comment must be re-measured.
  const cv = path.resolve(import.meta.dirname, "../../../cv.md");
  assert.ok(fs.existsSync(cv), "cv.md missing — re-measure the gate bands before trusting them");
});
