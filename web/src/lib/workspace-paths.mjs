import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the web's runtime checkout and user files. CAREER_OPS_ROOT retains
 * its web meaning: select another checkout, including its core. DATA_DIR and
 * the marker move only user files. Keep valid-path behavior in parity with
 * the selected checkout's path-resolver.mjs; never cache a marker read.
 *
 * @param {{ cwd?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ codeRoot: string, dataRoot: string }}
 */
export function resolveWorkspacePaths({ cwd = process.cwd(), env = process.env } = {}) {
  const hostingRoot = path.resolve(cwd, "..");
  const rootOverride = env.CAREER_OPS_ROOT?.trim();
  if (rootOverride) {
    const codeRoot = path.resolve(hostingRoot, rootOverride);
    return { codeRoot, dataRoot: codeRoot };
  }

  const dataOverride = env.CAREER_OPS_DATA_DIR?.trim();
  if (dataOverride) {
    return { codeRoot: hostingRoot, dataRoot: path.resolve(hostingRoot, dataOverride) };
  }

  let marker;
  try {
    // User configuration is read at runtime, outside the web build graph.
    marker = fs.readFileSync(/* turbopackIgnore: true */ path.join(hostingRoot, ".career-ops-data"), "utf8").trim();
  } catch (error) {
    // A broken marker must not redirect reads or writes to the checkout.
    if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return { codeRoot: hostingRoot, dataRoot: marker ? path.resolve(hostingRoot, marker) : hostingRoot };
}
