/**
 * Derive the key used to find a company's tailored CV in output/, where the pdf
 * mode names files `cv-{candidate}-{company}-{date}.pdf`.
 *
 * Returns null when the company yields no key. Callers must treat that as "this
 * company cannot be identified" and find nothing, never as "match anything": the
 * slug is built from ASCII alphanumerics only (accents folded), so a company that contributes
 * none of them collapses to the empty string, and an empty needle is contained
 * in every filename. The result is attached to a real application, so the only
 * safe answer is no answer.
 *
 * Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
 * pattern that backtracks polynomially on adversarial input (CodeQL).
 *
 * @param {string | undefined | null} company
 * `keys` lists every slug a file could carry for this company: the folded
 * `slug` (what lib/output-names.mjs writes) and, for an accented name, the
 * `legacy` slug that drops the accented letters ("zo-caf"), which covers written
 * without --report and older CVs still carry. Resolvers match them through
 * matchesCompanyKeys() (cv-match.mjs), which applies the legacy slug to
 * non-standard names only.
 *
 * @returns {{ slug: string, first: string, legacy: string, keys: string[] } | null}
 */
export function companySlug(company) {
  const c = (company ?? "").trim();
  if (!c) return null;
  // Fold accents first ("Zoë Café" -> "zoe-cafe") so the key agrees with
  // kebab() in lib/output-names.mjs, which names the standard files (#6667).
  const folded = c.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const slug = (folded.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  if (!slug) return null;
  const legacy = (c.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  // A legacy key that is a kind word ("CVé" -> "cv", "Coveré" -> "cover") would
  // match every cv-*.pdf / *-cover.pdf, whatever the company, so it is dropped.
  const usable = legacy && legacy !== slug && legacy !== "cv" && legacy !== "cover";
  const keys = usable ? [slug, legacy] : [slug];
  return { slug, first: slug.split("-")[0], legacy: legacy || slug, keys };
}
