// Age and still-open facts for one "Awaiting your decision" card. Pure: the
// server page reads the files (lib/posting-facts.mjs) and passes the result in.
// No clock and no network here, so the client and server render the same text.

const DAY_MS = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (day) => {
  if (!isoDay.test(String(day ?? ""))) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day ? null : t;
};

/** Whole calendar days from `from` to `today`; null for a bad or future date. */
export function wholeDaysSince(from, today) {
  const a = toUtc(from);
  const b = toUtc(today);
  if (a === null || b === null || a > b) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * @param {{firstSeen?: string, postedAt?: string, check?: {result: string, day: string}|null}|null|undefined} facts
 * @param {string} today YYYY-MM-DD
 * @param {string} [closesAt] scan-history close day, when the board gave one
 * @returns {{foundDays: number|null, postedDays: number|null, open: {state: "open"|"closed"|"unchecked", checkedDays: number|null}}}
 */
export function awaitingAge(facts, today, closesAt = "") {
  const check = facts?.check ?? null;
  let checkedDays = check ? wholeDaysSince(check.day, today) : null;
  const pastClose = isoDay.test(closesAt) && closesAt < today;
  let state = "unchecked";
  if (check?.result === "expired") state = "closed";
  else if (pastClose) {
    // The close date decided it, so an earlier open check's age does not apply.
    state = "closed";
    checkedDays = null;
  } else if (check?.result === "active") state = "open";
  return {
    foundDays: wholeDaysSince(facts?.firstSeen, today),
    postedDays: wholeDaysSince(facts?.postedAt, today),
    open: { state, checkedDays },
  };
}

const ago = (n) => (n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"} ago`);

export function ageLabels(age) {
  const { foundDays, postedDays, open } = age;
  return {
    found: foundDays === null ? "Found: unknown" : `Found ${ago(foundDays)}`,
    posted: postedDays === null ? "Posted: unknown" : `Posted ${ago(postedDays)}`,
    open:
      open.state === "closed" ? (open.checkedDays === null ? "Closed" : `Closed, checked ${ago(open.checkedDays)}`)
      : open.state === "open" ? `Open, checked ${open.checkedDays === null ? "earlier" : ago(open.checkedDays)}`
      : "Not checked",
  };
}
