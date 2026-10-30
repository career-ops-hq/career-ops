/**
 * The CV Studio's domain: one tailored CV, the base CV it came from, and the
 * user's edits on top.
 *
 * StudioDoc is derived and never stored. It is rebuilt from the tailored HTML,
 * cv.md, and the report's keywords on every load. StudioEdits is the only thing
 * the Studio persists, and it is bound to the tailored HTML it was made
 * against through sourceHash, so a regenerated CV never inherits edits that
 * point at bullets it no longer has.
 *
 * Pure and dependency-free so the page, the API routes, and node --test all
 * share one implementation.
 *
 * @typedef {import("./html-blocks.mjs").BlockTree} BlockTree
 * @typedef {import("./base-cv.mjs").BaseCv} BaseCv
 *
 * @typedef {"same"|"edited"|"new"} Change
 * @typedef {{id: string, tailored: string, base: string|null, change: Change, similarity: number,
 *            keywords: {tailored: string[], base: string[]}, drivenBy: string[]}} StudioBullet
 * @typedef {{text: string, keywords: string[]}} Restorable
 * @typedef {{id: string, kind: "entry"|"tag"|"text", label: string, ownKeywords: string[],
 *            bullets: StudioBullet[], restorable: Restorable[]}} StudioItem
 * @typedef {{id: string, title: string, kind: string, items: StudioItem[]}} StudioSection
 * @typedef {{sourceHash: string, keywords: string[], fixedKeywords: string[], sections: StudioSection[]}} StudioDoc
 *
 * @typedef {{kind: "tailored"}|{kind: "base"}|{kind: "custom", text: string, keywords: string[]}} BulletUse
 * @typedef {{length: "full"|"one-page", tone: "tailored"|"conservative"}} Preset
 * @typedef {{v: 1, sourceHash: string, preset: Preset, use: Record<string, BulletUse>,
 *            hidden: string[], shown: string[], order: Record<string, string[]>, restored: Record<string, number[]>}} StudioEdits
 */

export const DEFAULT_PRESET = Object.freeze({ length: "full", tone: "tailored" });
const MATCH_FLOOR = 0.3;
const HEAVY_EDIT = 0.6;
const ONE_PAGE = { firstEntryBullets: 3, otherEntryBullets: 2, projects: 2 };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}+#.%$/-]*/gu;

/** @param {string} text */
function words(text) {
  return (text.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/[.]+$/, ""));
}

/** Jaccard overlap of two texts' word sets, 0 to 1. */
export function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

function sameCompany(a, b) {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Pair each tailored bullet with the base bullet it was most likely rewritten
 * from. Greedy on the best remaining pair, so two tailored bullets never claim
 * the same original.
 *
 * @param {string[]} tailored
 * @param {string[]} base
 * @returns {{pairs: (number|null)[], scores: number[], unused: number[]}}
 */
export function alignBullets(tailored, base) {
  const cells = [];
  tailored.forEach((t, i) => base.forEach((b, j) => cells.push({ i, j, s: similarity(t, b) })));
  cells.sort((x, y) => y.s - x.s);
  const pairs = tailored.map(() => null);
  const scores = tailored.map(() => 0);
  const taken = new Set();
  for (const { i, j, s } of cells) {
    if (s < MATCH_FLOOR) break;
    if (pairs[i] !== null || taken.has(j)) continue;
    pairs[i] = j;
    scores[i] = s;
    taken.add(j);
  }
  return { pairs, scores, unused: base.map((_, j) => j).filter((j) => !taken.has(j)) };
}

/**
 * @param {{tree: BlockTree, base: BaseCv, keywords: string[], sourceHash: string,
 *          keywordsIn: (text: string) => string[], itemText: (itemId: string) => string, fixedText: string}} input
 * @returns {StudioDoc}
 */
export function buildStudioDoc({ tree, base, keywords, sourceHash, keywordsIn, itemText, fixedText }) {
  const bullet = (b, original, score) => {
    const kt = keywordsIn(b.text);
    const kb = original === null ? [] : keywordsIn(original);
    const change = original === null ? "new" : original.trim() === b.text.trim() ? "same" : "edited";
    return { id: b.id, tailored: b.text, base: original, change, similarity: original === null ? 0 : score, keywords: { tailored: kt, base: kb }, drivenBy: kt.filter((k) => !kb.includes(k)) };
  };
  const sections = tree.sections.map((s) => ({
    id: s.id,
    title: s.title,
    kind: s.kind,
    items: s.items.map((item) => {
      const ownKeywords = item.kind === "text" ? [] : keywordsIn(itemText(item.id));
      if (s.kind === "summary") {
        const b = item.bullets[0];
        const original = base.summary;
        return { id: item.id, kind: item.kind, label: item.label, ownKeywords, bullets: [bullet(b, original, original ? similarity(b.text, original) : 0)], restorable: [] };
      }
      const entry = item.kind === "entry" && s.kind === "experience" ? base.entries.find((e) => sameCompany(e.company, item.label)) : undefined;
      const originals = entry?.bullets ?? [];
      const { pairs, scores, unused } = alignBullets(item.bullets.map((b) => b.text), originals);
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        ownKeywords,
        bullets: item.bullets.map((b, k) => bullet(b, pairs[k] === null ? null : originals[pairs[k]], scores[k])),
        restorable: item.bullets.length ? unused.map((j) => ({ text: originals[j], keywords: keywordsIn(originals[j]) })) : [],
      };
    }),
  }));
  return { sourceHash, keywords, fixedKeywords: keywordsIn(fixedText), sections };
}

