import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { careerOpsRoot } from "@/lib/career-ops";

// A SIGNED-IN browser profile for the apply flow (opt-in, off by default).
//
// WHY: openSession() calls browser.newContext(), which is a fresh cookie-less
// profile every time. That is correct for a public ATS form and wrong for a gated
// site: LinkedIn serves its authwall, so an Easy Apply posting (whose form lives
// ON LinkedIn and has no external ATS URL to resolve) can never be reached.
// linkedin-apply.mjs solves the offsite case by reconstructing the employer's ATS
// link; it structurally cannot solve the Easy Apply case. This can.
//
// WHY A DEDICATED PROFILE, NOT THE USER'S REAL CHROME PROFILE: pointing Playwright
// at ~/Library/.../Chrome/Default would hand the automation every session the user
// has anywhere (bank, email, everything), and Chrome refuses to open a profile
// directory a running Chrome already holds, so it would also break whenever their
// browser is open. A dedicated directory carries only the sessions the user
// deliberately signs into, and never fights their day-to-day browser.
//
// The user signs in THEMSELVES in a real window. career-ops never sees, types, or
// stores a password.

export type ProfileConfig = {
  enabled: boolean;
  dir: string;
  /** The user's `profile_dir` verbatim, when it was refused for escaping the
   *  project root and `dir` fell back to the default. Absent otherwise. */
  dirRejected?: string;
};

/** Where the dedicated profile lives when the user has not named a directory.
 *  `.career-ops-web/` is already gitignored and already holds apply logs. */
export function defaultProfileDir(): string {
  return path.join(careerOpsRoot(), ".career-ops-web", "browser-profile");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Canonicalize `p` as far as it exists on disk.
 *
 * `realpathSync` throws on a path whose leaf is not created yet, which the
 * profile directory usually is not. Resolving the deepest ancestor that DOES
 * exist and re-joining the rest is what makes the containment check below see
 * through a symlink, rather than being satisfied by a repo-relative spelling
 * that points somewhere else entirely.
 */
function realpathAsFarAsItGoes(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * The directory a user-supplied `profile_dir` may actually use.
 *
 * Containment under the project root is the whole safety story of this feature.
 * A DEDICATED profile is only meaningful while it cannot become the user's real
 * one, and `profile_dir: "../../Library/Application Support/Google/Chrome"`
 * would hand the automation every session they have anywhere. `path.resolve`
 * does not stop that, so a value landing outside the root is refused and the
 * default is used instead.
 *
 * Refused, not silently ignored: the caller gets the rejected value back so the
 * UI can say why the path on screen is not the one in their config.
 */
function containedProfileDir(raw: string): { dir: string; dirRejected?: string } {
  const root = realpathAsFarAsItGoes(careerOpsRoot());
  const resolved = realpathAsFarAsItGoes(path.resolve(careerOpsRoot(), raw));
  const rel = path.relative(root, resolved);
  // rel === "" is the project root itself, which is not a place to put a
  // browser profile either.
  const contained = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  return contained ? { dir: resolved } : { dir: defaultProfileDir(), dirRejected: raw };
}

/**
 * Read the opt-in from config/profile.yml (user layer):
 *
 *   apply:
 *     signed_in_profile: true
 *     profile_dir: ""        # optional, defaults to defaultProfileDir()
 *
 * Absent, malformed, or unreadable config all mean "off". This feature changes
 * what a browser session can see, so it must never switch itself on by accident.
 *
 * `profile_dir` is resolved against the project root and must stay inside it;
 * see containedProfileDir for why, and for what happens when it does not.
 */
export function profileConfig(): ProfileConfig {
  const file = path.join(careerOpsRoot(), "config", "profile.yml");
  let apply: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    if (isObj(parsed) && isObj(parsed.apply)) apply = parsed.apply;
  } catch {
    /* missing or malformed → disabled */
  }
  const enabled = apply.signed_in_profile === true;
  const raw = typeof apply.profile_dir === "string" ? apply.profile_dir.trim() : "";
  if (!raw) return { enabled, dir: defaultProfileDir() };
  return { enabled, ...containedProfileDir(raw) };
}

/** Whether the profile directory has been created (i.e. ever launched). Not a
 *  claim that any particular site is signed in. Only the user can confirm that,
 *  by opening the window. */
export function profileExists(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __coProfileContext: BrowserContext | undefined;
}

/** Off-screen during fill; moved on-screen at handoff (same as the normal path). */
const OFFSCREEN_ARGS = ["--window-position=-3200,-3200", "--window-size=1280,940"];

/**
 * The singleton persistent context for the signed-in profile.
 *
 * One profile directory can back exactly one browser, so unlike the normal path
 * this context is SHARED by every concurrent apply session. Callers must close
 * their own page, never this context (see closeSurface in session.ts) or one
 * finished session would tear down the others and drop the sign-in.
 *
 * @param onScreen true for the sign-in window the user interacts with directly.
 */
export async function persistentContext(onScreen = false): Promise<BrowserContext> {
  const existing = globalThis.__coProfileContext;
  // A persistent context has no .browser(); liveness shows up as a closed context,
  // which throws on use, so probe it cheaply instead of trusting the handle.
  if (existing) {
    try {
      existing.pages();
      return existing;
    } catch {
      globalThis.__coProfileContext = undefined;
    }
  }

  const { dir } = profileConfig();
  fs.mkdirSync(dir, { recursive: true });

  const opts = {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: onScreen ? ["--window-size=1280,940"] : OFFSCREEN_ARGS,
  };
  let ctx: BrowserContext;
  try {
    ctx = await chromium.launchPersistentContext(dir, { channel: "chrome", ...opts });
  } catch (first) {
    // Two very different failures land here, and the message has to tell them
    // apart: no system Chrome (retry on bundled Chromium), or the profile is
    // already open in another process (retrying cannot help).
    const msg = first instanceof Error ? first.message : String(first);
    if (/ProcessSingleton|SingletonLock|already (in use|running)|profile.*in use/i.test(msg)) {
      throw new Error("That browser profile is already open in another window. Close it, then try again.");
    }
    try {
      ctx = await chromium.launchPersistentContext(dir, opts);
    } catch {
      throw new Error("The signed-in browser profile needs Google Chrome. Install Chrome (or run: pnpm exec playwright install chromium) and try again.");
    }
  }
  globalThis.__coProfileContext = ctx;
  return ctx;
}

/**
 * Move the profile's window on-screen and focus it.
 *
 * Required, not cosmetic. `persistentContext(true)` returns an ALREADY-RUNNING
 * context when an apply session opened one first, and that one was launched with
 * --window-position=-3200,-3200. The onScreen argument only affects a fresh
 * launch, so without this the sign-in window would sit off-screen and the button
 * would look like it did nothing. bringToFront() alone cannot fix that: it
 * focuses a tab, it does not move a window.
 */
export async function showProfileWindow(page: Page): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 80, top: 60, width: 1280, height: 920, windowState: "normal" },
    });
    await cdp.detach().catch(() => {});
  } catch {
    /* CDP unavailable → bringToFront below still raises it where it can */
  }
  await page.bringToFront().catch(() => {});
}

/** Close the shared profile browser (idle cleanup, or the user finishing sign-in). */
export async function closePersistentContext(): Promise<void> {
  const ctx = globalThis.__coProfileContext;
  globalThis.__coProfileContext = undefined;
  await ctx?.close().catch(() => {});
}
