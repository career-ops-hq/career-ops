import { pipelineQuery } from "./pipeline-navigation.mjs";

/**
 * Whether following `href` from `currentHref` would land exactly on the
 * previous history entry, so going back restores it (scroll, router cache)
 * instead of pushing a fresh copy.
 * @param {string} href
 * @param {string} currentHref
 * @param {string | null | undefined} previousHref
 * @returns {boolean}
 */
export function returnsToPrevious(href, currentHref, previousHref) {
  if (!previousHref) return false;
  const current = new URL(currentHref);
  const target = new URL(href, current);
  const previous = new URL(previousHref);
  if (previous.origin !== current.origin || target.origin !== current.origin) return false;
  if (previous.pathname !== target.pathname) return false;
  target.searchParams.sort();
  previous.searchParams.sort();
  return target.searchParams.toString() === previous.searchParams.toString();
}

/**
 * Closest earlier history entry that `href` would restore. The report sits
 * between a checklist and the list, so the match is not always the previous
 * entry. Returns -1 when the link should navigate normally.
 * @param {string} href
 * @param {string} currentHref
 * @param {number} currentIndex
 * @param {{ url?: string | null }[]} entries
 * @returns {number}
 */
export function previousMatchIndex(href, currentHref, currentIndex, entries) {
  if (!Number.isInteger(currentIndex)) return -1;
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (returnsToPrevious(href, currentHref, entries[i]?.url)) return i;
  }
  return -1;
}

/**
 * List URL with the search typed in the box. Empty when the address bar
 * already shows that search, so leaving the list does not rewrite history.
 * @param {string} pathname
 * @param {string} currentSearch `params.toString()`, without a leading ?
 * @param {string} typed
 * @returns {string}
 */
export function listEntrySync(pathname, currentSearch, typed) {
  const next = pipelineQuery(currentSearch, typed);
  if (next === currentSearch) return "";
  return `${pathname}${next ? `?${next}` : ""}`;
}
