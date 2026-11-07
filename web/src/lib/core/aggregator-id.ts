import { pathToFileURL } from "node:url";
import { rootScript } from "@/lib/career-ops";

/**
 * ACL for the core's `isAggregatorUrl`/`aggregatorPostingId` (url-key.mjs) —
 * the posting-id rule merge-tracker.mjs uses to tell two requisitions on one
 * aggregator apart, and that What's New suppression applies the same way.
 *
 * DERIVED, NOT COPIED (#2369, #2666). Which hosts are aggregators is not a
 * fixed list: the core reads the shared scraper list
 * (data-static/aggregator-domains.txt, or CAREER_OPS_AGGREGATOR_DOMAINS) and
 * adds its own supplement. A mirror in the web would drift from both.
 *
 * Loaded from the engine checkout via rootScript(), not careerOpsRoot(): the
 * module is code, and under the #524 split layout the data root holds no
 * `.mjs` files. Imported dynamically per resolved path and cached — NEVER
 * caching a failure (#2590).
 *
 * null means the rule is unavailable (an older core): callers then compare
 * posting URLs without it, which is the behaviour before the rule existed.
 */

export type AggregatorRule = {
  isAggregatorUrl: (raw: string) => boolean;
  aggregatorPostingId: (raw: string) => { domain: string; id: string } | null;
};

const modCache = new Map<string, AggregatorRule>();

let warned = false;

/** Resolve the core's aggregator rule for the current checkout, or null. */
export async function getAggregatorRule(): Promise<AggregatorRule | null> {
  const file = rootScript("url-key");
  const hit = modCache.get(file);
  if (hit) return hit;
  try {
    const mod = (await import(/* webpackIgnore: true */ pathToFileURL(file).href)) as Partial<AggregatorRule>;
    if (typeof mod.isAggregatorUrl === "function" && typeof mod.aggregatorPostingId === "function") {
      const rule = { isAggregatorUrl: mod.isAggregatorUrl, aggregatorPostingId: mod.aggregatorPostingId };
      modCache.set(file, rule); // only successes are cached (#2590)
      return rule;
    }
    if (!warned) {
      warned = true;
      console.warn(
        `[career-ops] ${file} has no isAggregatorUrl/aggregatorPostingId export — What's New compares aggregator URLs by host only. Update career-ops to tell aggregator postings apart by posting id.`,
      );
    }
  } catch {
    if (!warned) {
      warned = true;
      console.warn(
        `[career-ops] could not load ${file} — What's New compares aggregator URLs by host only. Update career-ops to tell aggregator postings apart by posting id.`,
      );
    }
  }
  return null;
}