/** @param {string} sourceHash @returns {StudioEdits} */
export function emptyEdits(sourceHash) {
  return { v: 1, sourceHash, preset: { ...DEFAULT_PRESET }, use: {}, hidden: [], shown: [], order: {}, restored: {} };
}

/**
 * Edits saved against another version of the tailored CV are dropped rather
 * than misapplied to whatever bullets now sit at the same ids. Null when `raw`
 * is not a v1 edits object at all.
 *
 * @param {unknown} raw
 * @param {string} sourceHash
 * @returns {{edits: StudioEdits, stale: boolean} | null}
 */
export function parseEdits(raw, sourceHash) {
  const r = /** @type {any} */ (raw);
  if (!r || r.v !== 1 || typeof r.sourceHash !== "string") return null;
  if (r.sourceHash !== sourceHash) return { edits: emptyEdits(sourceHash), stale: true };
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const record = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const use = Object.fromEntries(
    Object.entries(record(r.use))
      .filter(([, u]) => u && (u.kind === "base" || u.kind === "tailored" || (u.kind === "custom" && typeof u.text === "string")))
      .map(([k, u]) => [k, u.kind === "custom" ? { kind: "custom", text: u.text, keywords: strings(u.keywords) } : { kind: u.kind }]),
  );
  return {
    edits: {
      v: 1,
      sourceHash,
      preset: {
        length: r.preset?.length === "one-page" ? "one-page" : "full",
        tone: r.preset?.tone === "conservative" ? "conservative" : "tailored",
      },
      use,
      hidden: strings(r.hidden),
      shown: strings(r.shown),
      order: Object.fromEntries(Object.entries(record(r.order)).map(([k, v]) => [k, strings(v)])),
      restored: Object.fromEntries(Object.entries(record(r.restored)).map(([k, v]) => [k, Array.isArray(v) ? v.filter(Number.isInteger) : []])),
    },
    stale: false,
  };
}

/**
 * @typedef {{type: "use", id: string, use: BulletUse}
 *   | {type: "toggle", id: string}
 *   | {type: "move", parent: string, id: string, by: -1|1, siblings: string[]}
 *   | {type: "restore", item: string, index: number}
 *   | {type: "unrestore", item: string, index: number}
 *   | {type: "preset", preset: Partial<Preset>}
 *   | {type: "reset"}} StudioAction
 */

/**
 * @param {StudioEdits} edits
 * @param {StudioAction} action
 * @param {StudioDoc} doc
 * @returns {StudioEdits}
 */
export function studioReducer(edits, action, doc) {
  switch (action.type) {
    case "use":
      return { ...edits, use: { ...edits.use, [action.id]: action.use } };
    case "toggle": {
      const isHidden = hiddenSet(doc, edits).has(action.id);
      const presetHides = presetHidden(doc, edits.preset).has(action.id);
      const without = (list) => list.filter((x) => x !== action.id);
      if (isHidden) return { ...edits, hidden: without(edits.hidden), shown: presetHides ? [...without(edits.shown), action.id] : without(edits.shown) };
      return { ...edits, hidden: presetHides ? edits.hidden : [...without(edits.hidden), action.id], shown: without(edits.shown) };
    }
    case "move": {
      const order = [...(edits.order[action.parent] ?? action.siblings)];
      for (const id of action.siblings) if (!order.includes(id)) order.push(id);
      const from = order.indexOf(action.id);
      const to = from + action.by;
      if (from < 0 || to < 0 || to >= order.length) return edits;
      [order[from], order[to]] = [order[to], order[from]];
      return { ...edits, order: { ...edits.order, [action.parent]: order } };
    }
    case "restore": {
      const list = edits.restored[action.item] ?? [];
      return list.includes(action.index) ? edits : { ...edits, restored: { ...edits.restored, [action.item]: [...list, action.index] } };
    }
    case "unrestore":
      return { ...edits, restored: { ...edits.restored, [action.item]: (edits.restored[action.item] ?? []).filter((i) => i !== action.index) } };
    case "preset":
      return { ...edits, preset: { ...edits.preset, ...action.preset } };
    case "reset":
      return emptyEdits(edits.sourceHash);
  }
}

/**
 * The ids a length preset hides. Derived on every read instead of written into
 * `hidden`, so switching back to full length restores exactly what the preset
 * took away and nothing the user hid by hand.
 *
 * @param {StudioDoc} doc
 * @param {Preset} preset
 */
