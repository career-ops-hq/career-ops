#!/usr/bin/env node
/**
 * track-signals.mjs — read one posting against the search tracks in
 * config/profile.yml (job-engine: europe, ai_gigs, freelance, remote).
 *
 * Zero-LLM and offline. The evaluation modes run it before Block A and quote
 * its evidence; it never scores, writes or decides on its own. Tracks that
 * are off are left out of the output.
 *
 *   node track-signals.mjs jds/acme.md --title "AI Engineer" --location "Remote (EMEA)"
 *   node track-signals.mjs - --summary < posting.txt
 *   node track-signals.mjs --self-test
 */

import { readFileSync } from 'fs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getProfilePath } from './path-resolver.mjs';
import { loadTracks, normalizeTracks, remoteHome } from './lib/tracks.mjs';
import { classifyRemoteFit, findRegions } from './lib/remote-fit.mjs';
import { europeCountry } from './lib/europe.mjs';
import { assessWorkAuthorization, compareLanguages, detectPostingLanguage, readLanguageRequirements, readWorkAuthorization } from './lib/eu-signals.mjs';
import { classifyAiRole } from './lib/ai-archetypes.mjs';
import {
  assessScheinselbstaendigkeit, compareRate, detectEngagement, detectIntermediary, parseContractTerms,
  parsePaymentTerms, parseRates, pickGigRate, pickSalary, salaryEquivalentDayRate, toDayRate,
} from './lib/gig-terms.mjs';

