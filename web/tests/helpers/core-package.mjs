// Where a core (repo-root) dependency is installed, as Node would resolve it for
// a file in the core checkout.
//
// A web suite that copies a core module into a throwaway directory has to put
// that module's packages within reach of the copy. `<core>/node_modules` is the
// obvious place to take them from and the wrong one: a git worktree (for example
// one under `.claude/worktrees/<name>`) usually has no node_modules of its own,
// and core modules import fine there only because Node walks up into the main
// checkout's tree. A link to `<core>/node_modules` is then created dangling, the
// copied module cannot load its package, and the suite fails (or passes) on the
// fallback path instead of the behaviour it is about.
//
// So this walks the way Node's bare-specifier lookup does: `<dir>/node_modules/
// <pkg>` for the starting directory and then each parent, nearest first,
// skipping a `<dir>` that is itself named node_modules. A candidate counts only
// if it holds a package.json. Walked by hand because
// `require.resolve('<pkg>/package.json')` is something a package's `exports` map
// may refuse. Same rule as findInstalledPackage() in the root tests/helpers.mjs,
// restated here because suites under web/tests must run on web/ alone and do not
// import from the root suite.
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} pkg - Package name, scoped names included (`@scope/name`).
 * @param {string} fromDir - Directory the lookup starts from (the core checkout).
 * @returns {string | null} The package directory, or null when it is not installed.
 */
export function findCorePackage(pkg, fromDir) {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", pkg);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Copy an installed package into `dest` together with the packages it depends
 * on, so the copy can load them from where it now sits.
 *
 * A linked package needs none of this: Node resolves a module's imports from
 * its real location, so whatever is installed beside the original stays in
 * reach. A copy has only its own directory. Copying js-yaml alone leaves it
 * unable to find argparse.
 *
 * Each dependency is resolved the way Node would resolve it for the original
 * and placed in the copy's own node_modules, the first place Node looks from
 * there. One installed nowhere is skipped: the original could not load it
 * either. One already inside the package came along with the copy. `chain`
 * stops a dependency cycle from recursing forever; the member it skips is an
 * ancestor directory of the copy, where Node finds it.
 *
 * @param {string} source - The installed package directory.
 * @param {string} dest - Where the copy goes.
 * @param {Set<string>} [chain] - Real paths of the packages being copied above this one.
 */
function copyPackageWithDependencies(source, dest, chain = new Set()) {
  // The real directory, not a link to it: copying a link would recreate the
  // very thing this fallback runs because we could not make.
  const real = fs.realpathSync(source);
  fs.cpSync(real, dest, { recursive: true });
  const within = new Set(chain).add(real);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf-8"));
  } catch {
    return;
  }
  // Peers too. A package imports its peer like any other dependency, and npm
  // installs the peer beside it, so the original resolves it from its own
  // location and a copy that left it behind does not.
  for (const name of Object.keys({ ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies })) {
    const installed = findCorePackage(name, real);
    if (installed === null) continue;
    const depReal = fs.realpathSync(installed);
    if (depReal.startsWith(real + path.sep) || within.has(depReal)) continue;
    copyPackageWithDependencies(depReal, path.join(dest, "node_modules", name), within);
  }
}

/**
 * Make one core dependency importable from `sandboxDir` by putting the installed
 * package in the sandbox's own node_modules.
 *
 * Linked when the platform allows it. One package is then enough: Node resolves
 * the linked package's own imports from its real location, so its dependencies
 * come along without being linked. 'junction' is the link type Windows grants
 * without Developer Mode and is ignored elsewhere.
 *
 * Copied, with its dependencies, when no link can be made. A copy resolves from
 * the sandbox, so the package alone would not load there.
 *
 * @param {string} sandboxDir - Directory the copied core module lives in.
 * @param {string} pkg - Package the copied module imports.
 * @param {string} fromDir - The core checkout the package is resolved for.
 * @param {{ link?: (target: string, path: string, type: string) => void }} [options] -
 *   `link` replaces the link primitive; a test passes one that throws to
 *   exercise the copy.
 * @returns {string} Path to the package inside the sandbox.
 * @throws {Error} When the package is not installed anywhere Node would look.
 */
export function linkCorePackage(sandboxDir, pkg, fromDir, { link = fs.symlinkSync } = {}) {
  const source = findCorePackage(pkg, fromDir);
  if (source === null) {
    throw new Error(`${pkg} is not installed in any node_modules from ${fromDir} upward`);
  }
  const dest = path.join(sandboxDir, "node_modules", pkg);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    link(source, dest, "junction");
  } catch {
    copyPackageWithDependencies(source, dest);
  }
  return dest;
}
