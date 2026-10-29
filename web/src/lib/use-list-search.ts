"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LIST_SEARCH_DEBOUNCE_MS, nextSearchWrite, noteNavigation } from "@/lib/list-search-sync.mjs";

type SearchParamsLike = { get: (key: string) => string | null };

/**
 * Local list search that is also written to `q` once typing pauses.
 * The detail link can include the typed value immediately. Reload and Back
 * read the list URL, so the URL has to catch up without a write per keystroke.
 */
export function useListSearch(
  params: SearchParamsLike,
  commit: (updates: Record<string, string | number | null>) => void,
  qRef: MutableRefObject<string>,
) {
  const [q, setQ] = useState(() => params.get("q") ?? "");
  qRef.current = q;
  const expectedRef = useRef<string[]>([]);
  const cancelledRef = useRef<string[]>([]);
  const seenUrl = useRef(params.get("q") ?? "");
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const queueNavigation = (updates: Record<string, string | number | null>) => {
    expectedRef.current = noteNavigation(expectedRef.current, updates, qRef.current);
    commitRef.current(updates);
  };
  const queueRef = useRef(queueNavigation);
  queueRef.current = queueNavigation;
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
      if (qRef.current !== write) return;
      queueRef.current({ q: write ? write : null });
    }, LIST_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [q, urlQ, qRef]);

  return {
    q,
    setQ,
    setParams: (updates: Record<string, string | number | null>) => queueRef.current(updates),
  };
}
