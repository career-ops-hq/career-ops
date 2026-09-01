// Shared User-Agent string, so every caller advertises the same identifier
// instead of a hand-copied one that drifts stale or diverges per file (past
// variants: career-ops/1.3, career-ops/1.0, career-ops-seeds/1.0,
// career-ops-liveness/1.0 — no known reason for the distinct identifiers,
// treated as copy-paste drift, not intentional server-side traffic splitting).
//
// The trailing /1.0 is a UA-format version, bumped by hand only if this
// identifier's shape changes (same convention as Googlebot/2.1, bingbot/2.0)
// — it is NOT the package.json release version. A UA that moved on every
// release would be an unintended variable in every provider's fingerprint,
// introduced without anyone deciding it should be there. Pin it.

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; career-ops/1.0; +https://github.com/career-ops-hq/career-ops)';

/**
 * Browser-like User-Agent for callers that must clear WAF/CDN bot management
 * blocking the plain career-ops UA outright (seen live: Glints' firewall,
 * Geico's Cloudflare-gated Workday tenant). Shared so every caller working
 * around such a block bumps one constant instead of drifting Chrome versions
 * independently per file.
 */
export const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
