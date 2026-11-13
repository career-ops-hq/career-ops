#!/usr/bin/env node
/**
 * tracks-setup.mjs — turn search tracks on (job-engine: docs/TRACKS.md).
 *
 * Writes the "tracks:" block into config/profile.yml and merges the matching
 * sources from templates/tracks/portals.tracks.yml into portals.yml. Both
 * files are edited line by line, so every comment and every entry you
 * already have stays as it is: the script only adds, and switches on boards
 * that were present but disabled.
 *
 *   node tracks-setup.mjs --enable europe,ai_gigs,freelance --remote remote_first
 *   node tracks-setup.mjs --enable freelance --freelance-only --dry-run
 *
 * Run it after onboarding has created the two files. It prints one JSON
 * object describing what it changed.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { REMOTE_PREFERENCES } from './lib/remote-fit.mjs';
import { WORK_AUTHORIZATIONS } from './lib/tracks.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
export const PRESETS_PATH = join(CODE_ROOT, 'templates', 'tracks', 'portals.tracks.yml');
const SOURCE_TRACKS = ['europe', 'ai_gigs', 'freelance'];
const KNOWN_FLAGS = ['--enable', '--remote', '--country', '--timezone', '--work-authorization', '--freelance-only', '--target', '--dry-run', '--force', '--help', '-h'];
const VALUE_FLAGS = ['--enable', '--remote', '--country', '--timezone', '--work-authorization', '--target'];
const USAGE = [
  'Usage:',
  '  node tracks-setup.mjs --enable <europe,ai_gigs,freelance> [--remote remote_only|remote_first|hybrid_ok]',
  '                        [--country Germany] [--timezone Europe/Berlin] [--work-authorization eu_citizen]',
  '                        [--freelance-only] [--target <dir>] [--dry-run] [--force]',
  '',
  'Adds the tracks block to config/profile.yml and merges the track sources into portals.yml.',
  'Existing content is kept; --force replaces an existing tracks block. --dry-run writes nothing.',
].join('\n');

class SetupError extends Error {}

const q = s => JSON.stringify(String(s));

/** The tracks block as profile.yml text. */
export function tracksBlock({ enable, remote, country, timezone, workAuthorization, freelanceOnly }) {
  const on = id => enable.includes(id);
  const lines = [
    '# ── Search tracks (docs/TRACKS.md) ─────────────────────────────────────────',
    '# Written by tracks-setup.mjs. Edit freely; rerun with --force to regenerate.',
    'tracks:',
    '  europe:',
    '    enabled: ' + on('europe'),
    '    base_country: ' + q(country || 'Germany') + '          # where you live and pay tax',
    (workAuthorization ? '    work_authorization: ' + workAuthorization : '    # work_authorization: eu_citizen') + '   # set one: ' + WORK_AUTHORIZATIONS.join(' | '),
    '    target_countries: []                # countries you would work in or for; [] = any',
    '    languages: {}                       # what you speak, e.g. { de: native, en: C1 }',
    '    contract_types: []                  # accepted: employment, fixed_term, eor, freelance, temp_agency; [] = any',
    '  ai_gigs:',
    '    enabled: ' + on('ai_gigs'),
    '    focus: []                           # [] = every AI archetype; see docs/TRACKS.md for the ids',
    '    include_crowd_work: false           # true: per-task model-training work is in scope',
    '  freelance:',
    '    enabled: ' + on('freelance'),
    '    mode: ' + (freelanceOnly ? 'only' : 'alongside') + '                     # alongside employment | only',
    '    day_rate:',
    '      target: null                      # your target day rate, a number; null = no target',
    '      minimum: null                     # your walk-away day rate; null = pay never counts against a gig',
    '      currency: EUR',
    '    hours_per_day: 8',
    '    billable_days_per_year: 200',
    '    min_contract_months: null',
    '    max_payment_terms_days: null',
    '    accept_agencies: true',
    '    fx_to_base: {}                      # your own conversion rates into the day-rate currency, e.g. { GBP: 1.15, USD: 0.9, CHF: 1.05 }',
  ];
  if (remote) {
    lines.push(
      '  remote:',
      '    preference: ' + remote + '          # ' + REMOTE_PREFERENCES.join(' | '),
      '    timezone: ' + q(timezone || 'Europe/Berlin'),
      '    timezone_flexible: false            # true: required working hours in a far time zone are shown, never a mismatch',
      '    hybrid_cities: []                   # cities where hybrid or on-site is acceptable',
      '    max_onsite_days_per_month: null',
    );
  }
  return lines.join('\n') + '\n';
}

