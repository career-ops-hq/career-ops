/**
 * outcome-types.mjs — the ONE vocabulary of application outcomes.
 *
 * `outcome.mjs` accepts a type on the command line, normalizes it, and writes
 * it verbatim into `data/outcomes/{...}/outcome.md` as
 * `- **Outcome Type**: {key}`. Anything that later READS that journal has to
 * accept every spelling the writer accepts, or a recorded outcome is invisible
 * to it.
 *
 * That is not hypothetical: `calibrate.mjs` shipped with a private 7-entry copy
 * of a 14-entry vocabulary, so half the spellings `outcome.mjs` had always
 * accepted resolved to nothing there. Two of them (`declined`, `ghosted`) were
 * dropped from calibration entirely, and a journal whose LAST entry used an
 * alias reported its previous, happier entry — the exact behaviour
 * parseOutcomeJournal's docstring promises never happens.
 *
 * So the map lives here and both ends import it. `outcome.mjs` cannot be
 * imported (it is a top-level CLI that exits on load), which is why a reader
 * could not simply reuse its copy and ended up writing a second one.
 */

/**
 * Every accepted outcome type → the tracker state it sets and its default note.
 * Moved here verbatim from outcome.mjs; `outcome.mjs` remains the only writer.
 */
export const OUTCOME_MAP = {
  interview_progress: { state: 'Interview', defaultNote: 'Stage updated' },
  stage_reached: { state: 'Interview', defaultNote: 'Stage updated' },
  interview: { state: 'Interview', defaultNote: 'Interview stage' },
  offer_received: { state: 'Offer', defaultNote: 'Offer received' },
  offer: { state: 'Offer', defaultNote: 'Offer received' },
  hired: { state: 'Hired', defaultNote: 'Offer accepted' },
  accepted: { state: 'Hired', defaultNote: 'Offer accepted' },
  offer_declined: { state: 'Discarded', defaultNote: 'Offer declined by candidate' },
  declined: { state: 'Discarded', defaultNote: 'Offer declined by candidate' },
  rejected: { state: 'Rejected', defaultNote: 'Application rejected' },
  rejection: { state: 'Rejected', defaultNote: 'Application rejected' },
  no_response: { state: 'Discarded', defaultNote: 'No response / ghosted' },
  ghosted: { state: 'Discarded', defaultNote: 'No response / ghosted' },
  interview_only: { state: 'Interview', defaultNote: 'Interview process completed' },
};

/**
 * The seven types `outcome.mjs`'s own USAGE line advertises. Every other key in
 * OUTCOME_MAP is a synonym for one of these.
 */
export const CANONICAL_OUTCOMES = [
  'interview_progress', 'interview_only', 'offer_received', 'hired',
  'offer_declined', 'rejected', 'no_response',
];

/**
 * Synonym → the canonical type that carries its meaning.
 *
 * Written out rather than derived. Deriving it from the `{state, defaultNote}`
 * pairs above looks tighter and is wrong: `interview` shares a state with
 * `interview_progress` but carries its own note, and `offer_declined`,
 * `no_response` and their synonyms all share the state `Discarded` while
 * meaning opposite things about the outcome. State is a tracker position, not a
 * result. What stops an omission here is the coverage check below and the drift
 * test, not cleverness.
 */
const ALIASES = {
  stage_reached: 'interview_progress',
  interview: 'interview_progress',
  offer: 'offer_received',
  accepted: 'hired',
  declined: 'offer_declined',
  rejection: 'rejected',
  ghosted: 'no_response',
};

// A synonym added to OUTCOME_MAP without a meaning here is a real decision, not
// a spelling. Fail loudly at load rather than let it read as unknown wherever
// the journal is consumed — which is the failure this module exists to end.
for (const key of Object.keys(OUTCOME_MAP)) {
  if (!CANONICAL_OUTCOMES.includes(key) && !(key in ALIASES)) {
    throw new Error(`outcome-types.mjs: "${key}" is accepted by outcome.mjs but has no canonical meaning; add it to ALIASES or CANONICAL_OUTCOMES`);
  }
}

/**
 * Resolve any accepted spelling to its canonical type.
 *
 * Applies the same normalization `outcome.mjs` applies before writing
 * (lowercase, `-` → `_`), so a hand-edited journal saying `Offer-Declined`
 * still resolves.
 *
 * @param {unknown} raw - A type as written in a journal or typed on the CLI.
 * @returns {string|null} The canonical type, or null when unrecognized.
 */
export function canonicalOutcome(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (CANONICAL_OUTCOMES.includes(key)) return key;
  return ALIASES[key] ?? null;
}
