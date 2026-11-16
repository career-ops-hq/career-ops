// What the scheduled scans page should show before a job list is on screen.
// "empty" is only a successful load that found no scans.
export function scheduledScansBody(phase, jobCount) {
  if (phase === "loading" && jobCount === 0) return "loading";
  if (phase === "error" && jobCount === 0) return "error";
  if (jobCount === 0) return "empty";
  return "list";
}
