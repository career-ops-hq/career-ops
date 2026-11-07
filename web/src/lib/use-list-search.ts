"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { LIST_SEARCH_DEBOUNCE_MS, nextSearchWrite, rememberNavigation, shouldCancelSearchDebounce } from "@/lib/list-search-sync.mjs";

type SearchParamsLike = { get: (key: string) => string | null };

/**
 * Local list search that is also written to `q` once typing pauses.
 * The detail link can include the typed value immediately. Reload and Back
 * read the list URL, so the URL has to catch up without a write per keystroke.
 */
export function useListSearch(
  params: SearchParamsLike,
  commit: (updates: Record<string, string | number | null>) => boolean,
  qRef: MutableRefObject<string>,
) {
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const debounceRef = useRef<number | null>(null);
  const expectedRef = useRef<string[]>([]);
  const cancelledRef = useRef<string[]>([]);
  const seenUrl = useRef(params.get("q") ?? "");
  const queueNavigation = useCallback((updates: Record<string, string | number | null>) => {
    // A click that leaves the URL alone must not count as a newer write.
    const committed = commit(updates);
    if (shouldCancelSearchDebounce(updates, committed) && debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    expectedRef.current = rememberNavigation(expectedRef.current, updates, qRef.current, committed);
  }, [commit, qRef]);
  const queueRef = useRef(queueNavigation);
  const cancelPendingSearch = useCallback(() => {
    if (debounceRef.current === null) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);
  // After commit. A discarded render must not publish a search or a navigation.
  useLayoutEffect(() => {
    qRef.current = q;
    queueRef.current = queueNavigation;
  }, [q, qRef, queueNavigation]);
  // Depend on the query text, not the search-params object. A parent re-render
  // hands the effect a new params object and would cancel the pause forever.
  const urlQ = params.get("q") ?? "";

  useEffect(() => {
    const decision = nextSearchWrite({
      local: q,
      url: urlQ,
      urlChanged: urlQ !== seenUrl.current,
      expected: expectedRef.current,
      cancelled: cancelledRef.current,
    });
    seenUrl.current = urlQ;
    expectedRef.current = decision.expected;
    cancelledRef.current = decision.cancelled;
    if (decision.adopt) {
      setQ(urlQ);
      return;
    }
    if (decision.write == null) return;
    const write = decision.write;
    if (decision.immediate) {
      queueRef.current({ q: write ? write : null });
      return;
    }
    const handle = window.setTimeout(() => {
      if (debounceRef.current === handle) debounceRef.current = null;
      if (qRef.current !== write) return;
      queueRef.current({ q: write ? write : null });
    }, LIST_SEARCH_DEBOUNCE_MS);
    debounceRef.current = handle;
    return () => {
      window.clearTimeout(handle);
      if (debounceRef.current === handle) debounceRef.current = null;
    };
  }, [q, urlQ, qRef]);

  return {
    q,
    setQ,
    setParams: (updates: Record<string, string | number | null>) => queueRef.current(updates),
    cancelPendingSearch,
  };
}
