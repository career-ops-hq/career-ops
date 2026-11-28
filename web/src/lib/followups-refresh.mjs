export const FOLLOWUPS_NETWORK_ERROR = "Couldn't refresh follow-ups. Check your connection.";

// A dropped request is not a missing script. Keep the last list.
export function followupsAfterRefreshFailure(current) {
  if (current && typeof current === "object") {
    return { ...current, refreshFailed: true };
  }
  return {
    available: true,
    metadata: null,
    entries: [],
    upcoming: [],
    refreshFailed: true,
  };
}

// The cadence run failed on the server. Show the reason it gave, which a
// missing script and a dropped request never have.
export function followupsAfterServerError(body) {
  const error = typeof body?.error === "string" && body.error ? body.error : "The follow-ups request failed.";
  return { available: false, metadata: null, entries: [], upcoming: [], error };
}
