/**
 * Derive the key used to find a company's tailored CV in output/, where the pdf
 * mode names files `cv-{candidate}-{company}-{date}.pdf`.
 *
 * Returns null when the company yields no key. Callers must treat that as "this
 * company cannot be identified" and find nothing, never as "match anything": the
 * slug is built from ASCII alphanumerics only, so a company that contributes
 * none of them collapses to the empty string, and an empty needle is contained
 * in every filename. The result is attached to a real application, so the only
 * safe answer is no answer.
 *
 * Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
 * pattern that backtracks polynomially on adversarial input (CodeQL).
 *
 * @param {string | undefined | null} company
 * @returns {{ slug: string, first: string } | null}
 */
export function companySlug(company) {
  const c = (company ?? "").trim();
  if (!c) return null;
  const slug = (c.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  if (!slug) return null;
  return { slug, first: slug.split("-")[0] };
}
