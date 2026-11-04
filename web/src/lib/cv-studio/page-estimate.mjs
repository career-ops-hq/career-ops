// One US Letter page in the preview iframe, at 96px per inch.
export const PREVIEW_PAGE_PX = 1056;

function pageBoxes(body) {
  if (!body || typeof body.querySelectorAll !== "function") return [];
  // A display:none page has a zero box at the origin. With another page,
  // that origin becomes the top of the extent and adds a page.
  return [...body.querySelectorAll(".page")].filter(hasBox);
}

function placed(el) {
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
  const height = Math.max(rect?.height || 0, el.scrollHeight || 0, el.offsetHeight || 0);
  return { top, bottom: top + height };
}

// visibility:hidden keeps a box, but that box is not content. A child can set
// visibility back to visible, so callers still walk into this element.
function isInvisible(el) {
  const getComputedStyle = el.ownerDocument?.defaultView?.getComputedStyle;
  if (typeof getComputedStyle !== "function") return false;
  try {
    return getComputedStyle(el)?.visibility === "hidden";
  } catch {
    return false;
  }
}

// display:none reports a zero box at the origin. Treating that as the start
// of the CV turns the body margin into extra height. display:contents has no
// box either, but its children can, so those still count.
function hasBox(el) {
  if (!el) return false;
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  const width = Math.max(rect && Number.isFinite(rect.width) ? rect.width : 0, el.offsetWidth || 0);
  const height = Math.max(rect && Number.isFinite(rect.height) ? rect.height : 0, el.offsetHeight || 0, el.scrollHeight || 0);
  if (!(width > 0 || height > 0)) return false;
  return !isInvisible(el);
}

// The highest box can come later in the DOM than .page. The first box in
// source order would treat the page as the start and drop the header above it.
function firstRendered(nodes) {
  if (!nodes || typeof nodes[Symbol.iterator] !== "function") return null;
  let best = null;
  let bestTop = Infinity;
  for (const el of nodes) {
    if (!el) continue;
    if (hasBox(el)) {
      const top = placed(el).top;
      if (top < bestTop) {
        best = el;
        bestTop = top;
      }
    }
    const nested = firstRendered(el.children);
    if (nested && placed(nested).top < bestTop) {
      best = nested;
      bestTop = placed(nested).top;
    }
  }
  return best;
}

// A footer can sit after .page, including inside a display:contents wrapper.
// That wrapper has no box, and it may also wrap the page, so the scan walks
// into it and still skips the page itself. The body's own scroll height
// cannot be used here: it repeats the iframe viewport.
function heightAfterPages(body, pages) {
  const kids = body.children;
  if (!kids || typeof kids[Symbol.iterator] !== "function") return 0;
  const pageBottom = pages.length > 0 ? Math.max(...pages.map((page) => placed(page).bottom)) : 0;
  let extra = 0;
  const pending = [...kids];
  for (let i = 0; i < pending.length; i++) {
    const el = pending[i];
    if (!el || pages.includes(el)) continue;
    const holdsPage = typeof el.contains === "function" && pages.some((page) => el.contains(page));
    if (holdsPage || !hasBox(el)) {
      if (el.children && typeof el.children[Symbol.iterator] === "function") pending.push(...el.children);
      if (!(holdsPage && hasBox(el))) continue;
    }
    // Margin sits above the border box, so the height alone stops short of the footer.
    const below = placed(el).bottom - pageBottom;
    if (below > extra) extra = below;
  }
  return extra;
}

// Markup above .page is part of the CV, even when that markup comes later in
// the DOM. The body's own margin is not: the span starts at the highest box,
// so the iframe can still keep that offset without it adding a page.
function contentAbovePages(body, pages) {
  const kids = body.children;
  if (!kids || typeof kids[Symbol.iterator] !== "function" || pages.length === 0) return 0;
  const first = firstRendered(kids);
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
    const childBottom = heightAfterPages(body, []);
    const height = childBottom > 0 ? childBottom : body.scrollHeight || body.offsetHeight || 0;
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
  const childBottom = heightAfterPages(body, []);
  const height = childBottom > 0 ? childBottom : body.scrollHeight || body.offsetHeight || 0;
  return height > 0 ? height : 0;
}

/** @param {number} contentPx */
export function previewPageCount(contentPx) {
  if (!contentPx || contentPx <= 0) return 1;
  return Math.max(1, Math.ceil(contentPx / PREVIEW_PAGE_PX));
}
