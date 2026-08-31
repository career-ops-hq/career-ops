/**
 * Pipeline Sankey graph + layout (pure, no fs).
 *
 * Snapshot of current tracker status, with status-log overlays so a later
 * Rejected/Discarded does not erase Interview/Offer/Hired that already happened.
 * stats.mjs everInterview cannot see that path; this chart can.
 */

/** @typedef {{ n: string|number, status: string }} SankeyApp */
/** @typedef {{ num: number, from: string, to: string }} SankeyLogRow */
/** @typedef {{ id: string, label: string, rank: number, tone: string, value: number }} SankeyNode */
/** @typedef {{ source: string, target: string, value: number }} SankeyLink */

export const NODE_DEFS = [
  { id: "tracked", label: "Tracked", rank: 0, tone: "neutral" },
  { id: "skip", label: "SKIP", rank: 1, tone: "danger" },
  { id: "evaluated", label: "Still evaluated", rank: 1, tone: "muted" },
  { id: "submitted", label: "Submitted", rank: 1, tone: "info" },
  { id: "waiting", label: "Waiting", rank: 2, tone: "warn" },
  { id: "engaged", label: "Company engaged", rank: 2, tone: "info" },
  { id: "rejectedApply", label: "Rejected (no interview)", rank: 2, tone: "danger" },
  { id: "discarded", label: "Discarded", rank: 2, tone: "muted" },
  { id: "screening", label: "Screening", rank: 3, tone: "info" },
  { id: "interview", label: "Interview", rank: 3, tone: "success" },
  { id: "offer", label: "Offer", rank: 3, tone: "success" },
  { id: "hired", label: "Hired", rank: 3, tone: "success" },
  { id: "rejectedInterview", label: "Rejected after interview", rank: 3, tone: "danger" },
  { id: "discardedInterview", label: "Discarded after interview", rank: 3, tone: "muted" },
];

const ADVANCED = new Set(["INTERVIEW", "OFFER", "HIRED"]);

const LEAVES = [
  "skip",
  "evaluated",
  "waiting",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejectedApply",
  "rejectedInterview",
  "discarded",
  "discardedInterview",
];

/**
 * First canonical status token. "Interview 2026-08-20" → INTERVIEW.
 * @param {string} raw
 * @returns {string}
 */
export function statusToken(raw) {
  const c = String(raw ?? "")
    .replace(/\*\*/g, "")
    .trim()
    .toUpperCase();
  if (!c || c === "—" || c === "-") return "DISCARDED";
  return c.split(/[\s/]/)[0] || "EVALUATED";
}

/**
 * Parse data/status-log.tsv. Skips a header row (non-numeric col 0).
 * @param {string} tsv
 * @returns {Array<{num: number, date: string, from: string, to: string, source: string, note: string}>}
 */