const KNOWN_FLAGS = ['--title', '--location', '--company', '--profile', '--summary', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--title', '--location', '--company', '--profile'];
const USAGE = [
  'Usage:',
  '  node track-signals.mjs <posting-file | -> [--title T] [--location L] [--company C] [--summary]',
  '  node track-signals.mjs --self-test',
  '',
  'Reads the posting text from a file (or stdin with -) and prints what the enabled',
  'search tracks in config/profile.yml make of it, as JSON or with --summary as text.',
  '--profile <path> reads another profile.',
].join('\n');

/**
 * @param {{ title?: string, location?: string, company?: string, description: string }} posting
 * @param {ReturnType<typeof normalizeTracks>} tracks
 */
export function trackSignals(posting, tracks) {
  const title = posting.title || '';
  const location = posting.location || '';
  const description = posting.description || '';
  const flags = [];
  const flag = (level, track, message) => flags.push({ level, track, message });
  const out = { tracks: tracks.enabled, posting: { language: detectPostingLanguage(description) }, flags };
  const engagement = detectEngagement(description, { title });
  out.engagement = engagement;
  const rates = parseRates(title + '\n' + description);

  if (tracks.enabled.remote) {
    const remote = classifyRemoteFit({ title, location, description }, remoteHome(tracks));
    out.remote = remote;
    const level = remote.verdict === 'mismatch' ? 'blocker' : remote.verdict === 'partial' ? 'caution' : 'info';
    for (const reason of remote.reasons) flag(level, 'remote', reason);
  }

  if (tracks.enabled.europe) {
    const placeIds = [...new Set(findRegions(location + ' ' + title, { isoCodes: true }).map(h => h.id))];
    const authSignal = readWorkAuthorization(description);
    const authorization = assessWorkAuthorization(authSignal, {
      status: tracks.europe.workAuthorization, baseCountry: tracks.europe.baseCountry, jobCountries: placeIds,
    });
    const requirements = readLanguageRequirements(description);
    const languages = Object.keys(tracks.europe.languages).length ? compareLanguages(requirements, tracks.europe.languages) : { verdict: 'not_configured', gaps: [], stretches: [] };
    const country = placeIds.map(id => europeCountry(id)).find(Boolean) || null;
    const salary = pickSalary(rates);
    out.europe = {
      jobCountry: country ? country.name : null,
      workAuthorization: { ...authorization, sponsorship: authSignal.sponsorship, evidence: authSignal.evidence.slice(0, 3) },
      languages: { ...languages, requirements },
      contract: engagement.type,
      salary,
      payConvention: country ? { currency: country.currency, payPeriods: country.payPeriods, note: country.payNote, minLeaveDays: country.minLeaveDays } : null,
    };
    if (authorization.verdict === 'blocked') flag('blocker', 'europe', authorization.reason);
    else if (authorization.verdict === 'needs_permit' || authorization.verdict === 'check') flag('caution', 'europe', authorization.reason);
    for (const gap of languages.gaps) flag('blocker', 'europe', 'Requires ' + gap.language.toUpperCase() + ' at ' + gap.level + (gap.implied ? ' (implied: the posting is written in it)' : '') + ', which your profile does not list at that level.');
    for (const s of languages.stretches) flag('caution', 'europe', 'Asks for ' + s.language.toUpperCase() + ' at ' + s.level + ', one level above what your profile lists.');
    if (languages.verdict === 'not_configured' && requirements.some(r => r.required)) flag('info', 'europe', 'The posting asks for ' + requirements.filter(r => r.required).map(r => r.language.toUpperCase() + ' ' + r.level).join(', ') + '; tracks.europe.languages is empty, so I cannot compare.');
    if (tracks.europe.contractTypes.length && engagement.type !== 'unknown' && !tracks.europe.contractTypes.includes(engagement.type)) flag('caution', 'europe', 'Contract type is ' + engagement.type.replace('_', ' ') + ', which is not in tracks.europe.contract_types.');
    if (salary && country && salary.currency && salary.currency !== country.currency) flag('info', 'europe', 'Pay is quoted in ' + salary.currency + ' for a role in ' + country.name + ' (' + country.currency + '); check who the employing entity is.');
  }

  if (tracks.enabled.ai_gigs) {
    const ai = classifyAiRole({ title, description });
    out.ai = { ...ai, inFocus: ai.archetypes.filter(a => tracks.aiGigs.focus.includes(a.id)).map(a => a.id) };
    if (!ai.isAiRole) flag('info', 'ai_gigs', 'Not recognisably an AI role: no AI archetype matches the title or the description.');
    else if (!out.ai.inFocus.length && ai.crowdWork === 'no') flag('info', 'ai_gigs', 'An AI role, but outside the archetypes in tracks.ai_gigs.focus (closest: ' + (ai.primary || 'none') + ').');
    if (ai.crowdWork === 'crowd' && !tracks.aiGigs.includeCrowdWork) flag('caution', 'ai_gigs', 'Reads as per-task model-training or data-labelling work, not an engineering or consulting engagement.');
  }

  if (tracks.enabled.freelance) {
    const isGig = engagement.type === 'freelance';
    const rate = pickGigRate(rates);
    const terms = parseContractTerms(description);
    const fr = tracks.freelance;
    const opts = { hoursPerDay: fr.hoursPerDay, billableDaysPerYear: fr.billableDaysPerYear, fx: fr.fx };
    const salary = pickSalary(rates);
    out.freelance = {
      isGig,
      rate,
      rateVerdict: compareRate(rate, fr.dayRate, opts),
      terms,
      intermediary: detectIntermediary(description, posting.company || ''),
      payment: parsePaymentTerms(description),
      scheinselbstaendigkeit: isGig && fr.checkScheinselbstaendigkeit
        ? assessScheinselbstaendigkeit(description, { months: terms.months ? terms.months.max : null, utilisationPercent: terms.utilisation ? terms.utilisation.percent : null })
        : null,
      salaryAsDayRate: !isGig && salary ? { perWorkingDay: toDayRate(salary, { billableDaysPerYear: 220 }), freelanceEquivalent: salary.unit === 'year' ? salaryEquivalentDayRate(salary.max, { billableDaysPerYear: fr.billableDaysPerYear }) : null, currency: salary.currency } : null,
    };
    if (fr.mode === 'only' && !isGig && engagement.type !== 'unknown') flag('blocker', 'freelance', 'This is ' + engagement.type.replace('_', ' ') + ', and tracks.freelance.mode is "only".');
    if (isGig) {
      const f = out.freelance;
      if (!rate) flag('info', 'freelance', 'No rate stated. Ask for the budget before investing in a proposal.');
      else if (f.rateVerdict.verdict === 'below_minimum') flag('caution', 'freelance', f.rateVerdict.reason);
      else if (f.rateVerdict.verdict !== 'unknown') flag('info', 'freelance', f.rateVerdict.reason);
      if (terms.months && fr.minContractMonths && terms.months.max < fr.minContractMonths) flag('caution', 'freelance', 'Runs ' + terms.months.max + ' months at most, below your minimum of ' + fr.minContractMonths + '.');
      if (!terms.months) flag('info', 'freelance', 'No contract length stated.');
      if (f.payment.days && fr.maxPaymentTermsDays && f.payment.days > fr.maxPaymentTermsDays) flag('caution', 'freelance', 'Payment terms of ' + f.payment.days + ' days exceed your limit of ' + fr.maxPaymentTermsDays + '.');
      if (f.intermediary.via === 'agency') flag(fr.acceptAgencies ? 'info' : 'caution', 'freelance', 'Sold through an intermediary (' + f.intermediary.evidence.join('; ') + '): the end client, the margin and the contract chain are open questions.');
      if (f.scheinselbstaendigkeit && f.scheinselbstaendigkeit.risk === 'high') flag('caution', 'freelance', 'High Scheinselbstaendigkeit risk on the wording: ' + f.scheinselbstaendigkeit.indicators.map(i => i.label.toLowerCase()).join('; ') + '.');
      else if (f.scheinselbstaendigkeit && f.scheinselbstaendigkeit.risk === 'elevated') flag('info', 'freelance', 'Scheinselbstaendigkeit indicators to clarify: ' + f.scheinselbstaendigkeit.indicators.map(i => i.label.toLowerCase()).join('; ') + '.');
    }
  }
  return out;
}

function summarize(result) {
  const lines = [];
  const on = Object.entries(result.tracks).filter(([, v]) => v).map(([k]) => k);
  lines.push('Tracks on: ' + (on.length ? on.join(', ') : 'none (add a "tracks:" block to config/profile.yml)'));
  lines.push('Posting language: ' + result.posting.language + ' | engagement: ' + result.engagement.type);
  if (result.remote) lines.push('Remote fit: ' + result.remote.verdict + ' (' + result.remote.arrangement + ')');
  if (result.europe) lines.push('Work authorization: ' + result.europe.workAuthorization.verdict + ' | languages: ' + result.europe.languages.verdict);
  if (result.ai) lines.push('AI archetype: ' + (result.ai.primary || 'none') + (result.ai.crowdWork !== 'no' ? ' (' + result.ai.crowdWork + ' work)' : ''));
  if (result.freelance && result.freelance.isGig) {
    const f = result.freelance;
    lines.push('Gig: rate ' + (f.rate ? f.rate.raw : 'not stated') + ' -> ' + f.rateVerdict.verdict
      + ' | length ' + (f.terms.months ? f.terms.months.min + '-' + f.terms.months.max + ' months' : 'not stated')
      + ' | via ' + f.intermediary.via + (f.scheinselbstaendigkeit ? ' | Scheinselbstaendigkeit risk ' + f.scheinselbstaendigkeit.risk : ''));
  }
  for (const level of ['blocker', 'caution', 'info']) {
    for (const f of result.flags.filter(x => x.level === level)) lines.push('[' + level + '] ' + f.track + ': ' + f.message);
  }
  return lines.join('\n');
}

function selfTest() {
  const tracks = normalizeTracks({
    location: { country: 'Germany', timezone: 'Europe/Berlin' },
    tracks: {
      europe: { enabled: true, work_authorization: 'eu_citizen', languages: { de: 'native', en: 'C1' } },
      ai_gigs: { enabled: true },
      freelance: { enabled: true, day_rate: { target: 800, minimum: 650, currency: 'EUR' } },
      remote: { preference: 'remote_first' },
    },
  });
  const checks = [];
  const check = (ok, name) => checks.push([Boolean(ok), name]);
  const us = trackSignals({ title: 'LLM Engineer', location: 'Remote (US only)', description: 'You must be authorized to work in the US. We do not sponsor visas.' }, tracks);
  check(us.remote.verdict === 'mismatch', 'Remote (US only) is a mismatch for a Germany-based profile');
  check(us.flags.some(f => f.level === 'blocker' && f.track === 'europe'), 'US work authorization without sponsorship is a blocker');
  const gig = trackSignals({
    title: 'Freelance KI-Entwickler (m/w/d)', location: 'Remote, Deutschland', company: 'Hays AG',
    description: 'Für unseren Kunden suchen wir einen Freelancer. Laufzeit: 6 Monate mit Option auf Verlängerung. Tagessatz: 600 €. 100% remote. Sie arbeiten mit LLMs, RAG und LangChain.',
  }, tracks);
  check(gig.freelance.isGig && gig.freelance.rateVerdict.verdict === 'below_minimum', 'a 600 EUR day rate is below a 650 EUR minimum');
  check(gig.freelance.terms.months.max === 6 && gig.freelance.terms.extension === 'stated', 'contract length and extension are read');
  check(gig.freelance.intermediary.via === 'agency', 'an agency posting is recognised');
  check(gig.remote.verdict === 'match' && gig.ai.primary === 'llm_engineer', 'remote in Germany matches, and the AI archetype is found');
  const off = trackSignals({ title: 'LLM Engineer', location: 'Remote (US only)', description: '' }, normalizeTracks({}));
  check(!off.remote && !off.europe && !off.freelance && !off.ai && off.flags.length === 0, 'a profile without tracks produces no track output');
  let failed = 0;
  for (const [ok, name] of checks) {
    console.log((ok ? 'ok   ' : 'FAIL ') + name);
    if (!ok) failed++;
  }
  console.log(failed ? failed + ' self-test check(s) failed' : 'self-test passed (' + checks.length + ' checks)');
  return failed === 0;
}

function main(argv) {
  validateFlags(argv, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true, usageExitCode: 2 });
  if (hasFlag(argv, '--self-test')) process.exit(selfTest() ? 0 : 1);
  const skip = new Set();
  argv.forEach((a, i) => { if (VALUE_FLAGS.includes(a)) skip.add(i + 1); });
  const file = argv.find((a, i) => !skip.has(i) && (a === '-' || !a.startsWith('-')));
  if (!file) {
    console.error(USAGE);
    process.exit(2);
  }
  let description;
  try {
    description = readFileSync(file === '-' ? 0 : file, 'utf-8');
  } catch (err) {
    console.error('track-signals: cannot read ' + file + ': ' + String(err?.message ?? err).split('\n')[0]);
    process.exit(2);
  }
  const tracks = loadTracks(flagValue(argv, '--profile') || getProfilePath());
  for (const w of tracks.warnings) console.error('track-signals: ' + w);
  const result = trackSignals({
    title: flagValue(argv, '--title') || '', location: flagValue(argv, '--location') || '', company: flagValue(argv, '--company') || '', description,
  }, tracks);
  console.log(hasFlag(argv, '--summary') ? summarize(result) : JSON.stringify(result, null, 2));
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
