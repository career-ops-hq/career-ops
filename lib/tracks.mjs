/**
 * lib/tracks.mjs — the search tracks a user turned on (job-engine).
 *
 * Four optional tracks sit on top of the normal career-ops flow and are all
 * read from one block, "tracks:", in config/profile.yml:
 *
 *   europe     work authorization, languages, contract types, EUR/GBP/CHF pay
 *   ai_gigs    a role focus on AI work, with its own archetypes
 *   freelance  contract work priced by the hour or day, next to employment
 *   remote     a preference (remote_only, remote_first, hybrid_ok) that the
 *              scanner can filter on and the evaluation scores
 *
 * A profile without the block has no tracks, and every reader below then
 * reports "off": nothing in the scan or the evaluation changes.
 */

import { existsSync, readFileSync } from 'fs';
import { loadYaml } from './yaml-document.mjs';
import { europeCountry } from './europe.mjs';
import { REMOTE_PREFERENCES, utcOffsetHours } from './remote-fit.mjs';

export const TRACK_IDS = ['europe', 'ai_gigs', 'freelance', 'remote'];
export const WORK_AUTHORIZATIONS = ['eu_citizen', 'uk_citizen', 'blue_card', 'residence_permit', 'needs_sponsorship'];
export const FREELANCE_MODES = ['alongside', 'only'];
const AI_FOCUS = ['llm_engineer', 'agent_engineer', 'applied_ai', 'ml_engineer', 'llmops', 'evals', 'ai_automation', 'ai_consulting', 'ai_product'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = v => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []);
const numberOrNull = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Normalize the tracks block of a parsed profile. Never throws: a bad value
 * falls back to its default and is named in warnings.
 *
 * @param {any} profile  parsed config/profile.yml
 */
export function normalizeTracks(profile) {
  const raw = isObject(profile?.tracks) ? profile.tracks : {};
  const warnings = [];
  const location = isObject(profile?.location) ? profile.location : {};
  const warn = (field, message) => warnings.push('tracks.' + field + ': ' + message);
  for (const key of Object.keys(raw)) if (!TRACK_IDS.includes(key)) warn(key, 'unknown track (known: ' + TRACK_IDS.join(', ') + ')');

  const eu = isObject(raw.europe) ? raw.europe : {};
  const baseCountry = typeof eu.base_country === 'string' && eu.base_country.trim() ? eu.base_country.trim() : (typeof location.country === 'string' ? location.country.trim() : '');
  if (eu.enabled === true && baseCountry && !europeCountry(baseCountry)) warn('europe.base_country', '"' + baseCountry + '" is not a country lib/europe.mjs knows; region checks fall back to "Europe"');
  let workAuthorization = eu.work_authorization;
  if (workAuthorization !== undefined && !WORK_AUTHORIZATIONS.includes(workAuthorization)) {
    warn('europe.work_authorization', 'must be one of ' + WORK_AUTHORIZATIONS.join(', '));
    workAuthorization = undefined;
  }
  const languages = {};
  if (isObject(eu.languages)) for (const [code, level] of Object.entries(eu.languages)) languages[String(code).toLowerCase()] = String(level);

  const fr = isObject(raw.freelance) ? raw.freelance : {};
  const dayRate = isObject(fr.day_rate) ? fr.day_rate : {};
  let mode = fr.mode ?? 'alongside';
  if (!FREELANCE_MODES.includes(mode)) { warn('freelance.mode', 'must be alongside or only'); mode = 'alongside'; }
  const fx = {};
  if (isObject(fr.fx_to_base)) for (const [cur, rate] of Object.entries(fr.fx_to_base)) if (numberOrNull(rate)) fx[String(cur).toUpperCase()] = rate;

  const rm = isObject(raw.remote) ? raw.remote : {};
  let preference = rm.preference;
  if (preference !== undefined && !REMOTE_PREFERENCES.includes(preference)) {
    warn('remote.preference', 'must be one of ' + REMOTE_PREFERENCES.join(', '));
    preference = undefined;
  }
  const timezone = rm.timezone ?? location.timezone ?? null;
  if (preference && timezone !== null && utcOffsetHours(timezone) === null) warn('remote.timezone', '"' + timezone + '" is not an IANA zone, an abbreviation or a UTC offset; time-zone checks are off');
  const targetCountries = strings(eu.target_countries);

  const ai = isObject(raw.ai_gigs) ? raw.ai_gigs : {};
  const focus = strings(ai.focus).filter(f => {
    if (AI_FOCUS.includes(f)) return true;
    warn('ai_gigs.focus', 'unknown archetype "' + f + '" (known: ' + AI_FOCUS.join(', ') + ')');
    return false;
  });

  return {
    enabled: {
      europe: eu.enabled === true,
      ai_gigs: ai.enabled === true,
      freelance: fr.enabled === true,
      remote: Boolean(preference),
    },
    europe: {
      baseCountry,
      // Never assumed: an unset status leaves the authorization check at "unknown".
      workAuthorization: workAuthorization || (location.needs_sponsorship === true ? 'needs_sponsorship' : null),
      targetCountries,
      languages,
      contractTypes: strings(eu.contract_types),
    },
    aiGigs: { focus: focus.length ? focus : AI_FOCUS, includeCrowdWork: ai.include_crowd_work === true },
    freelance: {
      mode,
      dayRate: { target: numberOrNull(dayRate.target), minimum: numberOrNull(dayRate.minimum), currency: typeof dayRate.currency === 'string' ? dayRate.currency.toUpperCase() : 'EUR' },
      hoursPerDay: numberOrNull(fr.hours_per_day) || 8,
      billableDaysPerYear: numberOrNull(fr.billable_days_per_year) || 200,
      minContractMonths: numberOrNull(fr.min_contract_months),
      maxPaymentTermsDays: numberOrNull(fr.max_payment_terms_days),
      acceptAgencies: fr.accept_agencies !== false,
      fx,
      checkScheinselbstaendigkeit: fr.check_scheinselbstaendigkeit === undefined
        ? (europeCountry(baseCountry)?.iso === 'DE')
        : fr.check_scheinselbstaendigkeit === true,
    },
    remote: {
      preference: preference || null,
      country: baseCountry,
      region: 'europe',
      acceptCountries: targetCountries,
      acceptAnyCountry: targetCountries.length === 0,
      hybridCities: strings(rm.hybrid_cities),
      maxOnsiteDaysPerMonth: numberOrNull(rm.max_onsite_days_per_month) ?? undefined,
      timezone,
      timezoneFlexible: rm.timezone_flexible === true,
    },
    warnings,
  };
}

/** Read and normalize the tracks of the profile at profilePath. A missing or unreadable profile has no tracks. */
export function loadTracks(profilePath) {
  if (!profilePath || !existsSync(profilePath)) return normalizeTracks(null);
  try {
    return normalizeTracks(loadYaml(readFileSync(profilePath, 'utf-8')));
  } catch (err) {
    const tracks = normalizeTracks(null);
    tracks.warnings.push('could not read ' + profilePath + ': ' + String(err?.message ?? err).split('\n')[0]);
    return tracks;
  }
}

/** The second argument classifyRemoteFit takes, built from normalized tracks. */
export function remoteHome(tracks) {
  return { ...tracks.remote, preference: tracks.remote.preference || 'any' };
}
