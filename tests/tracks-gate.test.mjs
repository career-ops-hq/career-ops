// tests/tracks-gate.test.mjs — lib/tracks.mjs normalizes the profile's tracks block and lib/tracks-gate.mjs is the scanner's opt-in filter (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTracks, loadTracks, remoteHome, TRACK_IDS } from '../lib/tracks.mjs';
import { buildTracksGate, tracksFilterProblems } from '../lib/tracks-gate.mjs';

const PROFILE = {
  location: { country: 'Germany', timezone: 'Europe/Berlin' },
  tracks: {
    europe: { enabled: true, work_authorization: 'eu_citizen', languages: { DE: 'native', en: 'C1' } },
    ai_gigs: { enabled: true, focus: ['llm_engineer'] },
    freelance: { enabled: true, day_rate: { target: 900, minimum: 700, currency: 'eur' }, fx_to_base: { gbp: 1.15, usd: 'x' } },
    remote: { preference: 'remote_first' },
  },
};
const US_ONLY = { title: 'AI Engineer', location: 'Remote (US only)', description: '' };
const EMEA = { title: 'AI Engineer', location: 'Remote - EMEA', description: '' };
const BARE = { title: 'AI Engineer', location: 'Remote', description: '' };

test('a profile without a tracks block has every track off', () => {
  for (const profile of [null, undefined, {}, { tracks: null }, { tracks: [] }, { location: { country: 'Germany' } }]) {
    const t = normalizeTracks(profile);
    assert.deepEqual(t.enabled, { europe: false, ai_gigs: false, freelance: false, remote: false });
    assert.deepEqual(t.warnings, []);
  }
  assert.deepEqual(loadTracks('/no/such/profile.yml').enabled, { europe: false, ai_gigs: false, freelance: false, remote: false });
  assert.deepEqual(TRACK_IDS, ['europe', 'ai_gigs', 'freelance', 'remote']);
});

test('the block is normalized: defaults from location, upper-cased currencies, lower-cased language codes', () => {
  const t = normalizeTracks(PROFILE);
  assert.deepEqual(t.enabled, { europe: true, ai_gigs: true, freelance: true, remote: true });
  assert.equal(t.europe.baseCountry, 'Germany');
  assert.deepEqual(t.europe.languages, { de: 'native', en: 'C1' });
  assert.deepEqual(t.freelance.dayRate, { target: 900, minimum: 700, currency: 'EUR' });
  assert.deepEqual(t.freelance.fx, { GBP: 1.15 });
  assert.equal(t.freelance.checkScheinselbstaendigkeit, true, 'on by default for a base in Germany');
  assert.equal(t.remote.timezone, 'Europe/Berlin');
  assert.equal(t.remote.acceptAnyCountry, true);
  assert.deepEqual(t.aiGigs.focus, ['llm_engineer']);
  assert.equal(remoteHome(t).preference, 'remote_first');
});

test('no rate configured stays null: pay never becomes a floor by default', () => {
  const t = normalizeTracks({ tracks: { freelance: { enabled: true } } });
  assert.deepEqual(t.freelance.dayRate, { target: null, minimum: null, currency: 'EUR' });
  assert.equal(t.freelance.mode, 'alongside');
});

test('bad values fall back and are named in warnings, never thrown', () => {
  const t = normalizeTracks({ tracks: { europ: {}, europe: { enabled: true, base_country: 'Narnia', work_authorization: 'wizard' }, freelance: { mode: 'sometimes' }, remote: { preference: 'couch' }, ai_gigs: { focus: ['llm_engineer', 'astrologer'] } } });
  assert.equal(t.warnings.length, 6);
  assert.equal(t.enabled.remote, false);
  assert.equal(t.freelance.mode, 'alongside');
  assert.deepEqual(t.aiGigs.focus, ['llm_engineer']);
});

test('tracks_filter validation', () => {
  assert.deepEqual(tracksFilterProblems(undefined), []);
  assert.deepEqual(tracksFilterProblems({ remote_fit: 'drop', engagement: 'freelance_only' }), []);
  assert.equal(tracksFilterProblems('drop').length, 1);
  assert.equal(tracksFilterProblems({ remote_fit: 'yes', engagment: 'any' }).length, 2);
});

test('without tracks_filter the gate passes everything, whatever the profile says', () => {
  const tracks = normalizeTracks(PROFILE);
  for (const config of [undefined, null, {}, { remote_fit: 'off', engagement: 'any' }, { remote_fit: 'nonsense' }]) {
    const gate = buildTracksGate(tracks, config);
    for (const job of [US_ONLY, EMEA, BARE, {}, null]) assert.equal(gate(job), null);
  }
});

test('remote_fit: drop removes only a stated mismatch', () => {
  const gate = buildTracksGate(normalizeTracks(PROFILE), { remote_fit: 'drop' });
  assert.equal(gate(US_ONLY), 'remote_fit');
  assert.equal(gate({ title: 'AI Engineer', location: 'Remote', description: 'You must work Pacific Time business hours.' }), 'remote_fit');
  assert.equal(gate(EMEA), null);
  assert.equal(gate(BARE), null, 'a posting that does not say stays in');
  assert.equal(gate({ title: 'AI Engineer' }), null);
});

test('remote_fit: drop keeps far-time-zone roles when the profile is timezone_flexible', () => {
  const pacific = { title: 'AI Engineer', location: 'Remote', description: 'You must work Pacific Time business hours.' };
  const flexible = normalizeTracks({ ...PROFILE, tracks: { ...PROFILE.tracks, remote: { preference: 'remote_first', timezone_flexible: true } } });
  assert.equal(flexible.remote.timezoneFlexible, true);
  assert.equal(normalizeTracks(PROFILE).remote.timezoneFlexible, false);
  const gate = buildTracksGate(flexible, { remote_fit: 'drop' });
  assert.equal(gate(pacific), null);
  assert.equal(gate(US_ONLY), 'remote_fit', 'a residency restriction still drops');
  assert.equal(buildTracksGate(normalizeTracks(PROFILE), { remote_fit: 'drop' })(pacific), 'remote_fit');
});

test('remote_fit: drop does nothing without a remote preference in the profile', () => {
  const gate = buildTracksGate(normalizeTracks({ tracks: { europe: { enabled: true } } }), { remote_fit: 'drop' });
  assert.equal(gate(US_ONLY), null);
});

test('engagement filter', () => {
  const tracks = normalizeTracks(PROFILE);
  const gig = { title: 'LLM Engineer (Freelance)', location: 'Remote', description: 'Projektlaufzeit 6 Monate, Tagessatz verhandelbar.' };
  const job = { title: 'LLM Engineer', location: 'Berlin', description: 'Unbefristete Festanstellung, 30 Tage Urlaub, betriebliche Altersvorsorge.' };
  const silent = { title: 'LLM Engineer', location: 'Berlin', description: '' };
  const freelanceOnly = buildTracksGate(tracks, { engagement: 'freelance_only' });
  assert.deepEqual([freelanceOnly(gig), freelanceOnly(job), freelanceOnly(silent)], [null, 'engagement', null]);
  const employmentOnly = buildTracksGate(tracks, { engagement: 'employment_only' });
  assert.deepEqual([employmentOnly(gig), employmentOnly(job), employmentOnly(silent)], ['engagement', null, null]);
});

test('the gate reads eligibilityText when a provider supplies it', () => {
  const gate = buildTracksGate(normalizeTracks(PROFILE), { remote_fit: 'drop' });
  assert.equal(gate({ title: 'AI Engineer', location: 'Remote', eligibilityText: 'US-based candidates only.' }), 'remote_fit');
});
