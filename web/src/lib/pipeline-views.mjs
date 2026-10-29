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
    if (typeof raw.min === "string" && raw.min.trim() === "") return null;
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

/**
 * JSON to store after a user save or delete. Loading returns null so a page
 * that just read the list does not write it back over another tab.
 *
 * @param {"load" | "save" | "remove"} action
 * @param {NonNullable<ReturnType<typeof normalizeView>>[]} views
 * @returns {string | null}
 */
export function savedViewPayload(action, views) {
  if (action !== "save" && action !== "remove") return null;
  return JSON.stringify(Array.isArray(views) ? views : []);
}

/**
 * A save or delete starts from the list on disk, so another tab is not
 * overwritten. After a rejected write, names in `pending` keep the in-memory
 * copy. Every other name uses the stored copy, so this page does not write a
 * stale view back over the other tab. Omitting `pending` treats every
 * in-memory name as pending. A pending name that is not stored is added only
 * while the list is under the limit, so a full list from another tab is not
 * shortened. A successful write uses disk only, including a view the other
 * tab removed.
 *
 * @param {NonNullable<ReturnType<typeof normalizeView>>[]} memory
 * @param {NonNullable<ReturnType<typeof normalizeView>>[]} stored
 * @param {boolean} keepUnstored
 * @param {string[]} [omitted] names removed while storage was rejecting the write
 * @param {string[] | null} [pending] names this page changed while storage was rejecting. Null keeps every memory view.
 */
export function viewsForMutation(memory, stored, keepUnstored, omitted = [], pending = null) {
  const disk = Array.isArray(stored) ? stored.slice(0, VIEW_LIMIT) : [];
  if (!keepUnstored) return disk;
  const skip = new Set(Array.isArray(omitted) ? omitted : []);
  if (pending == null) {
    const names = new Set(memory.map((view) => view.name));
    const merged = memory.slice(0, VIEW_LIMIT);
    for (const view of disk) {
      if (merged.length === VIEW_LIMIT) break;
      if (names.has(view.name) || skip.has(view.name)) continue;
      merged.push(view);
    }
    return merged;
  }
  const pendingNames = new Set(Array.isArray(pending) ? pending : []);
  const memoryByName = new Map();
  for (const view of Array.isArray(memory) ? memory : []) {
    if (view && typeof view.name === "string" && !memoryByName.has(view.name)) memoryByName.set(view.name, view);
  }
  const merged = [];
  const seen = new Set();
  const take = (view) => {
    if (!view || typeof view.name !== "string") return;
    if (merged.length === VIEW_LIMIT || seen.has(view.name) || skip.has(view.name)) return;
    seen.add(view.name);
    merged.push(view);
  };
  for (const view of disk) {
    const local = pendingNames.has(view.name) ? memoryByName.get(view.name) : null;
    take(local || view);
  }
  for (const view of memoryByName.values()) {
    if (pendingNames.has(view.name)) take(view);
  }
  return merged;
}

/**
 * A write must not drop a view another tab stored. Names in `allow` were
 * removed on this page and may be absent.
 *
 * @param {{name?: string}[]} payload
 * @param {{name?: string}[]} stored
 * @param {string[]} [allow]
 */
export function keepsStoredNames(payload, stored, allow = []) {
  const names = new Set();
  for (const view of Array.isArray(payload) ? payload : []) {
    if (view && typeof view.name === "string") names.add(view.name);
  }
  const skip = new Set(Array.isArray(allow) ? allow : []);
  const disk = Array.isArray(stored) ? stored.slice(0, VIEW_LIMIT) : [];
  for (const view of disk) {
    if (!view || typeof view.name !== "string" || skip.has(view.name)) continue;
    if (!names.has(view.name)) return false;
  }
  return true;
}

/**
 * A write must not drop a view this page saved while storage was rejecting.
 * Names in `allow` were removed on purpose and may be absent.
 *
 * @param {{name?: string}[]} payload
 * @param {string[]} pending
 * @param {string[]} [allow]
 */
export function keepsPendingNames(payload, pending, allow = []) {
  const names = new Set();
  for (const view of Array.isArray(payload) ? payload : []) {
    if (view && typeof view.name === "string") names.add(view.name);
  }
  const skip = new Set(Array.isArray(allow) ? allow : []);
  for (const name of Array.isArray(pending) ? pending : []) {
    if (typeof name !== "string" || skip.has(name)) continue;
    if (!names.has(name)) return false;
  }
  return true;
}

/**
 * A refused save must not forget a removal that storage never accepted.
 * The name leaves the omission list only after the save fits in the list.
 *
 * @param {string[]} omitted
 * @param {string} name
 * @param {boolean} accepted
 */
export function omissionAfterAttempt(omitted, name, accepted) {
  const names = Array.isArray(omitted) ? omitted : [];
  if (!accepted) return names.slice();
  return names.filter((item) => item !== name);
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
