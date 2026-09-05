import { asciiFold } from "./ascii-fold.mjs";

/**
 * Plausible domains for a company name, cheapest/likeliest first.
 *
 * Extracted from app/api/logo/route.ts so it can be exercised directly — a
 * route handler is not reachable from `node --test`, and this is the half of
 * the logo resolver that decides whether a company can EVER get a logo. Same
 * move as funnel-tiles.mjs / clean-chips.mjs / whats-new-suppression.mjs.
 *
 * THE FOLD IS THE POINT. The stems used to be built by DELETING every
 * character outside `[a-z0-9]`, which is the defect lib/ascii-fold.mjs exists
 * to end — its docstring names verify-portals.mjs (#2930) and
 * providers/_trust-validator.mjs (#2924) as the two prior instances, and this
 * was a third. A domain is ASCII by construction, so an accented letter has an
 * ASCII counterpart the real domain actually uses:
 *
 *   Telefónica        deleted -> telefnica.com       folded -> telefonica.com
 *   Škoda             deleted -> koda.com            folded -> skoda.com
 *   Ørsted            deleted -> rsted.com           folded -> orsted.com
 *   Société Générale  deleted -> socitgnrale.com     folded -> societegenerale.com
 *
 * It matters more here than in a comparison, because the logo cache never
 * expires and stores misses as an empty sentinel: a domain that was never going
 * to resolve is cached as "this company has no logo" permanently.
 *
 * A name with no Latin content (CJK, Cyrillic, Greek) folds to '' and yields no
 * stems — the same real answer the core module documents. The curated override
 * is still consulted first, so a brand that is in the map resolves regardless.
 *
 * `&` becomes "and" BEFORE folding, because the fold would otherwise delete it:
 * "AT&T" has to stay attandt, which is what the pre-fold resolver produced.
 * `firstWord` folds the raw first token rather than splitting the &-expanded
 * string, so it stays "att" as before rather than becoming "atandt".
 *
 * @param {string} company - Raw company name, as it appears on a posting.
 * @param {(name: string) => string|null} curatedDomain - The curated brand-map
 *   lookup (lib/company.ts). Injected rather than imported: this file is plain
 *   .mjs so node:test can load it without a TS runner, and the map is TS.
 * @returns {string[]} Up to 5 domain candidates, curated first.
 */
export function companyDomains(company, curatedDomain = () => null) {
  const paren = String(company ?? "").match(/\(([A-Za-z0-9]{2,12})\)/)?.[1]; // "… (5WPR)"
  // [^()] (not [^)]) keeps the match unambiguous — no polynomial backtracking on
  // adversarial inputs full of unclosed parens (CodeQL js/polynomial-redos).
  const base = String(company ?? "").replace(/\([^()]*\)/g, "").trim();

  const fold = (s) => asciiFold(s, { punctuation: "delete" }).replace(/ /g, "");
  const compact = fold(base.replace(/&/g, "and"));
  const firstWord = fold(base.split(/\s+/)[0] ?? "");

  const stems = [...new Set([compact, paren?.toLowerCase(), firstWord]
    .filter((s) => !!s && s.length >= 2 && s.length <= 30))];

  const out = [];
  const curated = curatedDomain(base);
  if (curated) out.push(curated);
  for (const t of [".com", ".ai", ".io", ".co"]) for (const s of stems) out.push(s + t);
  return [...new Set(out)].slice(0, 5);
}