export function presetHidden(doc, preset) {
  const out = new Set();
  if (preset.length !== "one-page") return out;
  for (const s of doc.sections) {
    if (s.kind === "experience") {
      s.items.forEach((item, k) => {
        const keep = k === 0 ? ONE_PAGE.firstEntryBullets : ONE_PAGE.otherEntryBullets;
        item.bullets.slice(keep).forEach((b) => out.add(b.id));
      });
    }
    if (s.kind === "projects") s.items.slice(ONE_PAGE.projects).forEach((i) => out.add(i.id));
  }
  return out;
}

/** @param {StudioDoc} doc @param {StudioEdits} edits */
export function hiddenSet(doc, edits) {
  const out = presetHidden(doc, edits.preset);
  for (const id of edits.shown) out.delete(id);
  for (const id of edits.hidden) out.add(id);
  return out;
}

/**
 * Which wording a bullet shows. An explicit choice wins. Without one, the
 * conservative tone keeps the original wherever the tailor rewrote heavily.
 *
 * @param {StudioBullet} b
 * @param {StudioEdits} edits
 * @returns {{source: "tailored"|"base"|"custom", text: string, keywords: string[]}}
 */
export function bulletShown(b, edits) {
  const use = edits.use[b.id];
  if (use?.kind === "custom") return { source: "custom", text: use.text, keywords: use.keywords };
  const wantBase = use ? use.kind === "base" : edits.preset.tone === "conservative" && b.change === "edited" && b.similarity < HEAVY_EDIT;
  if (wantBase && b.base !== null) return { source: "base", text: b.base, keywords: b.keywords.base };
  return { source: "tailored", text: b.tailored, keywords: b.keywords.tailored };
}

/**
 * Everything the preview and the coverage meter need, from one walk.
 *
 * @param {StudioDoc} doc
 * @param {StudioEdits} edits
 * @returns {{view: import("./html-blocks.mjs").BlockView, added: Record<string, string[]>,
 *            coverage: {present: string[], missing: string[], pct: number|null}}}
 */
export function resolveStudio(doc, edits) {
  const hidden = hiddenSet(doc, edits);
  const text = {};
  const added = {};
  const found = new Set(doc.fixedKeywords);
  for (const s of doc.sections) {
    const visibleItems = s.items.filter((i) => !hidden.has(i.id));
    if (!hidden.has(s.id)) {
      for (const item of visibleItems) {
        item.ownKeywords.forEach((k) => found.add(k));
        for (const b of item.bullets) {
          const shown = bulletShown(b, edits);
          if (shown.source !== "tailored") text[b.id] = shown.text;
          if (!hidden.has(b.id)) shown.keywords.forEach((k) => found.add(k));
        }
        const restored = (edits.restored[item.id] ?? []).map((i) => item.restorable[i]).filter(Boolean);
        if (restored.length) {
          added[item.id] = restored.map((r) => r.text);
          restored.forEach((r) => r.keywords.forEach((k) => found.add(k)));
        }
      }
    }
  }
  const present = doc.keywords.filter((k) => found.has(k));
  const missing = doc.keywords.filter((k) => !found.has(k));
  return {
    view: { hidden, order: edits.order, text },
    added,
    coverage: { present, missing, pct: doc.keywords.length ? Math.round((present.length / doc.keywords.length) * 100) : null },
  };
}

/**
 * Word-level diff for the inline before and after view.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{op: "same"|"del"|"ins", text: string}[]}
 */
export function wordDiff(before, after) {
  const tokens = (t) => t.match(/\s+|[,;:](?=\s|$)|[^\s,;:]+|[,;:]/g) ?? [];
  const a = tokens(before);
  const b = tokens(after);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (op, text) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", a[i++]);
    else push("ins", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return readableRuns(out);
}

const SHORT_SAME = 2;

/**
 * A raw word diff of a rewrite interleaves small matches ("the", ",") between
 * changes and reads as noise. Short unchanged stretches between two changes
 * are folded into the change, and each change prints as all removed words,
 * then all inserted words.
 *
 * @param {{op: "same"|"del"|"ins", text: string}[]} parts
 */
function readableRuns(parts) {
  const isShort = (t) => t.trim().split(/\s+/).filter(Boolean).length <= SHORT_SAME;
  const out = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del) out.push({ op: "del", text: del });
    if (ins) out.push({ op: "ins", text: ins });
    del = "";
    ins = "";
  };
  parts.forEach((p, k) => {
    if (p.op === "del") del += p.text;
    else if (p.op === "ins") ins += p.text;
    else if (
      (del || ins) &&
      k < parts.length - 1 &&
      isShort(p.text) &&
      ((parts[k - 1]?.op === "del" && parts[k + 1]?.op === "ins") ||
        (parts[k - 1]?.op === "ins" && parts[k + 1]?.op === "del"))
    ) {
      del += p.text;
      ins += p.text;
    } else {
      flush();
      out.push(p);
    }
  });
  flush();
  return out;
}
