// Pure JS implementation of cleanChips — no TypeScript types so it can be
// imported directly by both explore.ts (which re-exports it) and by
// clean-chips.test.mjs (which can't import .ts without a runner).
// This is the single source of truth for the chip-cleaning logic.

/**
 * Upper bound on a keyword list — a sanity rail against a pathological paste
 * (a whole spreadsheet column, a JSON blob), NOT a limit on how many keywords a
 * search may use.
 *
 * It was 16, which is smaller than the config it has to carry:
 *
 * 1. `templates/portals.example.yml` ships **37** `title_filter.positive`
 *    keywords, so the project's own default could not survive a round-trip
 *    through the Explorer. seedExploreFilters() read 37 and handed the scanner
 *    16, with nothing shown to the user. The CLI reads the same portals.yml and
 *    uses all 37 — so `scan` and the web Explorer silently ran different
 *    searches off one config file.
 *
 * 2. Worse, the cap applied to a MERGE. filter-builder's commit() cleans
 *    `[...existing, ...pasted]`, so on any list already over the cap, adding a
 *    single chip kept the first 16 entries, dropped the other 21, and did not
 *    append the new chip either — a keystroke that deletes data.
 *
 * The bound stays because unbounded is not a property worth having on a value
 * that gets serialized into a YAML file and passed to a scanner; it is just
 * sized to bound the process rather than the user.
 */
export const CHIP_CAP = 512;

/** Trim, drop empties, de-dupe case-insensitively, cap length. */
export function cleanChips(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const k = item.trim();
    if (!k) continue;
    if (!/[\p{L}\p{N}]/u.test(k)) continue; // drop punctuation-only junk (e.g. a stray "*")
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= CHIP_CAP) break;
  }
  return out;
}
