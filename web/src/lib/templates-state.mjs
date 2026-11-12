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
 * The template open in the editor, or null once it is gone from the reloaded
 * list. The editor already hides itself for a missing template; clearing the
 * name stops it reopening when a template with that name appears again.
 * @param {string | null} editing
 * @param {{name: string}[]} templates
 * @returns {string | null}
 */
export function editingAfterReload(editing, templates) {
  return editing && templates.some((t) => t.name === editing) ? editing : null;
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

/**
 * Which of a card's actions to disable while a template is open in the editor.
 * The editor holds unsaved text the section cannot see, so whatever would unmount
 * it waits for Close, which already offers "Discard and close": removing its own
 * template (rename or delete), or switching the editor to another card. Edit on
 * its own card is a no-op and stays on; other cards' rename and delete leave the
 * open template alone.
 * @param {string | null} editing name of the template open in the editor
 * @param {string} name the card's template
 * @returns {{edit: boolean, rename: boolean, remove: boolean}}
 */
export function editLocks(editing, name) {
  const open = editing !== null;
  const own = open && editing === name;
  return { edit: open && !own, rename: own, remove: own };
}
