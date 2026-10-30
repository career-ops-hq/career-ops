export const TRACKER_ROW_PX = 57;
export const TRACKER_OVERSCAN = 6;

// First paint, before layout. Same numbers on the server and the client.
const PAGE_HEADER_OFFSET_PX = 220;
const DESKTOP_VIEWPORT_HEIGHT_PX = 900;

/**
 * Rows `[start, end)` to mount.
 *
 * `rowHeight` is the locked row height the spacers use, so the window stays
 * aligned with the scroll position. Content-sized rows would drift it.
 *
 * @param {{ count: number, rowHeight: number, overscan: number, tableTop: number, viewportHeight: number }} input
 * @returns {{ start: number, end: number }}
 */
export function trackerWindow({ count, rowHeight, overscan, tableTop, viewportHeight }) {
  if (count <= 0) return { start: 0, end: 0 };
  const startPx = Math.max(0, -tableTop);
  const tableHeight = count * rowHeight;
  const endPx = Math.max(startPx, Math.min(tableHeight, viewportHeight - tableTop));
  const start = Math.max(0, Math.floor(startPx / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil(endPx / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

export function initialTrackerWindow(count) {
  return trackerWindow({
    count,
    rowHeight: TRACKER_ROW_PX,
    overscan: TRACKER_OVERSCAN,
    tableTop: PAGE_HEADER_OFFSET_PX,
    viewportHeight: DESKTOP_VIEWPORT_HEIGHT_PX,
  });
}
