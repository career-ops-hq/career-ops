/**
 * What the status control says after a successful write.
 *
 * Since #3470 the CLI seeds a follow-up itself when a row moves to Applied and
 * reports `followupSeeded` in its JSON. Telling the user the date closes a loop
 * that was otherwise invisible: something was scheduled on their behalf and
 * nothing on screen said so.
 *
 * Plain .mjs, no `@/` alias, so node --test reaches it without a build step.
 *
 * @param {{ seeded?: boolean, nextDate?: string|null, reason?: string }|null|undefined} followupSeeded
 * @returns {{ kind: "saved" }|{ kind: "followup", date: string }}
 */
export function statusFeedback(followupSeeded) {
  // Only a seed that actually happened AND carries a date earns the louder
  // message. `seeded: true` with no date would render "follow-up undefined",
  // and a failed seed is not the user's problem at this moment: the status
  // change itself succeeded, which is what they asked for.
  if (followupSeeded?.seeded === true && typeof followupSeeded.nextDate === "string" && followupSeeded.nextDate) {
    return { kind: "followup", date: followupSeeded.nextDate };
  }
  return { kind: "saved" };
}
