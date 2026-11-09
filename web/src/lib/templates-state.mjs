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

/**
 * Save a chosen default and settle the screen. On success the choice is applied
 * and a newer reload starts, so latestOnly discards an earlier in-flight response
 * that captured the old default. On failure nothing is applied or reloaded.
 * @param {() => Promise<{ok: boolean, error?: string}>} save
 * @param {{applied: () => void, reload: () => void, failed: (message: string) => void}} on
 */
export async function settleChoice(save, { applied, reload, failed }) {
  let outcome;
  try {
    outcome = await save();
  } catch {
    failed("Could not save.");
    return;
  }
  if (!outcome.ok) {
    failed(outcome.error || "Could not save.");
    return;
  }
  applied();
  reload();
}

/**
 * How a failed reload shows. "alongside" keeps the list with the error and Retry
 * beside it, which is right only when the list on screen is known to be current
 * (a saved default). "replace" swaps the list for the error: a first load has no
 * list, and after a duplicate, rename or delete the list is stale.
 * @param {boolean} listIsCurrent
 * @param {boolean} hasList
 * @returns {"alongside" | "replace"}
 */
export function loadFailureView(listIsCurrent, hasList) {
  return listIsCurrent && hasList ? "alongside" : "replace";
}
