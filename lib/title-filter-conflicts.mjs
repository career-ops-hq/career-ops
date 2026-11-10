// lib/title-filter-conflicts.mjs -- read-only review of a `title_filter` that
// contradicts itself.
//
// A `title_filter` entry that appears in BOTH lists can never do either job.
// `title_filter.positive` decides what the scanner keeps and
// `title_filter.negative` decides what it vetoes, and buildTitleFilter()
// requires `hasPositive && !hasNegative` (title-keywords.mjs) -- so a title
// written the same way in both is matched by both and rejected. The positive
// entry looks like a target you are searching for and is silently a no-op: the
// scan summary reports the posting under `filtered_title` alongside everything
// else the negatives caught, and nothing in the output says which keyword did
// it (#4873).
//
// "Both lists" is checked on the representative title, not on the raw string.
// The two sides normalize differently -- a positive AND-group ("director +
// engineering") and a negative word-prefix both rewrite the text before
// matching -- so comparing the entries character-for-character would miss
// cases that really do collide and invent ones that do not. Each conflict
// therefore carries the `title` it was decided on: one entry can stand for
// several real titles, and only the one that was checked is being reported.
//
// The shipped example already warns about HALF of this in prose --
// templates/portals.example.yml explains that a bare "Intern" negative makes
// the "Internal Tools" positive unmatchable. Prose cannot tell a reader
// whether THEIR list has the problem. This module answers that question with
// the same matcher the scanner uses, so the answer cannot drift from the scan.
//
// What this is NOT:
//   - It does not write to portals.yml. Callers own any confirmation gate;
//     this module only reports. doctor.mjs, the caller today, is read-only by
//     design (its own --json mode is documented as such).
//   - It does not remove or regenerate anything. A positive that is
//     deliberately unreachable (kept for a company override, say) stays put.
//   - It does not claim "every title in this role family is excluded". It
//     checks the literal entries the user wrote, which is all it can know.
//
// The matcher is `compilePositiveKeyword` for the positive side and
// `compileKeyword` for the negative side, exactly as buildTitleFilter uses
// them, so an AND-group ("director + engineering") and a `word:` / `stem:`
// prefix behave here the way they behave in a scan.

import { compileKeyword, compilePositiveKeyword, foldAccents, AND_SEPARATOR } from '../title-keywords.mjs';

/**
 * The literal entries of a keyword list, normalized the way
 * buildTitleFilter's own `normalize` does: drop non-strings, trim, lowercase,
 * fold accents, drop empties. Order is preserved so a report can list the
 * entries in the order the user wrote them.
 *
 * @param {unknown} list - A `positive` or `negative` value from the YAML.
 * @returns {string[]}
 */
function normalizeEntries(list) {
  return (Array.isArray(list) ? list : [])
    .filter((k) => typeof k === 'string')
    .map((k) => foldAccents(k.trim().toLowerCase()))
    .filter((k) => k.length > 0);
}

/**
 * The representative title a positive entry stands for.
 *
 * A positive entry is either one keyword or an AND-group of them, and
 * buildTitleFilter treats the group as "every term must appear". To test
 * whether the negative side vetoes the entry, the two terms have to be put
 * back into one title-shaped string -- joined with a single space, which is
 * the separator the AND_SEPARATOR itself is defined around (" + " between
 * terms, whitespace-delimited). `stem:` and `word:` prefixes are stripped
 * first: they are matching instructions, not part of the title a posting
 * would carry.
 *
 * @param {string} entry - A normalized positive entry.
 * @returns {string}
 */
export function representativeTitle(entry) {
  return entry
    .split(AND_SEPARATOR)
    .map((term) => term.trim().replace(/^(?:word|stem):/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Which `title_filter.negative` entry, if any, vetoes a positive entry.
 *
 * Returns the RAW (as-written, but lowercased and accent-folded) negative
 * entry so a caller can quote the exact line the user has to look at. The
 * compiled matchers are built once per call, matching how
 * matchedTitleKeywords() in scan.mjs caches per `positive` array reference;
 * this function runs once per diagnosis, not once per job, so the simpler
 * per-call compile is both correct and cheap.
 *
 * @param {string} representative - Output of representativeTitle().
 * @param {Array<{raw: string, match: (lower: string) => boolean}>} negatives
 * @returns {string|null}
 */
function vetoingNegative(representative, negatives) {
  const lower = foldAccents(representative.toLowerCase());
  const hit = negatives.find((n) => n.match(lower));
  return hit ? hit.raw : null;
}

/**
 * Review a `title_filter` for positives the negatives make unreachable.
 *
 * @param {{positive?: unknown, negative?: unknown}} [titleFilter]
 * @returns {{
 *   conflicts: Array<{positive: string, negative: string, title: string, reason: string}>,
 * }}
 *   `conflicts` is empty when the filter is coherent, and each entry names the
 *   positive, the negative that vetoes it, the representative `title` the two
 *   were compared on, and a one-line reason. There is no config echo in the
 *   result: the caller already holds the config, and copying it here would
 *   imply this module owns it.
 */
export function findTitleFilterConflicts(titleFilter) {
  const positives = normalizeEntries(titleFilter?.positive);
  const negatives = normalizeEntries(titleFilter?.negative).map((raw) => ({
    raw,
    match: compileKeyword(raw),
  }));

  if (positives.length === 0 || negatives.length === 0) {
    return { conflicts: [] };
  }

  const conflicts = [];
  for (const entry of positives) {
    const title = representativeTitle(entry);
    // compilePositiveKeyword decides whether the entry would match at all. An
    // entry that matches NOTHING -- a bare `word:` typo, say -- is a different
    // problem (title-keywords.mjs calls it out and returns false), and it is
    // not this check's job to re-report it. Only an entry that DOES match, and
    // is then vetoed, belongs here; otherwise every typo would also be listed
    // as a "conflict" and the signal would drown.
    if (!compilePositiveKeyword(entry)(title)) continue;
    const negative = vetoingNegative(title, negatives);
    if (!negative) continue;
    // Scoped to `title`, not to the entry as a whole. A positive entry can
    // match several real titles -- bare "intern" matches "Internal Tools
    // Engineer" too, and `word:intern` does not veto that one -- so saying the
    // entry "can never pass" would be false. What IS true is that the title
    // this entry stands for is vetoed by its own negative. The `title` field
    // is returned so the reader can see which string the verdict is about.
    conflicts.push({
      positive: entry,
      negative,
      title,
      reason: `positive "${entry}" stands for the title "${title}", which negative "${negative}" vetoes`,
    });
  }

  return { conflicts };
}
