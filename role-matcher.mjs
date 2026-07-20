/**
 * role-matcher.mjs - Shared fuzzy role-title matching for tracker scripts.
 *
 * Both `merge-tracker.mjs` and `dedup-tracker.mjs` decide whether two
 * same-company tracker rows describe the same opening. Keeping this logic in
 * one module prevents the merge path from preserving rows that the later dedup
 * path would silently delete with weaker matching rules.
 */

export const SENIORITY_TOKENS = new Set([
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry'
]);

// Tokens that almost every role shares must not count as strong matching
// signal. This set covers seniority, work mode, contract shape, locations, and
// other words that frequently appear in titles without identifying the opening.
export const ROLE_STOPWORDS = new Set([
  // seniority / level
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry', 'level',
  // contract / mode
  'remote', 'hybrid', 'onsite', 'contract', 'contractor', 'freelance',
  'fulltime', 'parttime', 'permanent', 'temporary', 'intern', 'internship',
  // generic job words
  'role', 'position', 'opportunity', 'team', 'based',
  // reposting/tracking annotations — meta noise, never part of the job itself
  'repost', 'reposted', 'relisted',
  // very common locations
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai',
  'london', 'berlin', 'paris', 'madrid', 'barcelona', 'amsterdam', 'dublin',
  'york', 'francisco', 'seattle', 'boston', 'austin', 'chicago', 'toronto',
  'tokyo', 'singapore', 'sydney', 'melbourne', 'lisbon', 'warsaw',
  // regions / countries
  'europe', 'emea', 'apac', 'latam', 'americas', 'india', 'spain', 'germany',
  'france', 'italy', 'canada', 'brazil', 'mexico', 'japan',
  // prepositions leaking through the length filter
  'with', 'from', 'into', 'over', 'this', 'that',
]);

// Short specialty acronyms that are discriminating despite their length.
// Broad two-letter buckets such as AI/ML are intentionally excluded because
// they appear across many unrelated roles.
export const SHORT_SPECIALTY = new Set([
  'api', 'sre', 'sdk', 'cli', 'gpu', 'cpu',
  'ios', 'qa', 'ux', 'ui', 'ar', 'vr',
  'ocr', 'crm', 'erp',
]);

// Generic role-level descriptors. Two titles whose only overlap is in this set
// are not the same opening; they are merely written at the same role altitude.
export const BASELINE_TOKENS = new Set([
  'software', 'engineer', 'developer', 'manager', 'architect',
  'analyst', 'designer', 'consultant', 'specialist',
  'platform', 'systems', 'services',
  'backend', 'frontend', 'full', 'stack', 'fullstack',
]);

/**
 * Convert a role title into content tokens used for fuzzy matching.
 *
 * The tokenizer keeps long descriptive words and a narrow set of short
 * specialty acronyms, while dropping common stopwords. Baseline tokens are kept
 * in the result so they can contribute to the similarity ratio, but they cannot
 * be the only reason two titles match.
 *
 * @param {string} role - Raw role title from the tracker or TSV addition.
 * @returns {string[]} Ordered role-title tokens.
 */
export function roleTokens(role) {
  const text = typeof role === 'string' ? role : String(role ?? '');
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => (w.length > 3 || SHORT_SPECIALTY.has(w)) && !ROLE_STOPWORDS.has(w));
}

function extractSeniorities(title) {
  const text = typeof title === 'string' ? title : String(title ?? '');
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => SENIORITY_TOKENS.has(w))
  );
}

/**
 * Decide whether two role titles are likely the same opening.
 *
 * Matching requires at least two shared tokens, at least one shared token that
 * is not merely baseline job vocabulary, and a Jaccard overlap of 0.6 or more.
 * This preserves genuine reposts while keeping sibling roles such as
 * "Full Stack Engineer, Foundation" and "Full Stack Engineer, Guarded Releases"
 * as separate applications.
 *
 * @param {string} a - First role title.
 * @param {string} b - Second role title.
 * @returns {boolean} True when the titles are similar enough to deduplicate.
 */
export function roleFuzzyMatch(a, b) {
  const senA = extractSeniorities(a);
  const senB = extractSeniorities(b);

  // If both titles explicitly specify seniority, they MUST overlap in at least one seniority token.
  // e.g. "Senior" vs "Principal" -> differ, return false.
  // e.g. "Senior" vs "Senior Staff" -> overlap, proceed to Jaccard check.
  // e.g. "Engineer" vs "Senior Engineer" -> one lacks seniority, proceed to Jaccard check.
  if (senA.size > 0 && senB.size > 0) {
    const hasOverlap = [...senA].some(s => senB.has(s));
    if (!hasOverlap) return false;
  }

  const wordsA = [...new Set(roleTokens(a))];
  const wordsB = [...new Set(roleTokens(b))];
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const setB = new Set(wordsB);
  const overlap = wordsA.filter(w => setB.has(w));
  if (overlap.length < 2) return false;

  // Require at least one non-baseline token in the overlap. Roles that share
  // only generic descriptors like [software, engineer] or [full, stack,
  // engineer] are not the same opening.
  const discriminating = overlap.filter(w => !BASELINE_TOKENS.has(w));
  if (discriminating.length === 0) return false;

  // A generic base title carries no suffix of its own to counterbalance a
  // specialized sibling's extra word, so the shared tokens alone can cross the
  // Jaccard threshold even though that extra word is exactly the signal that
  // these are two different, separately-postable openings (e.g. "Senior
  // Analytics Engineer" vs "Senior Analytics Engineer, People Analytics").
  // When one title's token set is a strict subset of the other's, and the
  // superset's extra tokens contain a non-baseline word, treat that word as a
  // specialization marker and keep the titles distinct.
  const smaller = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const larger = wordsA.length <= wordsB.length ? wordsB : wordsA;
  const isProperSubset = larger.length > smaller.length && overlap.length === smaller.length;
  if (isProperSubset) {
    const smallerSet = new Set(smaller);
    const extraTokens = larger.filter(w => !smallerSet.has(w));
    if (extraTokens.some(w => !BASELINE_TOKENS.has(w))) return false;
  }

  // Use a true set-based Jaccard ratio. Dividing by the smaller title inflates
  // matches for roles that share a long generic prefix but differ in specialty.
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap.length / union >= 0.6;
}
