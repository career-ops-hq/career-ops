// A tiny client-side ring buffer of recent ERRORS (not arbitrary logs → far less
// PII surface) for the in-app bug reporter. Installed once on first import.
const MAX = 20;
const BUF: string[] = [];

function push(s: string) {
  BUF.push(s.replace(/\s+/g, " ").slice(0, 300));
  if (BUF.length > MAX) BUF.shift();
}

declare global {
  interface Window {
    __coLogBufInstalled?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__coLogBufInstalled) {
  window.__coLogBufInstalled = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const msg = args.map((a) => (a instanceof Error ? `${a.stack || a.message}` : String(a))).join(" ");
      // Suppress extension noise, ResizeObserver noise, and extension-induced hydration mismatch overlays
      if (
        /bis_skin_checked|ResizeObserver loop|chrome-extension|moz-extension|hydration-mismatch|server rendered HTML|didn't match/i.test(
          msg
        )
      ) {
        return;
      }
      push("[error] " + msg);
    } catch {
      /* never break logging */
    }
    orig(...args);
  };
  window.addEventListener("error", (e) => {
    if (e.message && !/bis_skin_checked|ResizeObserver/i.test(e.message)) {
      push(`[onerror] ${e.message || ""} @ ${e.filename || ""}:${e.lineno || ""}`);
    }
  });
  // Server-side failures are invisible to console.error — wrap fetch so a
  // degraded API (500, or a route that answered but couldn't do its job) lands
  // in the ring too. Pathname only: query strings can carry company names.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await origFetch(...args);
    try {
      const u = new URL(typeof args[0] === "string" ? args[0] : (args[0] as Request).url, location.origin);
      if (u.pathname.startsWith("/api/") && !res.ok) push(`[api] ${u.pathname} → ${res.status}`);
    } catch {
      /* never break fetch */
    }
    return res;
  };
  window.addEventListener("unhandledrejection", (e) => {
    const reason = String((e as PromiseRejectionEvent).reason);
    if (!/bis_skin_checked|ResizeObserver/i.test(reason)) {
      push(`[rejection] ${reason}`);
    }
  });
}

export function recentLogs(): string[] {
  return BUF.slice();
}
