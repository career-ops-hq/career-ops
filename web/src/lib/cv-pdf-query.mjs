/**
 * @param {{ get(name: string): string | null }} searchParams
 * @returns {{ n: string, company: string, application: string, kind: "cv" | "cover" }}
 */
export function cvPdfSelectors(searchParams) {
  return {
    n: (searchParams.get("n") ?? "").trim(),
    company: (searchParams.get("company") ?? "").trim(),
    application: (searchParams.get("application") ?? "").trim(),
    kind: searchParams.get("kind") === "cover" ? "cover" : "cv",
  };
}

export function pdfDownloadHref(viewHref) {
  return `${viewHref}${viewHref.includes("?") ? "&" : "?"}download=1`;
}

export function pdfRevealHref(viewHref) {
  const q = viewHref.indexOf("?");
  const pathname = q === -1 ? viewHref : viewHref.slice(0, q);
  const query = q === -1 ? "" : viewHref.slice(q);
  return `${pathname.replace(/\/api\/cv-pdf$/, "/api/cv-reveal")}${query}`;
}
