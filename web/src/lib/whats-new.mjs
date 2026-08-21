/** Cards the home dashboard renders when no explicit limit is asked for. */
export const DEFAULT_OFFER_LIMIT = 24;

/**
 * Ceiling for a caller-requested limit, and what Explore's "See all" hand-off
 * asks for. The payload stays bounded on purpose: explorer-view renders every
 * offer it receives (no virtualisation, no pagination), and a default
 * portals.yml — ~120 companies against a catch-all title_filter — can leave
 * thousands of un-evaluated rows inside a 7-day window. `count` is complete
 * regardless, so the UI shows an honest total without an unbounded render.
 */
export const MAX_OFFER_LIMIT = 200;

/**
 * Resolve the `?limit=` query value into a finite render ceiling. Anything
 * missing, malformed or out of range degrades to a bounded default rather than
 * to an unbounded list.
 *
 * The whole trimmed value has to be an integer — `Number`, not `parseInt`,
 * because parseInt accepts a numeric *prefix*: it would read "24junk" as 24 and
 * "1e9" as 1, letting a malformed limit silently under-fetch instead of falling
 * back. `Number.isInteger` also rejects Infinity, so the unbounded sentinel
 * cannot slip back in through the query string.
 */
export function resolveOfferLimit(raw) {
  if (raw == null) return DEFAULT_OFFER_LIMIT;
  const text = String(raw).trim();
  if (text === "") return DEFAULT_OFFER_LIMIT;
  const requested = Number(text);
  if (!Number.isInteger(requested)) return DEFAULT_OFFER_LIMIT;
  return Math.min(MAX_OFFER_LIMIT, Math.max(1, requested));
}

/**
 * Collect fresh, unique offers while keeping the response payload bounded.
 * `count` always represents the full result set; `offers` is only the slice the
 * caller asked to render. This prevents a UI card limit from masquerading as
 * the number of matches found.
 */
export function collectWhatsNew(rows, { cutoff, toOffer, offerLimit = DEFAULT_OFFER_LIMIT, fallbackLimit = 12 }) {
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
