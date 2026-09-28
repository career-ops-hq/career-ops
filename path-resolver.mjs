import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, realpathSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Returns the resolved career-ops data directory root.
 * Priority: process.env.CAREER_OPS_ROOT or process.env.CAREER_OPS_DATA_DIR >
 * .career-ops-data marker file > codebase root (__dirname).
 * 
 * @returns {string} Absolute path to the data root
 */
export function getCareerOpsRoot() {
  const env = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
  if (env) {
    return resolve(__dirname, env);
  }
  const markerFile = join(__dirname, '.career-ops-data');
  if (existsSync(markerFile)) {
    try {
      const content = readFileSync(markerFile, 'utf-8').trim();
      if (content) {
        return resolve(__dirname, content);
      }
    } catch {
      // ignore read errors
    }
  }
  return __dirname;
}

/**
 * Canonicalize a tracker path: absolute + realpath (macOS's symlinked tmpdir
 * among others). This must be applied by EVERY resolver of the same tracker:
 * two implementations briefly coexisted, the un-canonicalized one derived
 * different lock paths (/var vs /private/var) for the same file, and shared
 * writer exclusion silently broke. This module is the single source of truth;
 * tracker-utils.mjs re-exports from here so both import paths agree.
 * Deliberately dependency-light (fs/path only): test fixtures copy this file
 * standalone next to the scripts they exercise.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * Returns the canonical path to the tracker applications.md file for reading.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md > root/applications.md.
 *
 * @param {string} rootDir The career-ops data root directory
 * @returns {string} Canonical absolute path to the tracker file
 */
export function resolveTrackerPath(rootDir) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  const raw = env
    ? env
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
  return canonicalizeTrackerPath(raw);
}

/**
 * Returns the resolved path to the tracker applications.md file for writing.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md.
 * Does not check for file existence, providing a deterministic write target.
 * 
 * @param {string} root The career-ops data root directory
 * @returns {string} Absolute path to the tracker file for writing
 */
export function resolveTrackerPathForWrite(root) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  if (env) {
    // Same canonicalization as the read path (see the re-export above): an
    // un-canonicalized env override derives divergent lock paths on symlinked
    // tmpdirs and breaks shared writer exclusion.
    return canonicalizeTrackerPath(env);
  }
  return join(root, 'data/applications.md');
}

