// tests/tracks-remote-fit.test.mjs — lib/remote-fit.mjs decides whether a posting's remote scope, time zone and arrangement fit where the candidate lives (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-remote-fit.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRemoteFit, findRegions, utcOffsetHours, REMOTE_PREFERENCES } from '../lib/remote-fit.mjs';

const HOME = { preference: 'remote_first', country: 'Germany', timezone: 'Europe/Berlin', acceptAnyCountry: true };
const verdict = (posting, home = HOME) => classifyRemoteFit(posting, home).verdict;

test('remote scoped to another region is a mismatch for a Europe-based candidate', () => {
  for (const posting of [
    { title: 'Senior AI Engineer', location: 'Remote (US only)' },
    { title: 'AI Engineer (Remote, US)', location: '' },
    { title: 'AI Engineer', location: 'Remote - UK' },
    { title: 'AI Engineer', location: 'United States', description: 'Fully remote role.' },
    { title: 'AI Engineer', location: 'Remote', description: 'US-based candidates only.' },
    { title: 'ML Engineer', location: 'Remote', description: 'You must be based in the United States. We love hybrid search.' },
    { title: 'AI Engineer', location: 'Remote', description: 'Authorized to work in the US without sponsorship is required.' },
  ]) assert.equal(verdict(posting), 'mismatch', JSON.stringify(posting));
});

test('a scope that covers Europe or the whole world is a match', () => {
  for (const posting of [
    { title: 'LLM Engineer', location: 'Remote - EMEA' },
    { title: 'LLM Engineer', location: 'Remote, Worldwide' },
    { title: 'AI Engineer', location: 'Anywhere' },
    { title: 'LLM Engineer', location: 'Remote', description: 'This role is remote within the EU.' },
    { title: 'KI-Entwickler (m/w/d)', location: 'Deutschland', description: '100% Homeoffice möglich, deutschlandweit.' },
  ]) assert.equal(verdict(posting), 'match', JSON.stringify(posting));
});

test('a bare "Remote" is unknown, never read as worldwide or as US-only', () => {
  assert.equal(verdict({ title: 'LLM Engineer', location: 'Remote' }), 'unknown');
  assert.equal(verdict({ title: 'ML Engineer', location: 'Remote', description: 'Our HQ is in San Francisco and we have offices in the US and Europe.' }), 'unknown');
});

test('the home country excluded by name is a mismatch even inside a matching region', () => {
  assert.equal(verdict({ title: 'AI Engineer', location: 'Remote', description: 'We cannot hire in Germany at this time. Remote in Europe.' }), 'mismatch');
});

test('required working hours are compared with the home time zone', () => {
  assert.equal(verdict({ title: 'ML Engineer', location: 'Remote', description: 'Fully remote. You will work Pacific Time business hours.' }), 'mismatch');
  assert.equal(verdict({ title: 'ML Engineer', location: 'Remote', description: 'Fully remote. We need at least 4 hours overlap with EST.' }), 'partial');
  assert.equal(verdict({ title: 'ML Engineer', location: 'Remote', description: 'Work remotely. Core hours are 10am-4pm CET.' }), 'match');
  assert.equal(verdict({ title: 'ML Engineer', location: 'Remote', description: 'Remote role open to candidates between UTC-5 and UTC+2.' }), 'match');
});

test('hybrid and on-site read through the preference', () => {
  const hybrid = { title: 'KI-Entwickler (m/w/d)', location: 'München', description: 'Hybrides Arbeiten: 2 Tage pro Woche im Büro.' };
  const onsite = { title: 'AI Engineer', location: 'New York, NY', description: 'This role is on-site 5 days a week.' };
  assert.equal(verdict(hybrid), 'partial');
  assert.equal(verdict(hybrid, { ...HOME, preference: 'remote_only' }), 'mismatch');
  assert.equal(verdict(onsite), 'mismatch');
  assert.equal(verdict({ title: 'AI Engineer', location: 'London, UK (Hybrid)' }), 'partial');
});

