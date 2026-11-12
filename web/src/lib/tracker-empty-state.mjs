/** @typedef {{ kind: "empty-tab" } | { kind: "elsewhere", count: number } | { kind: "no-match" } | { kind: "below-min" }} TrackerEmptyState */
/** @typedef {"show-all" | "clear-search" | "clear-min"} TrackerEmptyActionId */
/** @typedef {{ heading: string, actions: { id: TrackerEmptyActionId, label: string }[] }} TrackerEmptyPresentation */

/**
 * @param {{ tabLabel: string | null, query: string, minScore: number | null, matchesInAll: number }} facts
 *   `tabLabel` is null on All. `matchesInAll` counts rows passing the same
 *   search and score filter with no tab restriction.
 * @returns {TrackerEmptyState}
 */
export function trackerEmptyState({ tabLabel, query, minScore, matchesInAll }) {
  if (query) {
    return tabLabel != null && matchesInAll > 0 ? { kind: "elsewhere", count: matchesInAll } : { kind: "no-match" };
  }
  return minScore != null ? { kind: "below-min" } : { kind: "empty-tab" };
}

/**
 * Heading and undo actions for an empty tracker table.
 * A search that misses while a score floor is set names both, because clearing
 * only the search leaves the table empty.
 * @param {TrackerEmptyState} state
 * @param {{ tabLabel: string | null, query: string, minScore: number | null }} facts
 * @returns {TrackerEmptyPresentation}
 */
export function trackerEmptyPresentation(state, { tabLabel, query, minScore }) {
  const clearSearch = { id: "clear-search", label: "Clear search" };
  const clearMin = { id: "clear-min", label: "Clear score filter" };
  switch (state.kind) {
    case "empty-tab":
      return { heading: tabLabel ? `No ${tabLabel} applications yet` : "No applications yet", actions: [] };
    case "elsewhere":
      return {
        heading: `No matches for “${query}” in ${tabLabel}`,
        actions: [{ id: "show-all", label: `Show ${state.count} in All` }, clearSearch],
      };
    case "no-match":
      if (minScore != null) {
        return {
          heading: `No matches for “${query}” at score ${minScore.toFixed(1)} or higher`,
          actions: [clearSearch, clearMin],
        };
      }
      return { heading: `No matches for “${query}”`, actions: [clearSearch] };
    case "below-min":
      return {
        heading: `No ${tabLabel ? `${tabLabel} ` : ""}applications score ${minScore?.toFixed(1)} or higher`,
        actions: [clearMin],
      };
    default: {
      const unhandled = /** @type {never} */ (state);
      throw new Error(`Unknown tracker empty state: ${JSON.stringify(unhandled)}`);
    }
  }
}
