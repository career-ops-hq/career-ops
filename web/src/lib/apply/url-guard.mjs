import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Apply-session SSRF guard. Reuses liveness-browser.mjs (rejectPrivateOrInvalid +
// validateUrlSecurity) rather than forking a second allowlist.
//
// Loaded at runtime with turbopackIgnore: a static specifier of
// ../../../../liveness-browser.mjs sits outside web/'s turbopack.root, and
// Next 16 cannot resolve that parent path without moving the root (which
// reintroduces the two-lockfile Windows RAM loop in next.config.mjs).

export const APPLY_URL_REQUIRED_MESSAGE = "A valid application URL (https://…) is required";
export const APPLY_URL_BLOCKED_MESSAGE = "This application URL is not allowed";

export class UnsafeApplyUrlError extends Error {
  /** @type {number} */
  status = 400;
  constructor() {
    super(APPLY_URL_BLOCKED_MESSAGE);
    this.name = "UnsafeApplyUrlError";
  }
}

/** @param {unknown} err */
export function isUnsafeApplyUrlError(err) {
  return err instanceof UnsafeApplyUrlError || (err instanceof Error && err.name === "UnsafeApplyUrlError");
}

/** @param {unknown} err */
export function isBlockedNavigation(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(msg);
}

/** @type {Promise<{ rejectPrivateOrInvalid: (url: string) => { code: string, reason: string } | null, validateUrlSecurity: (url: string) => Promise<void> }> | null} */
let coreGuard = null;

function coreGuardHref() {
  const script = "liveness-browser";
  const candidates = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".."));
  } catch {
    /* bundled: import.meta.url may not map to source */
  }
  let cwd = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(cwd);
    const parent = join(cwd, "..");
    if (parent === cwd) break;
    cwd = parent;
  }
  for (const root of candidates) {
    const file = join(/* turbopackIgnore: true */ root, `${script}.mjs`);
    if (existsSync(/* turbopackIgnore: true */ file)) return pathToFileURL(file).href;
  }
  throw new Error("could not load URL guard");
}

function loadCoreGuard() {
  if (!coreGuard) {
    // Magic comment: leave this import as a runtime Node ESM load. A fully
    // dynamic import() without it fails `next build` (Can't resolve <dynamic>).
    coreGuard = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ coreGuardHref());
  }
  return coreGuard;
}

/**
 * Route-level check: 4xx before Playwright. Literal-host only (no DNS) so tests
 * and the POST handler never touch the network. Returns null when the URL is
 * allowed to proceed to the session opener.
 *
 * @param {string} url
 * @returns {Promise<{ status: number, error: string } | null>}
 */
export async function blockedApplyUrlResponse(url) {
  const trimmed = (url ?? "").trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { status: 400, error: APPLY_URL_REQUIRED_MESSAGE };
  }
  const { rejectPrivateOrInvalid } = await loadCoreGuard();
  if (rejectPrivateOrInvalid(trimmed)) {
    return { status: 400, error: APPLY_URL_BLOCKED_MESSAGE };
  }
  return null;
}

/**
 * Both layers of the shared egress guard. Throws UnsafeApplyUrlError (never the
 * core reason string, which names the blocked host/IP) so callers can return a
 * generic 4xx.
 *
 * @param {string} url
 */
export async function assertSafeApplyUrl(url) {
  const { rejectPrivateOrInvalid, validateUrlSecurity } = await loadCoreGuard();
  if (rejectPrivateOrInvalid(url)) throw new UnsafeApplyUrlError();
  try {
    await validateUrlSecurity(url);
  } catch (err) {
    // NXDOMAIN is a dead public host, not an SSRF hit — let Playwright fail later.
    if (err && typeof err === "object" && "livenessCode" in err && err.livenessCode === "dns_no_addresses") {
      return;
    }
    throw new UnsafeApplyUrlError();
  }
}

/**
 * Context-wide route interceptor (main document, redirect hops, subresources).
 * Same wiring as archive-posting.mjs / liveness-browser.mjs.
 *
 * @param {{ route: (pattern: string, handler: (route: { request: () => { url: () => string }, abort: (code?: string) => unknown, continue: () => unknown }) => unknown) => Promise<unknown> }} context
 */
export async function installApplyEgressGuard(context) {
  const { rejectPrivateOrInvalid, validateUrlSecurity } = await loadCoreGuard();
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (rejectPrivateOrInvalid(requestUrl)) return route.abort("blockedbyclient");
    try {
      await validateUrlSecurity(requestUrl);
      return route.continue();
    } catch {
      return route.abort("blockedbyclient");
    }
  });
}
