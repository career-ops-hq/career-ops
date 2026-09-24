// Pure helpers for runDiscovery's per-source fan-out (scan.ts). Plain .mjs (same
// pattern as explore-error.mjs) so tests/lib/scan-merge.test.mjs can import them
// without a TS runner.
//
// WHY PER-SOURCE: scan-ats-full.mjs --json prints its one result object only on
// exit. A single child spanning every source therefore lost ALL results when the
// slowest source hit the route's deadline — in practice Workday, whose enterprise
// boards page slowly and rate-limit — and the UI reported the kill as "The scanner
// returned no readable output." One child per source keeps every source that
// finished, and names the one that didn't.

/**
 * Fold per-source --json results into the single `summary` event the Explore UI
 * already consumes. Counts add; capHit is true if any source was capped; dataset
 * statuses merge by source name.
 *
 * @param {Array<{companiesScanned?: number, unreachableBoards?: number, postingsKept?: number,
 *   companiesAvailable?: number, capHit?: boolean, datasetStatus?: Record<string, string>,
 *   postingsDroppedNoDate?: number}>} results Parsed --json objects of the sources that finished.
 * @param {number} offerCount Offers actually surfaced — the fallback when no source reports postingsKept.
 */
export function mergeScanResults(results, offerCount) {
  const sum = (key) => results.reduce((n, r) => n + (typeof r[key] === "number" ? r[key] : 0), 0);
  const anyNumber = (key) => results.some((r) => typeof r[key] === "number");
  const datasetStatus = {};
  for (const r of results) Object.assign(datasetStatus, r.datasetStatus || {});
  return {
    companiesScanned: sum("companiesScanned"),
    unreachable: sum("unreachableBoards"),
    matches: anyNumber("postingsKept") ? sum("postingsKept") : offerCount,
    ...(anyNumber("companiesAvailable") ? { companiesAvailable: sum("companiesAvailable") } : {}),
    capHit: results.some((r) => r.capHit === true),
    datasetStatus,
    ...(anyNumber("postingsDroppedNoDate") ? { postingsDroppedNoDate: sum("postingsDroppedNoDate") } : {}),
  };
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * User-facing copy for sources whose results are missing because they ran out of
 * time. Names the sources and the lever that fixes it, instead of the generic
 * "no readable output" that read as a broken install.
 *
 * @param {string[]} labels Display names of the timed-out sources (e.g. ["Workday"]).
 * @param {number} deadlineSec The deadline they missed, in seconds.
 */
export function timedOutMessage(labels, deadlineSec) {
  const names = joinLabels(labels);
  const plural = labels.length > 1;
  return (
    `${names} didn't finish within ${deadlineSec}s, so ${plural ? "their" : "its"} results are missing. ` +
    `Try again without ${names}, or with a shorter date range or a lower per-source limit.`
  );
}
