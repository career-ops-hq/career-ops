// Which career-ops release the scaffolder clones.
//
// It reads GitHub's /releases/latest. When that gives no usable answer the
// clone falls back to the default branch, main, which can carry unreleased
// changes, so the caller is told why and says so to the user rather than
// printing the same "Cloning career-ops" line as a release install.
//
// This repository also releases a `web` component, tagged `web-vX.Y.Z`, and
// /releases/latest returns whichever release is marked Latest across both.
// release.yml re-marks the career-ops release on every run, but between the
// two releases being created, or if that step stops running, the answer is a
// web tag. Only an exact `career-ops-vX.Y.Z` counts as a release here, the same
// rule as RELEASE_TAG_RE in update-system.mjs (not imported: the npm package
// ships only scaffolder/bin).

export const LATEST_RELEASE = "https://api.github.com/repos/career-ops-hq/career-ops/releases/latest";
export const RELEASE_TAG_RE = /^career-ops-v\d+\.\d+\.\d+$/;

/**
 * Resolve the release tag to clone.
 *
 * @param {{ fetchImpl?: typeof fetch }} [ctx] - injection seam for tests.
 * @returns {Promise<{ tag: string, reason?: undefined } | { tag: null, reason: string }>}
 *   `reason` says, in a few words, why no release tag could be used.
 */
export async function resolveReleaseTag({ fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(LATEST_RELEASE, {
      headers: { "User-Agent": "career-ops-cli", Accept: "application/vnd.github+json" },
    });
  } catch (err) {
    return { tag: null, reason: `could not reach the GitHub API (${err?.cause?.code || err?.message || "network error"})` };
  }
  if (!res.ok) {
    // Unauthenticated API calls are limited to 60 an hour per IP address, so
    // a shared network can see 403/429 here while git clone still works.
    const limited = (res.status === 403 || res.status === 429) && res.headers?.get?.("x-ratelimit-remaining") === "0";
    return { tag: null, reason: `the GitHub API answered HTTP ${res.status}${limited ? " (rate limit reached)" : ""}` };
  }
  let tag = "";
  try {
    tag = String((await res.json())?.tag_name || "").trim();
  } catch {
    // Unreadable body: tag stays empty.
  }
  if (!tag) return { tag: null, reason: "the GitHub API returned no release tag" };
  if (!RELEASE_TAG_RE.test(tag)) {
    return { tag: null, reason: `the latest GitHub release is "${tag}", not a career-ops-vX.Y.Z release` };
  }
  return { tag };
}