/** Add or replace the tracks block in profile text. */
export function applyTracksToProfile(text, block, { force = false } = {}) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^tracks:\s*(#.*)?$/.test(l));
  if (start < 0) return { text: text.replace(/\n*$/, '\n\n') + block, action: 'added' };
  if (!force) return { text, action: 'kept' };
  let end = lines.findIndex((l, i) => i > start && /^[A-Za-z_]/.test(l));
  if (end < 0) end = lines.length;
  let from = start;
  while (from > 0 && /^# (──|Written by tracks-setup)/.test(lines[from - 1])) from--;
  lines.splice(from, end - from, ...block.replace(/\n$/, '').split('\n'), '');
  return { text: lines.join('\n'), action: 'replaced' };
}

function blockRange(lines, key) {
  const start = lines.findIndex(l => new RegExp('^' + key + ':\\s*(#.*)?$').test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^[A-Za-z_]/.test(l));
  if (end < 0) end = lines.length;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return [start, end];
}

function entryLines(entry) {
  const dumped = yaml.dump([entry], { lineWidth: -1, quotingType: '"', flowLevel: 3 }).replace(/\n$/, '');
  return dumped.split('\n').map(l => '  ' + l);
}

// Switch on an entry that is present but disabled: the "enabled: false" line
// inside the entry whose "- name:" line carries this name.
function enableEntry(lines, range, name) {
  const [start, end] = range;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^(\s*)-\s+name:\s*(.+?)\s*(#.*)?$/);
    if (!m) continue;
    let value;
    try { value = loadYaml(m[2]); } catch { continue; }
    if (String(value) !== name) continue;
    for (let j = i + 1; j < end && !/^\s*-\s+\w+:/.test(lines[j]); j++) {
      if (/^\s+enabled:\s*false\b/.test(lines[j])) {
        lines[j] = lines[j].replace(/enabled:\s*false/, 'enabled: true');
        return true;
      }
    }
  }
  return false;
}

function mergeList(lines, config, key, wanted, label, report) {
  if (!wanted.length) return;
  const existing = Array.isArray(config[key]) ? config[key] : [];
  let range = blockRange(lines, key);
  const fresh = [];
  for (const entry of wanted) {
    const current = existing.find(e => e && String(e.name) === String(entry.name));
    if (!current) fresh.push(entry);
    else if (current.enabled === false && range && enableEntry(lines, range, String(entry.name))) report.enabled.push(entry.name);
  }
  if (!fresh.length) return;
  const added = ['', '  # ── Search tracks: ' + label + ' (added by tracks-setup.mjs) ──'];
  for (const entry of fresh) { added.push(...entryLines(entry)); report.added.push(entry.name); }
  if (!range) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', key + ':', ...added.slice(1), '');
    return;
  }
  lines.splice(range[1], 0, ...added);
}

/**
 * Merge the presets of the enabled tracks into portals.yml text.
 * @returns {{ text: string, report: object }}
 */
