/**
 * Persist inbox Skip/undo by flipping the `data/pipeline.md` checkbox for one
 * posting URL. localStorage is only a cache; this is the file write.
 *
 * The URL is a matcher, never a filesystem path. Only the checkbox on matching
 * Pending rows changes — company/role and every other line stay byte-identical.
 *
 * The rule and the write are the core's lib/inbox-skip.mjs (./core/inbox-skip.mjs
 * is a byte copy), the module the dashboard's Inbox `x` and `u` keys run through
 * the core's inbox-skip.mjs (#5269). This file only loads the core pipeline
 * lock from the checkout and hands it over.
 */
import { pathToFileURL } from "node:url";
import { postingUrl } from "./posting-url.mjs";
import { applyInboxSkip, jobUrlFromRest, setInboxSkip as setInboxSkipWithLock } from "./core/inbox-skip.mjs";

export { postingUrl, applyInboxSkip, jobUrlFromRest };

const unlocked = (_pipelinePath, run) => run();

/**
 * Read-modify-write `pipeline.md` under the core pipeline lock when available.
 *
 * @param {string} pipelinePath absolute path to data/pipeline.md
 * @param {string} url
 * @param {boolean} done
 * @param {{ lockModule?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, text: string, matched: number, changed: number }
 *   | { ok: false, error: "invalid-url" | "unmatched" | "not-found" | "busy" }>}
 */
export async function setInboxSkip(pipelinePath, url, done, options = {}) {
  const parsed = postingUrl(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const lockModule = options.lockModule;
  if (!lockModule) return setInboxSkipWithLock(pipelinePath, parsed, done, unlocked);

  const mod = await import(/* webpackIgnore: true */ pathToFileURL(lockModule).href);
  if (typeof mod.withPipelineLock !== "function") {
    throw new Error("pipeline-lock.mjs has no withPipelineLock");
  }
  return setInboxSkipWithLock(pipelinePath, parsed, done, mod.withPipelineLock, {
    timeoutMs: options.timeoutMs ?? (Number(process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS) || 5_000),
    retryMs: 50,
  });
}
