// jev-pre-screen.mjs — cheap ATS-screen PRIOR via TypeSafe Jev (scripts/jev_gatekeeper.py).
//
// WHY THIS NEVER DISCARDS ANYTHING
// --------------------------------
// Measured over 69 real postings in jds/ against this user's cv.md:
//
//   ats_pass_probability  min 1.59  median 2.98  max 3.82   (69 postings, 0 reached 4.0)
//   Pearson r vs the user's own A–F scores = 0.743
//
// Two consequences, both load-bearing:
//   1. The `>= 4.0` threshold in modes/_custom.md is UNREACHABLE. Scored against
//      real postings it discards 100% of them (0/69 pass) — wiring that rule as a
//      hard kill switch would have silently destroyed the entire pipeline.
//   2. The score ranks well (r=0.743) but its absolute scale is compressed into
//      roughly [1.5, 3.9], so any fixed cut-off cuts real roles. At 2.6 it would
//      discard 9 of 28 matched roles — 6 of which the user had actually APPLIED
//      to (AlphaSense, Airtel, Airtel Payments Bank, Delhivery x2, SOTI).
//
// So this reports a calibrated band + ranking prior, and the caller decides. A
// discard here is a false positive waiting to happen; a discard earned by
// check-liveness.mjs (the posting is factually closed) is free and certain.
//
// Fail-open by construction: any provider error, missing key, timeout, or missing
// input returns decision "unavailable" and the caller proceeds with the full
// evaluation. A broken vendor must never stop someone's job search.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Bands calibrated on the 69-posting distribution (median 2.98, max 3.82). */
// Fallback only, for a run where config/profile.yml cannot be read — normally
// the calibrated bands there win, and these must not drift from them.
// Measured over the 73 scorable captures in jds/ (see scripts/jev-calibrate.mjs):
// p15 2.260 | p25 2.530 | p50 2.940 | p75 3.300. `high` starts at 3.2.
export const DEFAULT_BANDS = { low: 2.26, guarded: 2.6, mid: 3.2 };

export const DEFAULTS = {
  enabled: true,
  timeoutMs: 30_000,
  bands: DEFAULT_BANDS,
};

export function bandFor(score, bands = DEFAULT_BANDS) {
  if (typeof score !== "number" || Number.isNaN(score)) return "unknown";
  if (score < bands.low) return "low";
  if (score < bands.guarded) return "guarded";
  if (score < bands.mid) return "mid";
  return "high";
}

function readGateConfig(profilePath) {
  const cfg = { ...DEFAULTS, bands: { ...DEFAULT_BANDS } };
  try {
    if (!fs.existsSync(profilePath)) return cfg;
    const raw = fs.readFileSync(profilePath, "utf8");
    // Minimal targeted reader: we only need the `jev_gate:` block's scalars, and
    // a hard js-yaml dependency here would drag a parser into every caller.
    const m = /^jev_gate:\s*$((?:\n[ \t]+.*)*)/m.exec(raw);
    if (!m) return cfg;
    const block = m[1];
    const pick = (key) => {
      const hit = new RegExp(`^[ \\t]+${key}:\\s*(\\S+)\\s*$`, "m").exec(block);
      return hit ? hit[1] : undefined;
    };
    const enabled = pick("enabled");
    if (enabled !== undefined) cfg.enabled = !/^(false|no|0|off)$/i.test(enabled);
    const t = pick("timeout_ms");
    if (t && /^\d+$/.test(t)) cfg.timeoutMs = Number(t);
    for (const k of ["low", "guarded", "mid"]) {
      const v = pick(`band_${k}`);
      if (v && Number.isFinite(Number(v))) cfg.bands[k] = Number(v);
    }
    // A partially-overridden set can come back non-monotonic (e.g. band_low: 3.0
    // left guarded at 2.6), which silently makes bandFor fall through to "high"
    // for anything above the middle. Force ascending order, keeping whatever the
    // user set that still fits and repairing only the band that breaks it.
    const order = ["low", "guarded", "mid"];
    for (let i = 1; i < order.length; i++) {
      if (cfg.bands[order[i]] < cfg.bands[order[i - 1]]) cfg.bands[order[i]] = cfg.bands[order[i - 1]];
    }
  } catch {
    /* unreadable profile → measured defaults */
  }
  return cfg;
}

