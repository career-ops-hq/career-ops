// A job URL is a 404 when nothing in the tracker, the reports folder, or
// the in-browser worker list matches it. "99999" and "abc" are the same
// outcome: missing. A worker list that has not loaded yet is not missing.

/**
 * @param {{ hasApplication?: boolean, hasReport?: boolean }} record
 */
export function missingTrackedJob(record) {
  return !record?.hasApplication && !record?.hasReport;
}

/**
 * @param {{ ready?: boolean, ids?: string[], id?: string }} input
 */
export function missingWorker(input) {
  if (!input?.ready) return false;
  const ids = Array.isArray(input.ids) ? input.ids : [];
  return !ids.includes(input.id);
}
