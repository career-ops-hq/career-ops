/**
 * lib/tracks-gate.mjs — the scanner's side of the search tracks (job-engine).
 *
 * Opt-in through "tracks_filter" in portals.yml; without that block the gate
 * passes everything and the scan is unchanged:
 *
 *   tracks_filter:
 *     remote_fit: drop          # drop | off
 *     engagement: any           # any | freelance_only | employment_only
 *
 * remote_fit: drop removes a posting only on a stated mismatch: remote
 * scoped to another region, a required far time zone, on-site or hybrid
 * against a remote preference. A posting that does not say stays in, as every
 * other scan filter does with missing data.
 *
 * The readers need text. A provider that returns no description still gives
 * the title and location, which is where "Remote (US only)" usually lives.
 */

import { classifyRemoteFit } from './remote-fit.mjs';
import { detectEngagement } from './gig-terms.mjs';
import { remoteHome } from './tracks.mjs';

export const TRACK_GATE_REASONS = ['remote_fit', 'engagement'];
const REMOTE_FIT_MODES = ['drop', 'off'];
const ENGAGEMENT_MODES = ['any', 'freelance_only', 'employment_only'];

/** Problems in a tracks_filter block, as strings; empty when it is valid or absent. */
export function tracksFilterProblems(config) {
  if (config === undefined || config === null) return [];
  if (typeof config !== 'object' || Array.isArray(config)) return ['tracks_filter must be a mapping'];
  const problems = [];
  if (config.remote_fit !== undefined && !REMOTE_FIT_MODES.includes(config.remote_fit)) problems.push('tracks_filter.remote_fit must be drop or off');
  if (config.engagement !== undefined && !ENGAGEMENT_MODES.includes(config.engagement)) problems.push('tracks_filter.engagement must be any, freelance_only or employment_only');
  for (const key of Object.keys(config)) if (!['remote_fit', 'engagement'].includes(key)) problems.push('tracks_filter.' + key + ' is not a known key');
  return problems;
}

/**
 * @param {ReturnType<import('./tracks.mjs').normalizeTracks>} tracks
 * @param {any} config  portals.yml tracks_filter
 * @returns {(job: { title?: string, location?: string, description?: string, eligibilityText?: string }) => null | 'remote_fit' | 'engagement'}
 */
export function buildTracksGate(tracks, config) {
  if (!config || typeof config !== 'object' || tracksFilterProblems(config).length) return () => null;
  const remoteOn = config.remote_fit === 'drop' && Boolean(tracks?.remote?.preference);
  const engagement = config.engagement && config.engagement !== 'any' ? config.engagement : null;
  if (!remoteOn && !engagement) return () => null;
  const home = remoteOn ? remoteHome(tracks) : null;
  return job => {
    const description = [job?.description, job?.eligibilityText].filter(t => typeof t === 'string' && t.trim()).join('\n');
    if (remoteOn && classifyRemoteFit({ title: job?.title, location: job?.location, description }, home).verdict === 'mismatch') return 'remote_fit';
    if (engagement) {
      const { type } = detectEngagement(description, { title: job?.title || '' });
      const employed = type === 'employment' || type === 'fixed_term' || type === 'temp_agency' || type === 'eor';
      if (engagement === 'freelance_only' && employed) return 'engagement';
      if (engagement === 'employment_only' && type === 'freelance') return 'engagement';
    }
    return null;
  };
}
