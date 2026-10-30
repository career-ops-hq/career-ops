// Pure cumulative-stage contract shared by CLI statistics and web views.
// No filesystem access: the caller chooses the tracker and its sibling ledger.
const RANKS = new Map([
  ['APPLIED', 1], ['RESPONDED', 2], ['REJECTED', 2],
  ['ASSESSMENT', 3], ['INTERVIEW', 4], ['OFFER', 5], ['HIRED', 6],
]);

export function funnelStageRank(status) {
  return RANKS.get(String(status ?? '').trim().toUpperCase()) || 0;
}

/** Parse {num}\t{date}\t{from}\t{to} observations, ignoring torn rows.
 * A `correction` row replaces the latest observation of the same stage, and a
 * `to` of `-` retracts the row's latest observation, as foldObservations() in
 * funnel-velocity.mjs reads them. The next line's `from` restates the retracted
 * stage, so it proves nothing either.
 */
export function parseStatusLogStages(content) {
  const byNum = new Map();
  const retracted = new Map();
  for (const line of String(content ?? '').replace(/\r/g, '').split('\n')) {
    const [rawNum, date, from, to, source] = line.split('\t').map(s => s.trim());
    if (!/^\d+$/.test(rawNum || '') || !date || !from || !to) continue;
    const num = Number(rawNum);
    if (!byNum.has(num)) byNum.set(num, []);
    const observations = byNum.get(num);
    if (to === '-') {
      const dropped = observations.pop();
      if (dropped) retracted.set(num, dropped.to);
      continue;
    }
    const stale = retracted.get(num);
    retracted.delete(num);
    const observation = { num, from: from.toUpperCase() === stale?.toUpperCase() ? '-' : from, to };
    const corrected = source === 'correction' ? observations.map(o => o.to).lastIndexOf(to) : -1;
    if (corrected === -1) observations.push(observation);
    else observations[corrected] = observation;
  }
  return [...byNum.values()].flat();
}

/** Highest observed stage per distinct current tracker identity.
 * Non-numeric identities can retain snapshot counts but never join the ledger.
 * Current SKIP rows remain outside the funnel regardless of their history.
 */
export function recoverFunnelStages(statusByNum, ledger) {
  const reached = new Map();
  const bump = (num, status) => reached.set(num, Math.max(reached.get(num) || 0, funnelStageRank(status)));
  for (const [num, status] of statusByNum) {
    if (String(status ?? '').trim().toUpperCase() !== 'SKIP') bump(num, status);
  }
  for (const { num, from, to } of ledger) {
    if (!reached.has(num)) continue;
    bump(num, from);
    bump(num, to);
  }
  return reached;
}
