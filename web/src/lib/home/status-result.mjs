/** An HTTP response alone does not confirm that the tracker saved this status. */
export function statusWriteError(ok, result, requestedStatus) {
  if (ok && result?.ok === true && result.status === requestedStatus) return null;
  if (typeof result?.error === "string" && result.error.trim()) return result.error;
  return "Could not confirm the change. Check the pipeline, then retry.";
}
