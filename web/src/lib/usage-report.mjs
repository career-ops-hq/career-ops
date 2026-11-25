// Usage report for the /usage page: what career-ops spent, on what, and how long it took.
//
// Source: Claude Code's own session logs (~/.claude/projects/<project>/**/*.jsonl).
// Every assistant message there carries its model and token usage, so nothing
// new has to be recorded. A project folder counts as career-ops when its name
// mentions career-ops (the app's cwd, plus setup chats run from scratch folders);
// the throwaway folders the plan-limit lookup creates (-tmp-career-ops-usage-*)
// hold no model calls and are skipped.
//
// Each session file is summarised once and kept until its size or mtime changes.
// Dollar amounts are API list-price equivalents: on a subscription nothing is
// billed per token, but the figure shows the relative weight of each activity.

import fsPromises from "node:fs/promises";
import path from "node:path";

const DAY = 24 * 3600 * 1000;

// USD per million tokens. Cache writes cost 1.25x input (5-minute TTL) or 2x (1-hour TTL).
export const PRICES = {
  opus: { label: "Opus", input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { label: "Sonnet", input: 2, output: 10, cacheRead: 0.1 },
  haiku: { label: "Haiku", input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function modelFamily(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return null; // "<synthetic>" error stubs and unknown models
}

export const KINDS = {
  batch: "Batch scoring",
  evaluation: "Evaluations",
  documents: "CV, PDFs & cover letters",
  assistant: "Assistant chat",
  chat: "Your Claude Code sessions",
  other: "Other app runs",
};

/** Which activity a session was, from its first prompt and how it was started. */
export function classifySession(prompt, entrypoint) {
  const p = String(prompt || "");
  if (/single-pass CV match mode|batch-jd-\d+/i.test(p)) return "batch";
  if (/OFFICIAL career-ops job evaluation|^Process this job offer/i.test(p)) return "evaluation";
  if (/career-ops assistant/i.test(p)) return "assistant";
  if (/cover letter|convert a person's CV|tailor(ed)? (the )?CV|\bPDF\b/i.test(p)) return "documents";
  if (entrypoint === "sdk-cli") return "other";
  return "chat";
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Token counts of one usage block, cache writes split by TTL when known. */
export function usageParts(u) {
  const cc = u?.cache_creation;
  const write1h = num(cc?.ephemeral_1h_input_tokens);
  const write5m = cc ? num(cc.ephemeral_5m_input_tokens) : num(u?.cache_creation_input_tokens);
  return {
    input: num(u?.input_tokens),
    output: num(u?.output_tokens),
    cacheRead: num(u?.cache_read_input_tokens),
    cacheWrite: write5m + write1h,
    write5m,
    write1h,
  };
}

export function costUsd(family, t) {
  const p = PRICES[family];
  if (!p) return 0;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.write5m * p.input * 1.25 + t.write1h * p.input * 2) / 1e6;
}

function promptText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join(" ");
  return "";
}

const REPORT_RE = /reports\/(\d{3})-([a-z0-9-]+?)-\d{4}-\d{2}-\d{2}\.md/i;

function titleCase(slug) {
  return slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Summarise one session log. Returns null for a file with no prompt. */
export function summarizeSession(text, id) {
  let prompt = null;
  let entrypoint = null;
  let first = Infinity;
  let last = -Infinity;
  let report = null;
  // Claude Code writes one API message several times (one line per streamed
  // block, again on resume); key by message id + request id, keep the largest.
  const messages = new Map();
  let anon = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = d?.timestamp ? Date.parse(d.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (ts < first) first = ts;
      if (ts > last) last = ts;
    }
    if (prompt === null && d?.type === "user" && !d.isSidechain && d.message) {
      prompt = promptText(d.message.content);
      entrypoint = d.entrypoint ?? null;
    }
    if (!report && line.includes("reports/")) {
      const m = line.match(REPORT_RE);
      if (m) report = { num: m[1], company: titleCase(m[2]) };
    }
    const msg = d?.message;
    if (!msg?.usage || Number.isNaN(ts)) continue;
    const family = modelFamily(msg.model);
    if (!family) continue;
    const parts = usageParts(msg.usage);
    const key = msg.id ? `${msg.id}:${d.requestId ?? ""}` : `anon-${anon++}`;
    const total = parts.input + parts.output + parts.cacheRead + parts.cacheWrite;
    const prev = messages.get(key);
    if (!prev || total > prev.total) messages.set(key, { ts, family, total, ...parts });
  }
  if (prompt === null) return null;
  const kind = classifySession(prompt, entrypoint);
  const events = [...messages.values()].map((m) => ({ ...m, usd: costUsd(m.family, m) }));
  const families = {};
  for (const e of events) families[e.family] = (families[e.family] || 0) + e.total;
  const mainFamily = Object.entries(families).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return {
    id,
    kind,
    label: report ? `${report.company} · #${report.num}` : kind === "chat" || kind === "assistant" ? oneLine.slice(0, 70) : "",
    start: Number.isFinite(first) ? first : 0,
    end: Number.isFinite(last) ? last : 0,
    family: mainFamily,
    failed: events.length === 0,
    events,
  };
}

async function* walk(fs, dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(fs, p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

export function isCareerOpsProject(name) {
  return /career-?ops/i.test(name) && !/^-tmp-career-ops-usage-/.test(name);
}

/** Session summaries for every career-ops project, re-reading only changed files. */
export function createSessionStore({ root, fs = fsPromises }) {
  const cache = new Map();
  return async function sessions() {
    let projects = [];
    try {
      projects = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && isCareerOpsProject(e.name));
    } catch {
      return [];
    }
    const seen = new Set();
    const out = [];
    for (const proj of projects) {
      for await (const file of walk(fs, path.join(root, proj.name))) {
        let st;
        try {
          st = await fs.stat(file);
        } catch {
          continue;
        }
        seen.add(file);
        let hit = cache.get(file);
        if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
          let text;
          try {
            text = await fs.readFile(file, "utf8");
          } catch {
            continue;
          }
          // Subagent logs (…/subagents/*.jsonl) belong to their parent session's activity.
          const isSub = file.includes(`${path.sep}subagents${path.sep}`);
          const summary = summarizeSession(text, path.basename(file, ".jsonl"));
          if (summary && isSub) summary.subagentOf = path.basename(path.dirname(path.dirname(file)));
          hit = { size: st.size, mtimeMs: st.mtimeMs, summary };
          cache.set(file, hit);
        }
        if (hit.summary) out.push(hit.summary);
      }
    }
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
    // Fold subagent sessions into their parent so a run is one row.
    const byId = new Map(out.filter((s) => !s.subagentOf).map((s) => [s.id, s]));
    const orphans = [];
    for (const s of out) {
      if (!s.subagentOf) continue;
      const parent = byId.get(s.subagentOf);
      if (!parent) {
        orphans.push(s); // its parent log is gone: keep it as its own row
        continue;
      }
      // A new object: the cached parent summary must not accumulate across calls.
      byId.set(parent.id, { ...parent, events: parent.events.concat(s.events), end: Math.max(parent.end, s.end), failed: parent.failed && !s.events.length });
    }
    return [...byId.values(), ...orphans];
  };
}

const RANGES = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, all: Infinity };
export function resolveRange(v) {
  return typeof v === "string" && v in RANGES ? v : "7d";
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, usd: 0 };
}
function addTokens(acc, e) {
  acc.input += e.input;
  acc.output += e.output;
  acc.cacheRead += e.cacheRead;
  acc.cacheWrite += e.cacheWrite;
  acc.total += e.total;
  acc.usd += e.usd;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Aggregate sessions into everything the page shows. */
export function buildReport(sessions, { range = "7d", now = Date.now() } = {}) {
  const span = RANGES[range] ?? RANGES["7d"];
  const from = now - span;
  const prevFrom = now - 2 * span;
  const totals = emptyTokens();
  let prevUsd = 0;
  const byKind = {};
  const byFamily = {};
  const daily = new Map();
  const runs = [];
  for (const s of sessions) {
    const inRange = s.events.filter((e) => e.ts >= from);
    for (const e of s.events) if (Number.isFinite(span) && e.ts >= prevFrom && e.ts < from) prevUsd += e.usd;
    const startedInRange = s.start >= from;
    if (!inRange.length && !(s.failed && startedInRange)) continue;
    const t = emptyTokens();
    for (const e of inRange) {
      addTokens(t, e);
      addTokens(totals, e);
      byFamily[e.family] ??= emptyTokens();
      addTokens(byFamily[e.family], e);
      const k = dayKey(e.ts);
      daily.set(k, (daily.get(k) || 0) + e.usd);
    }
    const kind = (byKind[s.kind] ??= { ...emptyTokens(), runs: 0, failed: 0, ms: 0 });
    addTokens(kind, t);
    kind.runs += 1;
    if (s.failed) kind.failed += 1;
    const ms = Math.max(0, s.end - s.start);
    kind.ms += ms;
    runs.push({ id: s.id, kind: s.kind, label: s.label, start: s.start, ms, family: s.family, failed: s.failed, ...t });
  }
  runs.sort((a, b) => b.start - a.start);

  // Daily series: one bar per day, at most 30, ending today.
  const days = Math.min(30, Number.isFinite(span) ? Math.max(1, Math.round(span / DAY)) : 30);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * DAY;
    series.push({ day: dayKey(ts), ts, usd: daily.get(dayKey(ts)) || 0 });
  }

  const totalMs = runs.reduce((a, r) => a + r.ms, 0);
  const scored = (byKind.batch?.runs || 0) - (byKind.batch?.failed || 0) + (byKind.evaluation?.runs || 0) - (byKind.evaluation?.failed || 0);
  const scoredUsd = (byKind.batch?.usd || 0) + (byKind.evaluation?.usd || 0);
  const failed = runs.filter((r) => r.failed).length;
  const inputSide = totals.input + totals.cacheRead + totals.cacheWrite;

  return {
    range,
    totals,
    prevUsd: Number.isFinite(span) ? prevUsd : null,
    cachedPct: inputSide ? (totals.cacheRead / inputSide) * 100 : 0,
    runCount: runs.length,
    failed,
    totalMs,
    avgMs: runs.length ? totalMs / runs.length : 0,
    scored,
    usdPerScored: scored ? scoredUsd / scored : null,
    byKind: Object.entries(byKind).map(([kind, v]) => ({ kind, label: KINDS[kind] ?? kind, ...v })).sort((a, b) => b.usd - a.usd),
    byFamily: Object.entries(byFamily).map(([family, v]) => ({ family, label: PRICES[family]?.label ?? family, ...v })).sort((a, b) => b.usd - a.usd),
    series,
    runs,
    tips: buildTips({ byKind, runs, failed }),
  };
}

function buildTips({ byKind, runs, failed }) {
  const tips = [];
  const evals = runs.filter((r) => r.kind === "evaluation" && !r.failed);
  const batch = runs.filter((r) => r.kind === "batch" && !r.failed);
  if (evals.length && batch.length) {
    const e = evals.reduce((a, r) => a + r.usd, 0) / evals.length;
    const b = batch.reduce((a, r) => a + r.usd, 0) / batch.length;
    if (b > 0 && e / b >= 3) tips.push(`A full evaluation costs about ${Math.round(e / b)}× a batch score ($${e.toFixed(2)} vs $${b.toFixed(2)}). Score in batch first and run full evaluations only on the best matches.`);
  }
  const heavy = evals.filter((r) => r.family === "opus").length;
  if (heavy) tips.push(`${heavy} evaluation${heavy === 1 ? "" : "s"} ran on Opus. The economy or standard spend tier (Haiku, Sonnet) costs a fraction of that.`);
  if (failed) tips.push(`${failed} run${failed === 1 ? "" : "s"} ended without a model answer (login, limit or startup errors). They cost nothing but did no work.`);
  const chat = byKind.chat;
  const total = Object.values(byKind).reduce((a, v) => a + v.usd, 0);
  if (chat && total && chat.usd / total > 0.5) tips.push(`Your own Claude Code sessions are ${Math.round((chat.usd / total) * 100)}% of the total. Long chats on Opus are the biggest lever; /model sonnet for routine work.`);
  return tips;
}
