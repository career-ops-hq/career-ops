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

/**
 * The CLI a server route should run for a requested `id`, by the same rule the
 * client's resolveCliId() applies before a Run: `id` itself while it is
 * installed, otherwise the sole installed CLI. `substitutedFrom` names the
 * requested id whenever the answer is a different CLI, so the caller can say so
 * instead of silently running another runtime. `id` is null when there is no
 * unambiguous answer (nothing installed, or two or more to choose between).
 *
 * Every AI route but Run sends the saved id unchecked, so without this a stale
 * one 404s on each of them with no way back (#4607).
 */
export function pickUsableCli(id, clis) {
  const kept = keepIfInstalled(id, clis);
  if (kept) return { id: kept, substitutedFrom: null };
  const sole = pickSoleInstalled(clis);
  return sole ? { id: sole, substitutedFrom: id || null } : { id: null, substitutedFrom: null };
}

/** Installed CLI ids, for an error that tells the user what they can pick. */
export function installedCliIds(clis) {
  return (clis || []).filter((c) => c && c.installed && typeof c.id === "string").map((c) => c.id);
}
