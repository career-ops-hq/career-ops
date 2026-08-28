/** Strong provider/CLI authentication failures only. */
export function isWorkerAuthError(job) {
  if (job?.status !== "error") return false;
  const text = `${job.steps?.at?.(-1)?.label ?? ""} ${job.text ?? ""}`;
  return /\b(?:not logged in|authentication (?:required|failed)|unauthorized|invalid api[ -]?key|please run (?:codex login|\/login)|(?:sign[ -]?in|login) required|credentials? (?:missing|invalid|expired)|api[ -]?key (?:missing|invalid|expired|required))\b/i.test(text);
}
