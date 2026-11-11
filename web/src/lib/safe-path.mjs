// Server-only: path confinement for the Preparation file route.
import fs from "node:fs";
import path from "node:path";

/** Resolve `rel` inside `base`; returns null when it would escape `base`.
 *  Lexical only (it does not follow symlinks); use realInside for a file you read. */
export function resolveInside(base, rel) {
  const root = path.resolve(base);
  const full = path.resolve(root, rel);
  return full.startsWith(root + path.sep) ? full : null;
}

/** Like resolveInside, but follows symlinks: returns the real path only when the
 *  file exists and really lives inside `base`. Null otherwise (escape or missing). */
export function realInside(base, rel) {
  const full = resolveInside(base, rel);
  if (!full) return null;
  try {
    return resolveInside(fs.realpathSync(base), fs.realpathSync(full));
  } catch {
    return null;
  }
}
