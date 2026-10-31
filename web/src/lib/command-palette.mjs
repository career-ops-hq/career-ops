import { companyPresentation, companySearchText } from "./company-presentation.mjs";

/**
 * @typedef {{ id: string, kind: "page" | "application", label: string, detail: string, tag: string, href: string, search: string }} PaletteItem
 */

/**
 * @param {{ href: string, label: string }[]} pages
 * @param {{ n: string, company?: string, via?: string, role?: string, status?: string, score?: string }[]} applications
 * @returns {PaletteItem[]}
 */
export function paletteItems(pages, applications) {
  return [
    ...pages.map(({ href, label }) => ({
      id: `page:${href}`,
      kind: /** @type {const} */ ("page"),
      label,
      detail: "",
      tag: "Page",
      href,
      search: label.toLowerCase(),
    })),
    ...applications.map((app) => ({
      id: `application:${app.n}`,
      kind: /** @type {const} */ ("application"),
      label: companyPresentation(app).label,
      detail: [app.role, app.status, app.score].filter(Boolean).join(" · "),
      tag: `#${app.n}`,
      href: `/pipeline/${encodeURIComponent(app.n)}`,
      search: `${companySearchText(app)} #${app.n} ${app.n} ${app.status ?? ""}`.toLowerCase(),
    })),
  ];
}

/**
 * @param {PaletteItem[]} items
 * @param {string} query
 * @param {number} limit
 * @returns {PaletteItem[]}
 */
export function rankPalette(items, query, limit) {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((item) => item.kind === "page").slice(0, limit);
  const tokens = q.split(/\s+/);
  /** @param {PaletteItem} item */
  const rank = (item) => {
    const label = item.label.toLowerCase();
    const tier = label.startsWith(q) ? 0 : label.split(/\s+/).some((word) => word.startsWith(tokens[0])) ? 1 : 2;
    return tier * 2 + (item.kind === "page" ? 0 : 1);
  };
  return items
    .filter((item) => tokens.every((token) => item.search.includes(token)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit);
}
