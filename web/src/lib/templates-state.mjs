// What a reload of the Templates list may do to the screen. Kept out of the
// component so both rules are tested without React.

/**
 * Hands out one check per load. A check answers true only while its load is the
 * newest one started, so a slow earlier response cannot overwrite a newer list.
 * `stop()` makes every outstanding check false (the component unmounted).
 * @returns {{ (): () => boolean, stop(): void }}
 */
export function latestOnly() {
  let current = 0;
  const guard = () => {
    const mine = ++current;
    return () => mine === current;
  };
  guard.stop = () => {
    current++;
  };
  return guard;
}

/**
 * The open duplicate/rename/delete form, or null once its template is gone from
 * the reloaded list. Left set, it would reopen a stale form the moment a template
 * with the same name appeared again.
 * @template {{name: string}} P
 * @param {P | null} pending
 * @param {{name: string}[]} templates
 * @returns {P | null}
 */
export function pendingAfterReload(pending, templates) {
  return pending && templates.some((t) => t.name === pending.name) ? pending : null;
}
