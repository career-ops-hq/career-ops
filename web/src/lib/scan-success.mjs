export function scanSuccessLabel(totalRuns, successRuns) {
  if (totalRuns <= 0) return "—";
  return `${Math.round((successRuns / totalRuns) * 100)}%`;
}
