// Plain .mjs so tests/lib/saved-cli-pick.test.mjs can import the REAL functions
// under `node --test` (no TypeScript loader). saved-cli.ts re-exports these, so
// there is one implementation rather than a mirrored copy in the suite.

/** The single installed CLI, or null when there is not exactly one. */
export function pickSoleInstalled(clis) {
  const installed = (clis || []).filter((c) => c && c.installed);
  return installed.length === 1 ? installed[0].id : null;
}

/**
 * The CLI the Config page should start on: the first installed one, whatever
 * the count.
 *
 * Config renders this as the active choice, so it must also be the value that
 * gets persisted. Persisting only the SOLE installed CLI left anyone with two
 * or more looking at a selected CLI over empty localStorage -- and every AI
 * surface reads that key, so they all silently did nothing.
 */
export function pickDefaultInstalled(clis) {
  return (clis || []).find((c) => c && c.installed)?.id || null;
}

/**
 * `id` when it is still an installed CLI, otherwise null.
 *
 * A saved id outlives the CLI it names: swap one install for another and the
 * old id stays in localStorage, and every run against it 404s (#4012).
 */
export function keepIfInstalled(id, clis) {
  if (!id) return null;
  return (clis || []).some((c) => c && c.id === id && c.installed) ? id : null;
}