function unavailable(reason, extra = {}) {
  return { decision: "unavailable", reason, ...extra };
}

/**
 * @typedef {{decision: "unavailable", reason: string, wallMs?: number}} JevUnavailable
 * @typedef {{decision: "available", score: number, hasCoreSkills: boolean, band: string,
 *            provider: string, model: string, httpMs: number, wallMs: number,
 *            inputTokens: number|null, outputTokens: number|null, costUsd: number|null}} JevAvailable
 * @typedef {JevUnavailable | JevAvailable} JevResult
 */

/**
 * Run the Jev triage gate as a ranking prior. Never throws; never blocks.
 * @param {{resumePath?:string, jobPath:string, root?:string, config?:object}} opts
 * @returns {JevResult}
 */
export function jevPreScreen({ resumePath, jobPath, root = process.cwd(), config } = {}) {
  const started = Date.now();
  const profilePath = path.join(root, "config", "profile.yml");
  const cfg = config ?? readGateConfig(profilePath);
  if (!cfg.enabled) return unavailable("disabled in config/profile.yml");

  const gatekeeper = path.join(root, "scripts", "jev_gatekeeper.py");
  const resume = resumePath ?? path.join(root, "cv.md");

  for (const [label, p] of [["gatekeeper", gatekeeper], ["resume", resume], ["job", jobPath]]) {
    if (!p || !fs.existsSync(p)) return unavailable(`missing ${label}: ${p ?? "(none)"}`);
  }
  // A PDF/DOCX capture has no text the gate can read. Fail open, don't guess.
  if (!/\.(md|txt|json)$/i.test(jobPath)) {
    return unavailable(`job capture is not text (${path.extname(jobPath) || "no ext"})`);
  }

  // Bare `python3`, never .venv/bin/python: the repo venv has no `requests`.
  const res = spawnSync("python3", [gatekeeper, resume, jobPath, "triage"], {
    cwd: root,
    encoding: "utf8",
    timeout: cfg.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });

  const wallMs = Date.now() - started;
  if (res.error) return unavailable(`spawn failed: ${res.error.message}`, { wallMs });
  if (res.status !== 0) {
    // jev_gatekeeper.py prints {"error": ...} on stdout before exiting 1.
    let detail = (res.stderr || "").trim().split("\n").filter(Boolean).pop() || "";
    try {
      detail = JSON.parse((res.stdout || "").trim()).error || detail;
    } catch {
      /* keep the stderr tail */
    }
    return unavailable(`gate failed: ${String(detail).slice(0, 200)}`, { wallMs });
  }

  let parsed;
  try {
    parsed = JSON.parse((res.stdout || "").trim());
  } catch {
    return unavailable("gate returned non-JSON", { wallMs });
  }
  const score = typeof parsed.ats_pass_probability === "number" ? parsed.ats_pass_probability : null;
  if (score === null) return unavailable("gate response missing ats_pass_probability", { wallMs });

  // Provider/timing land on stderr by design (decisions on stdout only).
  const meta = /provider=(\S+)\s+model=(\S+)\s+http_ms=(\d+)\s+total_ms=(\d+)\s+usage=(\{.*\})/.exec(res.stderr || "");
  let usage = null;
  if (meta) {
    try {
      usage = JSON.parse(meta[5]);
    } catch {
      /* usage is advisory only */
    }
  }

  return {
    decision: "available",
    score,
    hasCoreSkills: parsed.has_core_skills === true,
    band: bandFor(score, cfg.bands),
    provider: meta ? meta[1] : "unknown",
    model: meta ? meta[2] : "unknown",
    httpMs: meta ? Number(meta[3]) : wallMs,
    wallMs,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
  };
}
