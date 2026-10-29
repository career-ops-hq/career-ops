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
  // The page count is the distance from the first box to the last, so a
  // margin above the first page does not add a page.
  const pages = pageBoxes(body);
  if (pages.length > 1) {
    const boxes = pages.map(placed);
    const extent = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    return extent > 0 ? extent : 0;
  }
  const page = pages[0] || (typeof body.querySelector === "function" ? body.querySelector(".page") : null);
  const box = page || body;
  const height = box.scrollHeight || box.offsetHeight || 0;
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
    const bottom = Math.max(...pages.map((page) => placed(page).bottom));
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
