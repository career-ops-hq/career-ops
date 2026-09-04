import fs from "node:fs";
import path from "node:path";

// Plain .mjs (same pattern as spawn-cli.mjs) so tests/lib/resolve-npm-shim.test.mjs
// can import it directly under Node.

/**
 * Resolve an npm-generated Windows shim to something `spawn()` can launch
 * without a shell (#2375).
 *
 * Why this exists: since the CVE-2024-27980 patches, `spawn()` of a `.cmd`/`.bat`
 * without `shell: true` throws EINVAL, the extensionless sh shim gives ENOENT
 * and the `.ps1` gives EFTYPE. npm on Windows installs exactly those three
 * shims into the global prefix (`%APPDATA%\npm`), so every npm-installed CLI is
 * unspawnable by path — while the real entrypoint they wrap is fine. Reading the
 * shim and launching its target directly sidesteps all three failures without
 * ever enabling `shell: true`, so prompt text stays an argv element and never
 * meets a command interpreter.
 *
 * Both shim shapes npm writes are handled:
 *   - native target:  `"%dp0%\node_modules\<pkg>\bin\tool.exe" %*`  → launch the .exe
 *   - script target:  `"%_prog%" "%dp0%\node_modules\<pkg>\bin\cli.js" %*` → launch
 *     `process.execPath` with the script as argv[0]
 * The `.cmd` sibling is preferred as the source of truth (it is always present
 * next to the other two); the sh shim is the fallback.
 *
 * Anything that is not an npm shim — a real `.exe`, a POSIX binary, a path we
 * cannot read — passes through untouched, so non-Windows platforms and native
 * installs are unaffected by construction.
 *
 * @param {string} binPath  Path as found by the CLI resolver.
 * @param {{ platform?: string, execPath?: string, readFile?: (p: string) => string, exists?: (p: string) => boolean }} [deps]
 *   Injectable for tests; defaults to the real process and filesystem.
 * @returns {{ file: string, prefixArgs: string[] }}  What to spawn, and any argv to prepend.
 */
export function resolveNpmShim(binPath, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const execPath = deps.execPath ?? process.execPath;
  const readFile = deps.readFile ?? ((p) => fs.readFileSync(p, "utf8"));
  const exists = deps.exists ?? ((p) => fs.existsSync(p));

  const passthrough = { file: binPath, prefixArgs: [] };
  if (platform !== "win32") return passthrough;

  const ext = path.extname(binPath).toLowerCase();
  // A real executable is already spawnable; only shim shapes need resolving.
  if (ext === ".exe" || ext === ".com") return passthrough;
  if (ext !== "" && ext !== ".cmd" && ext !== ".bat" && ext !== ".ps1") return passthrough;

  const dir = path.dirname(binPath);
  const base = path.basename(binPath, ext);
  const cmdShim = path.join(dir, `${base}.cmd`);
  const shShim = path.join(dir, base);

  const target = readTarget(cmdShim, exists, readFile) ?? readTarget(shShim, exists, readFile);
  if (!target) return passthrough;

  // The shim references its target relative to its own directory (`%dp0%` /
  // `$basedir`). Resolve against that dir and refuse anything that escapes it:
  // a shim is data on disk, not a promise, and it must not be able to point
  // the spawn at an arbitrary file elsewhere.
  const abs = path.resolve(dir, target);
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (!abs.startsWith(dirWithSep)) return passthrough;
  if (!exists(abs)) return passthrough;

  const targetExt = path.extname(abs).toLowerCase();
  if (targetExt === ".exe" || targetExt === ".com") return { file: abs, prefixArgs: [] };
  if (targetExt === ".js" || targetExt === ".mjs" || targetExt === ".cjs") {
    return { file: execPath, prefixArgs: [abs] };
  }
  return passthrough;
}

/**
 * Pull the `node_modules/...` target out of one shim file, or null.
 * Matches both `%dp0%\node_modules\…` (.cmd) and `$basedir/node_modules/…` (sh).
 */
function readTarget(shimPath, exists, readFile) {
  if (!exists(shimPath)) return null;
  let text;
  try {
    text = readFile(shimPath);
  } catch {
    return null;
  }
  // Quoted form first (how npm writes .cmd shims and quoted sh execs), then a
  // bare token as a fallback. Stop at a quote or whitespace so `%*` / `"$@"`
  // never leak into the path.
  const m = /["']?(?:%dp0%|\$basedir)[\\/](node_modules[\\/][^"'\s]+)/.exec(text);
  if (!m) return null;
  return m[1].replace(/[\\/]+/g, path.sep);
}
