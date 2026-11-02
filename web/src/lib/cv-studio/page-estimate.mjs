// One US Letter page in the preview iframe, at 96px per inch.
export const PREVIEW_PAGE_PX = 1056;

function pageBoxes(body) {
  if (!body || typeof body.querySelectorAll !== "function") return [];
  return [...body.querySelectorAll(".page")];
}

function placed(el) {
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
  const height = Math.max(rect?.height || 0, el.scrollHeight || 0, el.offsetHeight || 0);
  return { top, bottom: top + height };
}

// display:none reports a zero box at the origin. Treating that as the start
// of the CV turns the body margin into extra height.
function hasBox(el) {
  if (!el) return false;
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  const width = Math.max(rect && Number.isFinite(rect.width) ? rect.width : 0, el.offsetWidth || 0);
  const height = Math.max(rect && Number.isFinite(rect.height) ? rect.height : 0, el.offsetHeight || 0, el.scrollHeight || 0);
  return width > 0 || height > 0;
}

// A footer can sit after .page. The body's own scroll height cannot be used
// for this: it repeats the iframe viewport, which is the bug the page count
// was changed to avoid.
function heightAfterPages(body, pages) {
  const kids = body.children;
  if (!kids || typeof kids[Symbol.iterator] !== "function") return 0;
  const pageBottom = pages.length > 0 ? Math.max(...pages.map((page) => placed(page).bottom)) : 0;
  let extra = 0;
  for (const el of kids) {
    if (!el || pages.includes(el)) continue;
    if (typeof el.contains === "function" && pages.some((page) => el.contains(page))) continue;
    // Margin sits above the border box, so the height alone stops short of the footer.
    const below = placed(el).bottom - pageBottom;
    if (below > extra) extra = below;
  }
  return extra;
}

// Markup before the first .page is part of the CV. The body's own margin is
// not: the span starts at the first child's border, so the iframe can still
// keep that offset without it adding a page.
function contentAbovePages(body, pages) {
  const kids = body.children;
  if (!kids || typeof kids[Symbol.iterator] !== "function" || pages.length === 0) return 0;
  let first = null;
  for (const el of kids) {
    if (hasBox(el)) {
      first = el;
      break;
    }
  }
  if (!first) return 0;
  const above = Math.min(...pages.map((page) => placed(page).top)) - placed(first).top;
  return above > 0 ? above : 0;
}

/**
 * Height of the CV content.
 *
 * The iframe's own height is the previous measurement. Reading
 * documentElement.scrollHeight then repeats that viewport, so a shorter CV
 * stays on the old page count. The content box does not stretch with the iframe.
 *
 * @param {Document | null | undefined} doc
 * @returns {number}
 */
export function contentHeightPx(doc) {
  const body = doc?.body;
  if (!body) return 0;
  // A user template can lay its CV out as several sibling .page boxes.
  // The page count runs from the first child through the last page, so a
  // margin above that first child does not add a page.
  const pages = pageBoxes(body);
  const extra = heightAfterPages(body, pages);
  const above = contentAbovePages(body, pages);
  if (pages.length > 1) {
    const boxes = pages.map(placed);
    const extent = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    const height = extent + extra + above;
    return height > 0 ? height : 0;
  }
  const page = pages[0] || (typeof body.querySelector === "function" ? body.querySelector(".page") : null);
  if (!page) {
    const height = body.scrollHeight || body.offsetHeight || 0;
    return height > 0 ? height : 0;
  }
  // scrollHeight stops at the padding edge. The border is part of the page,
  // and the iframe already measures that same box.
  const measured = placed(page);
  const height = measured.bottom - measured.top + extra + above;
  return height > 0 ? height : 0;
}

/**
 * Height to write back after measuring at one page.
 * An unchanged measurement must not leave the one-page probe on the iframe.
 *
 * @param {number} measured
 * @param {number} current
 */
export function frameHeightAfterProbe(measured, current) {
  return measured > 0 ? measured : current;
}

/** Iframe height. Includes the offset above the first page so the margin is not clipped. */
export function frameHeightPx(doc) {
  const body = doc?.body;
  if (!body) return 0;
  const pages = pageBoxes(body);
  if (pages.length > 0) {
    const bottom = Math.max(...pages.map((page) => placed(page).bottom)) + heightAfterPages(body, pages);
    return bottom > 0 ? bottom : 0;
  }
  const height = body.scrollHeight || body.offsetHeight || 0;
  return height > 0 ? height : 0;
}

/** @param {number} contentPx */
export function previewPageCount(contentPx) {
  if (!contentPx || contentPx <= 0) return 1;
  return Math.max(1, Math.ceil(contentPx / PREVIEW_PAGE_PX));
}
