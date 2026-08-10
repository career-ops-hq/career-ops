/**
 * Collect fresh, unique offers while keeping the response payload bounded.
 * `count` always represents the full result set; `offers` is only the slice the
 * caller asked to render. This prevents a UI card limit from masquerading as
 * the number of matches found.
 */
export function collectWhatsNew(rows, { cutoff, toOffer, offerLimit = 24, fallbackLimit = 12 }) {
  const seen = new Set();
  const offers = [];
  let count = 0;
  let anyDated = false;

  const add = (columns, limit) => {
    const offer = toOffer(columns);
    if (!offer || seen.has(offer.url)) return;
    seen.add(offer.url);
    count += 1;
    if (offers.length < limit) offers.push(offer);
  };

  // Recent-by-date supply loop. Walk every row so `count` is not capped by the
  // number of cards returned to the client.
  for (let i = rows.length - 1; i >= 1; i--) {
    const columns = rows[i].split("\t");
    const timestamp = Date.parse(columns[1] || "");
    if (Number.isFinite(timestamp)) anyDated = true;
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    add(columns, offerLimit);
  }

  // Legacy histories may have no parseable first_seen values. Preserve the
  // append-order fallback while still returning its full unique count.
  if (count === 0 && !anyDated) {
    for (let i = rows.length - 1; i >= 1; i--) {
      add(rows[i].split("\t"), fallbackLimit);
    }
  }

  return { offers, count };
}
