import { pipelineTab } from "./pipeline-navigation.mjs";

export const VIEW_LIMIT = 8;
export const SCORE_FLOORS = [3.5, 4, 4.2];
export const PIPELINE_SORT_KEYS = ["tracker", "company", "role", "score", "status", "date"];

/** @param {unknown} input */
export function normalizeView(input) {
  if (!input || typeof input !== "object") return null;
  const raw = /** @type {Record<string, unknown>} */ (input);
  if (typeof raw.name !== "string") return null;
  const name = raw.name.trim();
  if (!name || name.length > 40) return null;
  let min = null;
  if (raw.min != null && raw.min !== "") {
    if (typeof raw.min !== "number" && typeof raw.min !== "string") return null;
    min = typeof raw.min === "number" ? raw.min : Number(raw.min);
    if (!Number.isFinite(min)) return null;
  }
  const sort = typeof raw.sort === "string" && PIPELINE_SORT_KEYS.includes(raw.sort) ? raw.sort : "score";
  return {
    name,
    tab: pipelineTab(typeof raw.tab === "string" ? raw.tab : undefined),
    q: typeof raw.q === "string" ? raw.q.slice(0, 200) : "",
    min,
    sort,
    dir: raw.dir === 1 || raw.dir === "1" ? 1 : -1,
  };
}

/** @param {string | null | undefined} raw */
export function parseViews(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const item of data) {
    const view = normalizeView(item);
    if (!view || out.some((existing) => existing.name === view.name)) continue;
    out.push(view);
    if (out.length === VIEW_LIMIT) break;
  }
  return out;
}

/** @param {NonNullable<ReturnType<typeof normalizeView>>[]} views @param {unknown} input */
export function upsertView(views, input) {
  const view = normalizeView(input);
  if (!view) return views;
  const exists = views.some((item) => item.name === view.name);
  const rest = views.filter((item) => item.name !== view.name);
  if (!exists && rest.length >= VIEW_LIMIT) return views;
  return [...rest, view];
}

/** @param {NonNullable<ReturnType<typeof normalizeView>>[]} views @param {string} name */
export function removeView(views, name) {
  return views.filter((view) => view.name !== name);
}

/** @param {NonNullable<ReturnType<typeof normalizeView>>} view */
export function viewUpdates(view) {
  return {
    tab: view.tab === "INBOX" ? null : view.tab,
    q: view.q ? view.q : null,
    min: view.min,
    sort: view.sort,
    dir: view.dir,
  };
}
