import { canonicalJobKey } from "./core/url-key.mjs";
import { readTrackerUrl } from "./posting-url.mjs";

/**
 * A saved tracker row completes its inbox discovery even when the evaluator
 * did not update pipeline.md's checkbox. Use posting identity, never a title
 * or company match: sibling openings must stay available for evaluation.
 *
 * @template {{ url: string, done: boolean }} T
 * @param {T[]} inbox
 * @param {{url?: string}[]} applications
 * @returns {T[]}
 */
export function reconcileInbox(inbox, applications) {
  const tracked = new Set(applications
    .map((app) => canonicalJobKey(readTrackerUrl(app.url)))
    .filter(Boolean));
  return inbox.map((job) => {
    const key = canonicalJobKey(job.url);
    return !job.done && key && tracked.has(key) ? { ...job, done: true } : job;
  });
}

/**
 * Pending inbox postings, deduped by URL (pipeline.md can list the same
 * posting twice), so the header count, the tab count and the triage list
 * agree on one number.
 *
 * @template {{ url: string, done: boolean }} T
 * @param {T[]} inbox
 * @returns {T[]}
 */
export function pendingInbox(inbox) {
  const seen = new Set();
  const out = [];
  for (const j of inbox) {
    const key = canonicalJobKey(j.url) || j.url;
    if (j.done || seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}