export function parseStatusLog(tsv) {
  const rows = [];
  for (const line of String(tsv ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (!/^\d+$/.test(cols[0] ?? "")) continue;
    rows.push({
      num: Number(cols[0]),
      date: cols[1] ?? "",
      from: cols[2] ?? "",
      to: cols[3] ?? "",
      source: cols[4] ?? "",
      note: cols[5] ?? "",
    });
  }
  return rows;
}

/**
 * @param {number} num
 * @param {SankeyLogRow[]} log
 * @returns {boolean}
 */
function logReachedAdvanced(num, log) {
  for (const row of log) {
    if (row.num !== num) continue;
    if (ADVANCED.has(statusToken(row.from)) || ADVANCED.has(statusToken(row.to))) return true;
  }
  return false;
}

/**
 * Exclusive leaf for one tracker row.
 * @param {SankeyApp} app
 * @param {SankeyLogRow[]} log
 * @returns {string}
 */
export function classifyLeaf(app, log) {
  const num = Number(app.n);
  const status = statusToken(app.status);
  const reachedInterview = ADVANCED.has(status) || logReachedAdvanced(num, log);

  if (status === "SKIP") return "skip";
  if (status === "EVALUATED") return "evaluated";
  if (status === "APPLIED") return "waiting";
  if (status === "RESPONDED") return "screening";
  if (status === "INTERVIEW") return "interview";
  if (status === "OFFER") return "offer";
  if (status === "HIRED") return "hired";
  if (status === "REJECTED") return reachedInterview ? "rejectedInterview" : "rejectedApply";
  if (status === "DISCARDED") return reachedInterview ? "discardedInterview" : "discarded";
  return "evaluated";
}

/**
 * @param {SankeyApp[]} apps
 * @param {SankeyLogRow[]} [log]
 * @returns {{ nodes: SankeyNode[], links: SankeyLink[], total: number }}
 */
export function buildPipelineSankey(apps, log = []) {
  const rows = Array.isArray(apps) ? apps : [];
  const ledger = Array.isArray(log) ? log : [];
  const counts = Object.fromEntries(LEAVES.map((id) => [id, 0]));
  for (const app of rows) {
    const leaf = classifyLeaf(app, ledger);
    counts[leaf] = (counts[leaf] ?? 0) + 1;
  }

  const engaged =
    counts.screening +
    counts.interview +
    counts.offer +
    counts.hired +
    counts.rejectedInterview +
    counts.discardedInterview;
  const submitted = counts.waiting + engaged + counts.rejectedApply + counts.discarded;
  const values = {
    tracked: rows.length,
    skip: counts.skip,
    evaluated: counts.evaluated,
    submitted,
    waiting: counts.waiting,
    engaged,
    rejectedApply: counts.rejectedApply,
    discarded: counts.discarded,
    screening: counts.screening,
    interview: counts.interview,
    offer: counts.offer,
    hired: counts.hired,
    rejectedInterview: counts.rejectedInterview,
    discardedInterview: counts.discardedInterview,
  };

  const nodes = NODE_DEFS.map((def) => ({ ...def, value: values[def.id] ?? 0 })).filter((n) => n.value > 0);

  const rawLinks = [
    { source: "tracked", target: "skip", value: values.skip },
    { source: "tracked", target: "evaluated", value: values.evaluated },
    { source: "tracked", target: "submitted", value: values.submitted },
    { source: "submitted", target: "waiting", value: values.waiting },
    { source: "submitted", target: "engaged", value: values.engaged },
    { source: "submitted", target: "rejectedApply", value: values.rejectedApply },
    { source: "submitted", target: "discarded", value: values.discarded },
    { source: "engaged", target: "screening", value: values.screening },
    { source: "engaged", target: "interview", value: values.interview },
    { source: "engaged", target: "offer", value: values.offer },
    { source: "engaged", target: "hired", value: values.hired },
    { source: "engaged", target: "rejectedInterview", value: values.rejectedInterview },
    { source: "engaged", target: "discardedInterview", value: values.discardedInterview },
  ];
  const live = new Set(nodes.map((n) => n.id));
  const links = rawLinks.filter((l) => l.value > 0 && live.has(l.source) && live.has(l.target));

  return { nodes, links, total: rows.length };
}

/**
 * Horizontal Sankey positions + ribbon paths. Empty nodes already dropped.
 * @param {{ nodes: SankeyNode[], links: SankeyLink[] }} graph
 * @param {{ width?: number, height?: number, padding?: { top: number, right: number, bottom: number, left: number }, nodeWidth?: number, nodeGap?: number }} [opts]
 */
export function layoutSankey(graph, opts = {}) {
  const width = opts.width ?? 920;
  const height = opts.height ?? 420;
  const padding = opts.padding ?? { top: 20, right: 168, bottom: 20, left: 96 };
  const nodeWidth = opts.nodeWidth ?? 18;
  const nodeGap = opts.nodeGap ?? 14;

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((n) => n.value > 0) : [];
  const links = Array.isArray(graph?.links) ? graph.links.filter((l) => l.value > 0) : [];
  if (nodes.length === 0) {
    return { nodes: [], links: [], width, height, scale: 0 };
  }

  const ranks = [...new Set(nodes.map((n) => n.rank))].sort((a, b) => a - b);
  const innerW = Math.max(1, width - padding.left - padding.right - nodeWidth);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const rankGap = ranks.length > 1 ? innerW / (ranks.length - 1) : 0;

  let scale = Infinity;
  for (const r of ranks) {
    const group = nodes.filter((n) => n.rank === r);
    const sum = group.reduce((s, n) => s + n.value, 0);
    const gaps = Math.max(0, group.length - 1) * nodeGap;
    if (sum > 0) scale = Math.min(scale, (innerH - gaps) / sum);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const order = new Map(NODE_DEFS.map((d, i) => [d.id, i]));
  const positioned = [];
  const byId = new Map();
  for (const r of ranks) {
    const group = nodes.filter((n) => n.rank === r).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const totalH = group.reduce((s, n) => s + n.value * scale, 0) + Math.max(0, group.length - 1) * nodeGap;
    let y = padding.top + Math.max(0, innerH - totalH) / 2;
    const x = padding.left + ranks.indexOf(r) * rankGap;
    for (const n of group) {
      const h = n.value * scale;
      const node = { ...n, x, y, width: nodeWidth, height: h };
      positioned.push(node);
      byId.set(n.id, node);
      y += h + nodeGap;
    }
  }

  const srcUsed = new Map(positioned.map((n) => [n.id, 0]));
  const tgtUsed = new Map(positioned.map((n) => [n.id, 0]));
  const ordered = [...links].sort((a, b) => {
    const sa = byId.get(a.source);
    const sb = byId.get(b.source);
    const ta = byId.get(a.target);
    const tb = byId.get(b.target);
    return (sa?.y ?? 0) - (sb?.y ?? 0) || (ta?.y ?? 0) - (tb?.y ?? 0);
  });

  const laidLinks = [];
  for (const l of ordered) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t) continue;
    const thick = l.value * scale;
    const sy0 = s.y + (srcUsed.get(s.id) ?? 0);
    const ty0 = t.y + (tgtUsed.get(t.id) ?? 0);
    srcUsed.set(s.id, (srcUsed.get(s.id) ?? 0) + thick);
    tgtUsed.set(t.id, (tgtUsed.get(t.id) ?? 0) + thick);
    const x0 = s.x + s.width;
    const x1 = t.x;
    const mx = (x0 + x1) / 2;
    const sy1 = sy0 + thick;
    const ty1 = ty0 + thick;
    const d = `M${x0},${sy0} C${mx},${sy0} ${mx},${ty0} ${x1},${ty0} L${x1},${ty1} C${mx},${ty1} ${mx},${sy1} ${x0},${sy1} Z`;
    laidLinks.push({ ...l, d, thickness: thick });
  }

  return { nodes: positioned, links: laidLinks, width, height, scale };
}
