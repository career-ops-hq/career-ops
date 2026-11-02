/**
 * Whether the Portals page shows the "no portals.yml yet" setup steps. The
 * page knows the file is missing before any check runs. A check that could
 * not run (no verify script, a failed request) says nothing about the file,
 * so the steps stay up until a check finds the file configured.
 *
 * @param {boolean} missing
 * @param {{ available: boolean, configured: boolean } | null} res
 * @returns {boolean}
 */
export function showPortalsSetup(missing, res) {
  if (res?.configured) return false;
  if (res?.available) return true;
  return missing;
}
