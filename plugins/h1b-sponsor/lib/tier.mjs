// Pure tier classifier for an employer profile.
// Contract: takes the normalized profile from getEmployerProfile() (or null)
// and returns one of: 'strong' | 'moderate' | 'staffing-shop' | 'weak' | 'none' | 'unknown'.
// Rules applied in order, first match wins. No I/O, no side effects.

export function classifyTier(profile) {
  if (profile == null || typeof profile !== 'object') return 'unknown';

  const staffing = profile.red_flags && profile.red_flags.staffing_shop;
  if (staffing && staffing.value === true) return 'staffing-shop';

  const nPwd = Number(profile.n_pwd ?? 0) || 0;
  const nPerm = Number(profile.n_perm ?? 0) || 0;
  // LCA volume (n_lca) is a separate track from GC filings (n_pwd/n_perm):
  // an employer can be LCA-active with zero GC filings, and cached profiles
  // written before n_lca existed simply contribute 0 here.
  const nLca = Number(profile.n_lca ?? 0) || 0;
  const total = nLca + nPwd + nPerm;

  if (total === 0) return 'none';

  const currentYear = new Date().getUTCFullYear();
  const lastYear = Number(profile.last_year);
  const hasLastYear = Number.isFinite(lastYear);

  const stale = hasLastYear && lastYear < currentYear - 3;
  const lowVolume = total < 5;
  if (stale || lowVolume) return 'weak';

  // Coerce share numerically: a legacy/hand-edited cache entry can carry the
  // share as a string, and typeof-gating would silently read "0.9" as absent.
  const shareNum = staffing ? Number(staffing.share) : NaN;
  const staffingShare = Number.isFinite(shareNum) ? shareNum : null;
  // Bounded above: a last_year further out than next year is API drift, not a
  // recent filing record.
  const recent = hasLastYear && lastYear >= currentYear - 2 && lastYear <= currentYear + 1;

  // Strong: has GC evidence, recent, staffing share < 0.2 (a missing
  // staffing_shop block or non-numeric share counts as 0, matching the
  // moderate branch's treatment).
  if (profile.does_gc === true && recent && (staffingShare ?? 0) < 0.2) {
    return 'strong';
  }

  // Moderate: LCA volume >= 5, recent, staffing_shop.share < 0.5
  // (missing staffing_shop block treated as share 0, matching the strong branch).
  if (total >= 5 && recent && (staffingShare ?? 0) < 0.5) {
    return 'moderate';
  }

  return 'weak';
}
