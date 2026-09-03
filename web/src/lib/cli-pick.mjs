// The default-CLI pick, in .mjs so the test suite imports THIS code rather than
// a hand-copied mirror of it (saved-cli.ts is TS; web/tests/*.test.mjs cannot
// import TS). saved-cli.ts re-exports from here so both entry points agree —
// same reason report-files.mjs exists.

/**
 * The CLI to select when Config has nothing saved yet: the first INSTALLED
 * entry in the caller's order.
 *
 * Order matters and is not incidental. Callers pass the list from /api/clis,
 * which preserves `KNOWN` order in src/lib/clis.ts — Claude Code first. That
 * makes the default the most-audited runtime available: Claude is the only CLI
 * with a per-tool deny list (see the permission note on `KNOWN`), and the only
 * one the CV ingest route grants a Read tool to. Picking "first installed" is
 * therefore a safety-ordered pick, not an arbitrary one.
 *
 * Returns null only when nothing is installed — the one case where there is
 * genuinely no honest default to show.
 *
 * @param {{id: string, installed?: boolean}[] | undefined} clis
 * @returns {string | null}
 */
export function pickDefaultCli(clis) {
  const installed = (clis || []).filter((c) => c.installed);
  return installed.length > 0 ? installed[0].id : null;
}
