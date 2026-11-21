// A counter that lets only the newest of overlapping requests apply its result.
//
// The Documents page refetches on mount, after every finished job and when the
// tab becomes visible again, so two fetches can be in flight at once. Without
// this, a slower, older response that lands after a newer one would put the
// older list back on screen.
export function createLatestRequest() {
  let latest = 0;
  return {
    /** Start a request; returns its ticket. */
    start() {
      latest += 1;
      return latest;
    },
    /** True while no newer request has started since this ticket. */
    isLatest(ticket) {
      return ticket === latest;
    },
    /** Drop every ticket handed out so far (for example on unmount). */
    cancel() {
      latest += 1;
    },
  };
}
