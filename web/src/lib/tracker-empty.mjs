/**
 * Copy for a pipeline list that has nothing to show.
 *
 * Plain module with no filesystem access: the pipeline view is a client
 * component, and the tracker parser (which reads the alias table) is not.
 *
 * A tracker with rows that the current tab or search hid keeps the filter
 * hint. A file with no rows does not tell the reader to clear a search.
 *
 * @param {{ shape: string, query?: string, min?: number | null, tab?: string }} state
 * @returns {{ kind: "filtered" | "empty" | "malformed", title: string, detail: string }}
 */
export function trackerEmptyMessage({ shape, query, min, tab }) {
  if (shape === "malformed") {
    return {
      kind: "malformed",
      title: "Tracker file is not a table",
      detail: "data/applications.md is not a tracker table. The file was not changed.",
    };
  }
  if (shape === "rows") {
    return {
      kind: "filtered",
      title: "No matches",
      detail: "Try a different tab or clear the search.",
    };
  }
  return {
    kind: "empty",
    title: "No applications yet",
    detail: "Evaluated and added roles will show up here.",
  };
}