test('the result carries the evidence it decided on', () => {
  const r = classifyRemoteFit({ title: 'Engineer', location: 'Remote (US only)', description: 'Must work Pacific hours.' }, HOME);
  assert.deepEqual(r.scope.regions, ['us']);
  assert.ok(r.scope.evidence.includes('Remote (US only)'));
  assert.equal(r.timezone.verdict, 'mismatch');
  assert.equal(r.reasons.length, 2);
});

test('missing or malformed input never throws', () => {
  assert.equal(verdict({}), 'unknown');
  assert.equal(classifyRemoteFit(null, HOME).verdict, 'unknown');
});

test('German remote vocabulary and stated shares', () => {
  assert.equal(verdict({ title: 'KI-Entwickler', location: 'Deutschlandweit (Homeoffice)' }), 'match');
  assert.equal(verdict({ title: 'IT Consultant', location: 'Frankfurt am Main, Germany · Remote (100%)' }), 'match');
  assert.equal(verdict({ title: 'Fullstack Entwickler', location: 'Frankfurt am Main, Germany · Remote 60%' }), 'partial', 'a share under 100% is hybrid');
  assert.equal(verdict({ title: 'KI-Entwickler', location: 'Hamburg', description: '3 Präsenztage pro Woche im Büro.' }), 'partial');
  assert.equal(verdict({ title: 'KI-Entwickler', location: 'Hamburg', description: 'Präsenzpflicht, kein Homeoffice.' }), 'mismatch');
  assert.equal(verdict({ title: 'KI-Entwickler', location: 'Berlin', description: 'Homeoffice möglich.' }), 'unknown', '"possible" is not a commitment');
  assert.equal(classifyRemoteFit({ title: 'KI-Entwickler', location: 'Berlin', description: 'Mobiles Arbeiten, ortsunabhängig.' }, HOME).arrangement, 'remote');
});

test('a place with no word on remote work is unknown, not a mismatch', () => {
  assert.equal(verdict({ title: 'AI Engineer', location: 'New York, United States' }), 'unknown');
  assert.equal(verdict({ title: 'AI Engineer', location: 'India' }), 'unknown');
});

test('a location line in the body and an overlap rule with an abbreviated zone', () => {
  const r = classifyRemoteFit({ title: 'AI Engineer', location: 'United States, Canada, Europe, Poland', description: '● Location: Remote\nMust overlap at least 5 hours with U.S. Pacific time.' }, HOME);
  assert.deepEqual([r.arrangement, r.timezone.requiredOverlapHours, r.verdict], ['remote', 5, 'mismatch']);
});

test('timezone_flexible: required far hours are information, residency limits still block', () => {
  const flexible = { ...HOME, timezoneFlexible: true };
  const pacific = { title: 'AI Engineer', location: 'Remote (Europe)', description: 'Must overlap at least 5 hours with U.S. Pacific time.' };
  assert.equal(verdict(pacific), 'mismatch', 'the default is unchanged');
  const r = classifyRemoteFit(pacific, flexible);
  assert.equal(r.verdict, 'match');
  assert.deepEqual([r.timezone.verdict, r.timezone.flexible, r.timezone.requiredOverlapHours], ['mismatch', true, 5], 'the hours are still reported');
  assert.ok(r.reasons.some(x => /information only/.test(x)));
  const eastern = { title: 'ML Engineer', location: 'Remote', description: 'Fully remote. We need at least 4 hours overlap with EST.' };
  assert.equal(verdict(eastern), 'partial');
  assert.notEqual(verdict(eastern, flexible), 'partial');
  for (const posting of [
    { title: 'AI Engineer', location: 'Remote (US only)' },
    { title: 'AI Engineer', location: 'Remote', description: 'US-based candidates only. Pacific hours.' },
    { title: 'AI Engineer', location: 'Remote', description: 'Authorized to work in the US without sponsorship is required.' },
  ]) assert.equal(verdict(posting, flexible), 'mismatch', JSON.stringify(posting));
});

test('helpers', () => {
  assert.equal(utcOffsetHours('Europe/Berlin') >= 1, true);
  assert.equal(utcOffsetHours('Not/AZone'), null);
  assert.ok(findRegions('Remote in EMEA or DACH').some(h => h.id === 'emea'));
  assert.deepEqual(REMOTE_PREFERENCES, ['remote_only', 'remote_first', 'hybrid_ok', 'any']);
});
