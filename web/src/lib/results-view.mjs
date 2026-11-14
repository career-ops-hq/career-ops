/**
 * results-view.mjs — filter and multi-key sort for Explore's result list.
 *
 * Pure functions, no I/O, no React: the component keeps the choices (query,
 * hidden fit bands, sort keys) as local state and calls applyResultsView() to
 * get the rows to draw. Kept as plain .mjs like title-fit.mjs so it can be
 * unit-tested without a browser.
 *
 * Contract with the fit band (#3260 / #3261):
 *   - The band is still only an estimate. Nothing here runs unless the user
 *     picks a filter or a sort key; the defaults (every band shown, Fresh newest
 *     first) reproduce the order Explore always had.
 *   - Offers with no fit band (AI-search results, or no profile) are never hidden
 *     by the band filter, and always sort after offers that have one.
 *
 * @typedef {"strong" | "related" | "weak"} FitBand
 * @typedef {"fresh" | "title" | "company" | "fit"} SortKey
 * @typedef {"asc" | "desc"} SortDir
 * @typedef {{ key: SortKey, dir: SortDir }} SortSpec
 * @typedef {{ title: string, company: string, postedAt?: string, fit?: { band: FitBand } }} ViewOffer
 */

/** @type {FitBand[]} */
export const FIT_BANDS = ["strong", "related", "weak"];

/** @type {SortKey[]} */
export const SORT_KEYS = ["fresh", "title", "company", "fit"];

/** @type {Record<SortKey, string>} */
export const SORT_LABELS = { fresh: "Fresh", title: "Title", company: "Company", fit: "Fit" };

/** The order Explore has always used: newest posting first. */
export const DEFAULT_SORT = Object.freeze([Object.freeze({ key: "fresh", dir: "desc" })]);

/** Direction a key starts in when it is first picked. "desc" = newest / strongest first. */
const DEFAULT_DIR = { fresh: "desc", title: "asc", company: "asc", fit: "desc" };

const DIR_LABELS = {
  fresh: { desc: "Newest first", asc: "Oldest first" },
  title: { asc: "A–Z", desc: "Z–A" },
  company: { asc: "A–Z", desc: "Z–A" },
  fit: { desc: "Strongest first", asc: "Weakest first" },
};

// Higher = better match, so "desc" on fit puts strong first.
const FIT_VALUE = { strong: 3, related: 2, weak: 1 };

/**
 * Human label for a key's direction, e.g. ("fit", "desc") -> "Strongest first".
 * @param {SortKey} key
 * @param {SortDir} dir
 */
export function dirLabel(key, dir) {
  return DIR_LABELS[key]?.[dir] ?? dir;
}

/**
 * Offers per fit band; offers with no band are not counted.
 * @param {ViewOffer[]} offers
 * @returns {Record<FitBand, number>}
 */
export function countBands(offers) {
  const counts = { strong: 0, related: 0, weak: 0 };
  for (const o of offers) {
    const band = o.fit?.band;
    if (band && band in counts) counts[band] += 1;
  }
  return counts;
}

/**
 * Sort keys that make sense for this result set: Fit only when some offer has a band.
 * @param {ViewOffer[]} offers
 * @returns {SortKey[]}
 */
export function availableSortKeys(offers) {
  const hasFit = offers.some((o) => o.fit && o.fit.band in FIT_VALUE);
  return hasFit ? [...SORT_KEYS] : SORT_KEYS.filter((k) => k !== "fit");
}

/**
 * Clean a sort choice: drop unknown or unavailable keys and duplicates, fill a
 * missing direction with the key's default, and fall back to the default sort
 * when nothing is left (so there is always at least one key).
 * @param {unknown} spec
 * @param {SortKey[]} [available]
 * @returns {SortSpec[]}
 */
export function normalizeSort(spec, available = SORT_KEYS) {
  const seen = new Set();
  /** @type {SortSpec[]} */
  const out = [];
  for (const s of Array.isArray(spec) ? spec : []) {
    if (!s || !available.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, dir: s.dir === "asc" || s.dir === "desc" ? s.dir : DEFAULT_DIR[s.key] });
  }
  return out.length ? out : DEFAULT_SORT.map((s) => ({ ...s }));
}

/**
 * Tick or untick a sort key. A newly ticked key goes last in priority, in its
 * default direction. The last remaining key cannot be unticked.
 * @param {SortSpec[]} spec
 * @param {SortKey} key
 * @returns {SortSpec[]}
 */
export function toggleSortKey(spec, key) {
  const cur = normalizeSort(spec);
  if (!SORT_KEYS.includes(key)) return cur;
  if (cur.some((s) => s.key === key)) return cur.length === 1 ? cur : cur.filter((s) => s.key !== key);
  return [...cur, { key, dir: DEFAULT_DIR[key] }];
}

/**
 * Flip one key between ascending and descending, keeping its priority.
 * @param {SortSpec[]} spec
 * @param {SortKey} key
 * @returns {SortSpec[]}
 */
export function flipSortDir(spec, key) {
  return normalizeSort(spec).map((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : s));
}

/**
 * Compact label for the sort button, e.g. "Fit ↓ › Company ↑" (↓ = descending).
 * @param {SortSpec[]} spec
 */
export function sortSummary(spec) {
  return normalizeSort(spec)
    .map((s) => `${SORT_LABELS[s.key]} ${s.dir === "asc" ? "↑" : "↓"}`)
    .join(" › ");
}

/**
 * Show or hide one fit band. Returns a new set; the input is not changed.
 * @param {ReadonlySet<FitBand>} hidden
 * @param {FitBand} band
 * @returns {Set<FitBand>}
 */
export function toggleBand(hidden, band) {
  const next = new Set(hidden);
  if (next.has(band)) next.delete(band);
  else next.add(band);
  return next;
}

// A value of undefined or "" means "unknown": those rows sort last in either direction.
function sortValue(key, o) {
  switch (key) {
    case "fresh":
      return o.postedAt || undefined;
    case "title":
      return o.title || undefined;
    case "company":
      return o.company || undefined;
    case "fit":
      return o.fit ? FIT_VALUE[o.fit.band] : undefined;
    default:
      return undefined;
  }
}

function compareBy(key, dir, a, b) {
  const va = sortValue(key, a);
  const vb = sortValue(key, b);
  if (va === undefined && vb === undefined) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
  return dir === "desc" ? -c : c;
}

/**
 * The rows to draw: text filter, then fit-band filter, then the multi-key sort.
 * Ties on every key keep the incoming order. The input array is not changed.
 * @template {ViewOffer} T
 * @param {T[]} offers
 * @param {{ query?: string, hiddenBands?: ReadonlySet<FitBand>, sort?: SortSpec[] }} [view]
 * @returns {T[]}
 */
export function applyResultsView(offers, { query = "", hiddenBands = new Set(), sort = [...DEFAULT_SORT] } = {}) {
  const needle = String(query).trim().toLowerCase();
  const spec = normalizeSort(sort);
  return offers
    .filter((o) => {
      if (needle && !(String(o.title ?? "").toLowerCase().includes(needle) || String(o.company ?? "").toLowerCase().includes(needle))) {
        return false;
      }
      return !(o.fit && hiddenBands.has(o.fit.band));
    })
    .map((o, i) => [o, i])
    .sort(([a, ai], [b, bi]) => {
      for (const { key, dir } of spec) {
        const d = compareBy(key, dir, a, b);
        if (d) return d;
      }
      return ai - bi;
    })
    .map(([o]) => o);
}
