const HTTP = /^https?:\/\//i;

/**
 * @typedef {{ kind: "apply", href: "/apply", url: string, n: string }} ApplyGo
 * @typedef {{ kind: "need-cv" | "need-link", message: string, nextHref: string | null, nextLabel: string | null }} ApplyStop
 */

/**
 * @param {{ n?: string, pdfOnDisk?: boolean, postingUrl?: string, alreadyOnReport?: boolean }} [input]
 * @returns {ApplyGo | ApplyStop}
 */
export function applyDestination({ n, pdfOnDisk = false, postingUrl, alreadyOnReport = false } = {}) {
  const id = String(n ?? "").trim();
  const reportHref = `/pipeline/${encodeURIComponent(id)}`;
  if (!pdfOnDisk) {
    if (alreadyOnReport) {
      return {
        kind: "need-cv",
        message: "Generate the tailored CV on this page before you apply. Apply opens the form reader after that file is on disk.",
        nextHref: null,
        nextLabel: null,
      };
    }
    return {
      kind: "need-cv",
      message: "This offer needs a tailored CV on disk before you can apply.",
      nextHref: reportHref,
      nextLabel: "Open the report to generate the CV",
    };
  }
  const url = typeof postingUrl === "string" ? postingUrl.trim() : "";
  if (!HTTP.test(url)) {
    return {
      kind: "need-link",
      message: "This offer has no application link, so the form reader cannot open it.",
      nextHref: alreadyOnReport ? null : reportHref,
      nextLabel: alreadyOnReport ? null : "Open the report",
    };
  }
  return { kind: "apply", href: "/apply", url, n: id };
}

/**
 * @param {{ dest: ApplyGo | ApplyStop, company?: string, from?: string }} input
 * @returns {{ href: string, url: string, opts: { prefill: true, company: string, n: string, from: string } } | null}
 */
export function applyOpenArgs({ dest, company = "", from = "" }) {
  if (!dest || dest.kind !== "apply") return null;
  return {
    href: dest.href,
    url: dest.url,
    opts: { prefill: true, company, n: dest.n, from },
  };
}
