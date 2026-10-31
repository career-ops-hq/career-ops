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
