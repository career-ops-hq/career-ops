/**
 * scan-trust.mjs — Trust Scoring & Location Filtering Helpers for scan.mjs
 */
import { buildTrustValidator } from './providers/_trust-validator.mjs';

export { locationHintFromUrl } from './scan.mjs';

/**
 * Filter and evaluate trust score for scanned jobs.
 *
 * @param {Array} jobs
 * @param {object} trustConfig
 * @returns {Array} Trust-evaluated jobs
 */
export function evaluateJobTrust(jobs, trustConfig = {}) {
  const validator = buildTrustValidator(trustConfig);
  return jobs.map(job => {
    const trustResult = validator.validate(job);
    return {
      ...job,
      trust_score: trustResult.score,
      trust_issues: trustResult.issues || []
    };
  });
}
