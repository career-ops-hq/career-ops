// web-service-prepare.mjs — decides whether the dashboard service has to install
// dependencies and rebuild before it starts, and does so only when it has to.
//
// A login service starts the dashboard after every reboot and after every crash.
// Running `npm ci && npm run build` each time costs about three minutes before the
// page answers, so each step is skipped when what it depends on is unchanged:
//
//   install  — web/package-lock.json and the Node runtime (a Node upgrade can change
//              what a native dependency was built against). Stamp: inside
//              node_modules, which `npm ci` deletes first, so an interrupted install
//              leaves no stamp and the next start repeats it.
//   build    — the install stamp plus the state of the checkout (the commit and any
//              uncommitted change). Stamp: inside the build directory, which
//              `next build` empties first, so a failed build leaves no stamp either.
//              A fresh install always rebuilds.
//
// The build is keyed on the whole checkout, not just web/, because the app imports
// modules from the repository root; a pull that touches only docs costs one rebuild
// at the next start, which is the safe side of that trade.
//
// Every OS access is an argument, so web/tests/lib/web-service-prepare.test.mjs runs
// this without npm, git or a network.

import crypto from "node:crypto";
import path from "node:path";

// After a failed install or build, the process waits this long before exiting, so a
// service manager that restarts on exit retries every few minutes instead of
// rebuilding every RESTART_SECONDS.
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const INSTALL_STAMP = path.join("node_modules", ".career-ops-service-install");
const BUILD_STAMP = ".career-ops-service-build";

export class PrepareError extends Error {
  constructor(step, status) {
    super(`${step} failed (exit ${status ?? "unknown"})`);
    this.name = "PrepareError";
    this.step = step;
    this.status = status;
  }
}

function digest(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(String(part));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * How to run npm without a shell, so no argument is ever reparsed.
 *
 * On Windows `npm` is a `.cmd` file, which spawn cannot execute without one; npm's own
 * entry script is run with node instead, where the Windows installer puts it next to
 * node.exe. The shell fallback is for an unusual install and only ever receives the
 * constant arguments `ci` and `run build`.
 *
 * @param {{ platform: string, execPath: string, exists: (p: string) => boolean }} input
 * @returns {{ command: string, prefix: string[], shell: boolean }}
 */
export function npmInvocation({ platform, execPath, exists }) {
  if (platform !== "win32") return { command: "npm", prefix: [], shell: false };
  const cli = path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (exists(cli)) return { command: execPath, prefix: [cli], shell: false };
  return { command: "npm.cmd", prefix: [], shell: true };
}

/**
 * A fingerprint of the checkout. The commit and `git status` / `git diff HEAD` cover
 * tracked and uncommitted changes; without git (a downloaded archive) the sources'
 * paths, sizes and modification times stand in.
 *
 * @param {{ git: (args: string[]) => string | null, walk: () => string }} deps
 *   git: stdout of `git <args>` in the checkout, or null when it is not a repository
 *   or git is missing
 */
export function sourceFingerprint({ git, walk, untracked = () => "" }) {
  const head = git(["rev-parse", "HEAD"]);
  if (head === null) return digest("files", walk());
  // `status` names an untracked file but not its contents, and `diff HEAD` skips it, so an
  // edit to a new file needs its own signature.
  return digest("git", head.trim(), git(["status", "--porcelain"]) ?? "", git(["diff", "HEAD"]) ?? "", untracked());
}

/**
 * Paths, sizes and mtimes of the sources the build can depend on: everything under
 * web/ except installed packages and build output, plus lib/ and the root-level
 * scripts the app imports. The user-layer folders at the repository root (data/,
 * reports/, ...) are not visited, so a scan cannot trigger a rebuild.
 *
 * The recursion is the repository's shared walker, passed in: it refuses to descend
 * into a nested checkout, which a hand-rolled walk here would have to reimplement
 * (tests/walk-tree.test.mjs bans that).
 *
 * @param {object} input
 * @param {typeof import("node:fs")} input.fs
 * @param {(root: string, options: { skip: (entry: import("node:fs").Dirent) => boolean }) => string[]} input.walkTree
 *   walkTree from lib/walk-tree.mjs
 * @param {string} input.repoRoot
 */
export function walkSignature({ fs, walkTree, repoRoot }) {
  const skip = (entry) => entry.isDirectory() && (entry.name === "node_modules" || entry.name.startsWith(".next"));
  const files = [];
  for (const dir of ["web", "lib"]) {
    const abs = path.join(repoRoot, dir);
    if (fs.existsSync(abs)) files.push(...walkTree(abs, { skip }));
  }
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path.join(repoRoot, entry.name));
  }
  return files
    .map((file) => {
      const stat = fs.statSync(file);
      return `${path.relative(repoRoot, file).split(path.sep).join("/")}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    })
    .sort()
    .join("\n");
}

/**
 * Size and mtime of every untracked, non-ignored file git reports, for the fingerprint.
 *
 * @param {{ fs: typeof import("node:fs"), git: (args: string[]) => string | null, repoRoot: string }} input
 */
export function untrackedSignature({ fs, git, repoRoot }) {
  const listed = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!listed) return "";
  return listed
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((rel) => {
      try {
        const stat = fs.statSync(path.join(repoRoot, rel));
        return `${rel}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      } catch {
        return `${rel}:gone`;
      }
    })
    .join("\n");
}

function readStamp(fs, file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function writeStamp(fs, file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${value}\n`);
}

/**
 * Install and build only if needed.
 *
 * @param {object} input
 * @param {string} input.webDir
 * @param {string} input.runtime  node version, platform and architecture in one string
 * @param {Record<string, string | undefined>} input.env  BUILD_DIST relocates the build directory
 * @param {typeof import("node:fs")} input.fs
 * @param {() => string} input.fingerprint  the checkout's current fingerprint
 * @param {(args: string[]) => number | null} input.runNpm  runs npm with the given
 *   arguments in webDir, returning its exit status
 * @param {(line: string) => void} input.log
 * @returns {{ installed: boolean, built: boolean }}
 * @throws {PrepareError} when npm exits non-zero
 */
export function prepareService({ webDir, runtime, env, fs, fingerprint, runNpm, log }) {
  const lockfile = fs.readFileSync(path.join(webDir, "package-lock.json"), "utf8");
  const installKey = digest("install", lockfile, runtime);
  const buildKey = digest("build", installKey, fingerprint());
  const distDir = path.resolve(webDir, env.BUILD_DIST || ".next");
  const installStamp = path.join(webDir, INSTALL_STAMP);
  const buildStamp = path.join(distDir, BUILD_STAMP);

  const step = (name, args) => {
    const status = runNpm(args);
    if (status !== 0) throw new PrepareError(name, status);
  };

  let installed = false;
  if (readStamp(fs, installStamp) !== installKey || !fs.existsSync(path.join(webDir, "node_modules"))) {
    log("Installing dependencies (npm ci)...");
    step("npm ci", ["ci"]);
    writeStamp(fs, installStamp, installKey);
    installed = true;
  }

  let built = false;
  if (installed || readStamp(fs, buildStamp) !== buildKey || !fs.existsSync(path.join(distDir, "BUILD_ID"))) {
    log("Building (npm run build)...");
    step("npm run build", ["run", "build"]);
    writeStamp(fs, buildStamp, buildKey);
    built = true;
  }

  if (!installed && !built) log("Dependencies and build are up to date.");
  return { installed, built };
}
