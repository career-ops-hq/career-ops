const countOf = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

/** An unavailable or malformed response is never an empty queue. */
export function parseTodayFollowups(ok, data) {
  if (!ok || data?.available !== true || !Array.isArray(data?.entries)) {
    throw new Error(typeof data?.error === "string" ? data.error : "Could not load follow-ups. Retry to check what is due.");
  }
  return {
    entries: data.entries,
    due: countOf(data.metadata?.overdue) + countOf(data.metadata?.urgent),
    nextUpcoming: data.nextUpcoming ?? null,
  };
}

export function parseTodayMatches(ok, data) {
  if (!ok || data?.available === false || !Array.isArray(data?.offers)) {
    throw new Error(typeof data?.error === "string" ? data.error : "Could not load fresh matches. Retry to check your scans.");
  }
  return {
    offers: data.offers,
    count: data.count == null || !Number.isFinite(Number(data.count)) ? data.offers.length : countOf(data.count),
  };
}

/** The inbox triages by URL; checked rows and duplicate URLs are not extra work. */
export function pendingInboxCount(inbox) {
  return new Set(inbox.filter((job) => !job.done).map((job) => job.url)).size;
}

/** Only a successfully loaded, empty queue can say the user is caught up. */
export function summarizeToday({ freshCount, dueCount, decisionCount, inboxCount, followupState, freshState }) {
  const items = [
    { count: freshCount, label: `new match${freshCount === 1 ? "" : "es"} this week` },
    { count: dueCount, label: `follow-up${dueCount === 1 ? "" : "s"} due` },
    { count: decisionCount, label: `decision${decisionCount === 1 ? "" : "s"} to make` },
    { count: inboxCount, label: `inbox job${inboxCount === 1 ? "" : "s"} to review` },
  ].filter((item) => item.count > 0);
  const loading = followupState === "loading" || freshState === "loading";
  const failed = followupState === "error" || freshState === "error";
  const allClear = !items.length && followupState === "ready" && freshState === "ready";
  const emptyHeading = allClear ? "You're all caught up." : failed ? "Your queue needs another check." : "Checking your queue…";
  return { items, allClear, loading, failed, emptyHeading };
}
