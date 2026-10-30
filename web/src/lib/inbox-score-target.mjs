/**
 * Where a finished inbox evaluation opens, and whether the row is evaluated.
 * The worker log is the destination while a run is in flight, and when no
 * report number came back. A saved report opens /pipeline/{n} even when the
 * verdict line did not parse to a score.
 *
 * @param {{ jobId: string, running: boolean, score: number | null, reportN?: number | null } | null | undefined} scored
 * @returns {{ evaluated: boolean, href: string | null, showScore: boolean }}
 */
export function inboxScoreTarget(scored) {
  if (!scored) return { evaluated: false, href: null, showScore: false };
  const hasReport = typeof scored.reportN === "number";
  const evaluated = scored.running || scored.score != null || hasReport;
  if (!evaluated) return { evaluated: false, href: null, showScore: false };
  const showScore = !scored.running && scored.score != null;
  if (scored.running || !hasReport) {
    return { evaluated: true, href: `/jobs/${scored.jobId}`, showScore };
  }
  return { evaluated: true, href: `/pipeline/${scored.reportN}`, showScore };
}
