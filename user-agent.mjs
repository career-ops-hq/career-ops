// Shared User-Agent string derived from package.json, so every caller
// advertises the current release version instead of a hand-copied one that
// drifts stale.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function readPackageVersion() {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export const DEFAULT_USER_AGENT = `Mozilla/5.0 (compatible; career-ops/${readPackageVersion()})`;

/**
 * Browser-like User-Agent for callers that must clear WAF/CDN bot management
 * blocking the plain career-ops UA outright (seen live: Glints' firewall,
 * Geico's Cloudflare-gated Workday tenant). Shared so every caller working
 * around such a block bumps one constant instead of drifting Chrome versions
 * independently per file.
 */
export const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
