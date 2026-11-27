/**
 * The number beside an insights bar is positive outcomes divided by
 * applications sent, not the bar's row count. A bare "21%" next to 400
 * reads as a share of those 400.
 *
 * @param {unknown} rate
 * @returns {string}
 */
export function sentRateLabel(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return "—";
  return `${Math.round(Number(rate))}% of sent`;
}

/**
 * The long form for the hover title: the visible label stays short so it fits
 * its column, and this names what the share counts.
 *
 * @param {unknown} rate
 * @returns {string | undefined}
 */
export function sentRateTitle(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return undefined;
  return `${Math.round(Number(rate))}% of the applications sent from this group advanced`;
}