export function applyTracksToPortals(text, presets, { enable, remote, freelanceOnly }) {
  const config = loadYaml(text) || {};
  const lines = text.split('\n');
  const report = {
    boards: { added: [], enabled: [] }, queries: { added: [], enabled: [] }, positives_added: [], tracks_filter: 'kept',
  };
  const ids = [...enable.filter(id => SOURCE_TRACKS.includes(id)), ...(remote ? ['remote'] : [])];

  const positives = [];
  for (const id of ids) for (const kw of presets[id]?.title_positive || []) positives.push(String(kw));
  const have = new Set((config.title_filter?.positive || []).map(k => String(k).replace(/^(word|stem):/i, '').toLowerCase()));
  const newPositives = [...new Set(positives)].filter(k => !have.has(k.toLowerCase()));
  if (newPositives.length) {
    const tf = blockRange(lines, 'title_filter');
    const pos = tf ? lines.findIndex((l, i) => i > tf[0] && i < tf[1] && /^  positive:\s*(#.*)?$/.test(l)) : -1;
    if (pos >= 0) {
      let end = lines.findIndex((l, i) => i > pos && /^ {0,2}[A-Za-z_]/.test(l));
      if (end < 0) end = lines.length;
      while (end > pos + 1 && (lines[end - 1].trim() === '' || /^\s*#/.test(lines[end - 1]))) end--;
      lines.splice(end, 0, '    # Search tracks (added by tracks-setup.mjs)', ...newPositives.map(k => '    - ' + q(k)));
      report.positives_added = newPositives;
    }
  }

  // Later insertions sit below earlier ones, so each merge re-reads its range.
  for (const id of ids) {
    mergeList(lines, config, 'search_queries', presets[id]?.search_queries || [], id, report.queries);
  }
  for (const id of ids) {
    mergeList(lines, config, 'job_boards', presets[id]?.job_boards || [], id, report.boards);
  }

  const filter = {};
  if (remote) Object.assign(filter, presets.remote?.tracks_filter || { remote_fit: 'drop' });
  if (freelanceOnly) filter.engagement = 'freelance_only';
  if (Object.keys(filter).length && config.tracks_filter === undefined) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '# -- Search tracks filter (docs/TRACKS.md), added by tracks-setup.mjs --', 'tracks_filter:');
    for (const [k, v] of Object.entries(filter)) lines.push('  ' + k + ': ' + v);
    lines.push('');
    report.tracks_filter = 'added';
  }

  const next = lines.join('\n');
  loadYaml(next); // a merge that breaks the file must not be written
  return { text: next, report };
}

function main(argv) {
  validateFlags(argv, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true, usageExitCode: 2 });
  const enable = (flagValue(argv, '--enable') || '').split(',').map(s => s.trim().replace(/-/g, '_')).filter(Boolean);
  const remote = flagValue(argv, '--remote');
  const workAuthorization = flagValue(argv, '--work-authorization');
  try {
    if (!enable.length && !remote) throw new SetupError('nothing to do: pass --enable and/or --remote');
    const unknown = enable.find(id => !SOURCE_TRACKS.includes(id));
    if (unknown) throw new SetupError('unknown track "' + unknown + '" (known: ' + SOURCE_TRACKS.join(', ') + '; the remote track is set with --remote)');
    if (remote !== undefined && !REMOTE_PREFERENCES.includes(remote)) throw new SetupError('--remote takes ' + REMOTE_PREFERENCES.join(', '));
    if (workAuthorization !== undefined && !WORK_AUTHORIZATIONS.includes(workAuthorization)) throw new SetupError('--work-authorization takes ' + WORK_AUTHORIZATIONS.join(', '));
    const freelanceOnly = hasFlag(argv, '--freelance-only');
    if (freelanceOnly && !enable.includes('freelance')) throw new SetupError('--freelance-only needs --enable freelance');

    const target = flagValue(argv, '--target');
    const root = target || getCareerOpsRoot();
    const profilePath = target ? getProfilePath(target) : getProfilePath();
    const portalsPath = target ? join(target, 'portals.yml') : (process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml'));
    for (const [path, what] of [[profilePath, 'config/profile.yml'], [portalsPath, 'portals.yml']]) {
      if (!existsSync(path)) throw new SetupError(what + ' not found at ' + path + '. Run onboarding first (see AGENTS.md, "First Run").');
    }
    const dryRun = hasFlag(argv, '--dry-run');
    const options = { enable, remote, freelanceOnly, workAuthorization, country: flagValue(argv, '--country'), timezone: flagValue(argv, '--timezone') };

    const profile = applyTracksToProfile(readFileSync(profilePath, 'utf-8'), tracksBlock(options), { force: hasFlag(argv, '--force') });
    loadYaml(profile.text);
    const portals = applyTracksToPortals(readFileSync(portalsPath, 'utf-8'), loadYaml(readFileSync(PRESETS_PATH, 'utf-8')), options);
    if (!dryRun) {
      if (profile.action !== 'kept') writeFileAtomic(profilePath, profile.text);
      writeFileAtomic(portalsPath, portals.text);
    }
    console.log(JSON.stringify({ dry_run: dryRun, profile: { path: profilePath, tracks_block: profile.action }, portals: { path: portalsPath, ...portals.report } }, null, 2));
  } catch (err) {
    if (!(err instanceof SetupError) && err?.name !== 'YAMLException') throw err;
    console.error('tracks-setup: ' + String(err.message).split('\n')[0]);
    process.exit(err instanceof SetupError ? 2 : 1);
  }
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
