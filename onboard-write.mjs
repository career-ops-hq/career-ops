#!/usr/bin/env node
// Writes config/profile.yml and portals.yml from one JSON file of onboarding
// answers. The templates are copied line for line and only the answered
// fields change, so every comment and every tracked company survives.

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { compileKeyword, foldTitle } from './title-keywords.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const PROFILE_TEMPLATE = join(CODE_ROOT, 'config', 'profile.example.yml');
const PORTALS_TEMPLATE = join(CODE_ROOT, 'templates', 'portals.example.yml');
const DEFAULT_MAX_AGE_DAYS = 45;
const CONTACT_KEYS = ['phone', 'linkedin', 'portfolio_url', 'github', 'twitter'];
const NOT_A_PLACE = /^(remote|hybrid|anywhere|on-?site)$/i;

const USAGE = `
  onboard-write.mjs: write config/profile.yml and portals.yml from onboarding answers

  node onboard-write.mjs --answers <file.json | -> [--target <dir>] [--force] [--only profile|portals]

  Existing files are kept unless --force. --only limits the run to one file. Prints {"written":[],"kept":[]} as JSON.
  Answers shape:
  {
    "candidate": { "full_name", "email", "location", "phone"?, "linkedin"?, "portfolio_url"?, "github"?, "twitter"? },
    "target_roles": ["..."],
    "compensation": { "target_range", "currency"?, "minimum"?, "location_flexibility"? },
    "location": { "country", "timezone", "city"?, "visa_status"?, "authorized_in"?, "needs_sponsorship"? },
    "spend_tier": "economy" | "standard" | "premium",
    "archetypes": [{ "name", "level", "fit": "primary" | "secondary" | "adjacent" }]?,
    "narrative": { "headline"?, "exit_story"?, "superpowers"?: ["..."], "proof_points"?: [{ "name", "url"?, "hero_metric"? }] }?,
    "portals": {
      "positive": ["title keyword", ...],
      "negative": ["extra excluded word", ...],
      "countries": ["United States"],
      "cities": ["Berlin"],
      "max_posting_age_days": 45
    }
  }
`;

class AnswerError extends Error {}

function parseArgs(argv) {
  const opts = { force: false };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || (v.startsWith('-') && v !== '-')) throw new AnswerError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--answers') opts.answers = value(++i, a);
    else if (a === '--target') opts.target = value(++i, a);
    else if (a === '--force') opts.force = true;
    else if (a === '--only') opts.only = value(++i, a);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new AnswerError(`unknown argument: ${a}`);
  }
  if (opts.only !== undefined && !['profile', 'portals'].includes(opts.only)) {
    throw new AnswerError(`--only takes profile or portals, got "${opts.only}"`);
  }
  return opts;
}

function list(value) {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

function required(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AnswerError(`missing answer: ${field}`);
  return text;
}

export function normalizeAnswers(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const candidate = a.candidate || {};
  const location = a.location || {};
  const compensation = a.compensation || {};
  const portals = a.portals || {};
  const roles = list(a.target_roles);
  if (!roles.length) throw new AnswerError('missing answer: target_roles');
  const positive = list(portals.positive);
  if (!positive.length) throw new AnswerError('missing answer: portals.positive');
  const tier = a.spend_tier ?? 'standard';
  if (!['economy', 'standard', 'premium'].includes(tier)) {
    throw new AnswerError(`spend_tier must be economy, standard or premium, got "${tier}"`);
  }
  const places = [...list(portals.countries), ...list(portals.cities)];
  const notPlace = places.find((p) => NOT_A_PLACE.test(p));
  if (notPlace) {
    throw new AnswerError(`portals.countries and portals.cities take places only, not "${notPlace}". An allow-list entry like that admits every country, so leave it out.`);
  }
  const archetypes = Array.isArray(a.archetypes) ? a.archetypes.map((x, i) => ({
    name: required(x?.name, `archetypes[${i}].name`),
    level: x?.level?.trim() || '',
    fit: ['primary', 'secondary', 'adjacent'].includes(x?.fit) ? x.fit : 'primary',
  })) : [];
  const narrative = a.narrative || {};
  const age = portals.max_posting_age_days ?? DEFAULT_MAX_AGE_DAYS;
  if (!Number.isInteger(age) || age < 0) {
    throw new AnswerError('portals.max_posting_age_days must be a whole number of days (0 turns it off)');
  }
  const negative = list(portals.negative);
  for (const n of negative) {
    const matches = compileKeyword(foldTitle(n));
    const title = positive.find((p) => matches(foldTitle(p)));
    if (title) throw new AnswerError(`portals.negative "${n}" rejects the title "${title}"`);
  }
  return {
    candidate: {
      full_name: required(candidate.full_name, 'candidate.full_name'),
      email: required(candidate.email, 'candidate.email'),
      location: required(candidate.location, 'candidate.location'),
      ...Object.fromEntries(CONTACT_KEYS.map((k) => [k, typeof candidate[k] === 'string' ? candidate[k].trim() : ''])),
    },
    target_roles: roles,
    compensation: {
      target_range: required(compensation.target_range, 'compensation.target_range'),
      currency: required(compensation.currency, 'compensation.currency'),
      minimum: compensation.minimum?.trim() || '',
      location_flexibility: compensation.location_flexibility?.trim() || '',
    },
    location: {
      country: required(location.country, 'location.country'),
      city: location.city?.trim() || '',
      timezone: required(location.timezone, 'location.timezone'),
      visa_status: location.visa_status?.trim() || '',
      authorized_in: list(location.authorized_in),
      needs_sponsorship: location.needs_sponsorship === true,
    },
    spend_tier: tier,
    archetypes,
    narrative: {
      headline: narrative.headline?.trim() || '',
      exit_story: narrative.exit_story?.trim() || '',
      superpowers: list(narrative.superpowers),
      proof_points: (Array.isArray(narrative.proof_points) ? narrative.proof_points : []).map((x, i) => ({
        name: required(x?.name, `narrative.proof_points[${i}].name`),
        url: x?.url?.trim() || '',
        hero_metric: x?.hero_metric?.trim() || '',
      })),
    },
    portals: {
      positive,
      negative,
      countries: list(portals.countries),
      cities: list(portals.cities),
      max_posting_age_days: age,
    },
  };
}

const q = (s) => JSON.stringify(s);

function sectionBounds(lines, section) {
  const start = lines.findIndex((l) => l === `${section}:`);
  if (start < 0) throw new Error(`template has no top-level "${section}:"`);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_]/.test(lines[end])) end++;
  return [start, end];
}

function keyLine(lines, section, key) {
  const [start, end] = sectionBounds(lines, section);
  for (let i = start + 1; i < end; i++) {
    if (lines[i].startsWith(`  ${key}:`)) return i;
  }
  throw new Error(`template has no ${section}.${key}`);
}

function setScalar(lines, section, key, value) {
  const i = keyLine(lines, section, key);
  const comment = lines[i].match(/\s+#[^"]*$/)?.[0] ?? '';
  lines[i] = `  ${key}: ${value}${comment}`;
}

function replaceNested(lines, at, nested) {
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith('    ')) end++;
  lines.splice(at + 1, end - at - 1, ...nested);
}

function setList(lines, section, key, items) {
  const at = keyLine(lines, section, key);
  if (items.length) {
    lines[at] = `  ${key}:`;
    replaceNested(lines, at, items);
  } else {
    lines[at] = `  ${key}: []`;
    replaceNested(lines, at, []);
  }
}

function replaceItems(lines, at, items, indent) {
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith(`${indent}- `)) end++;
  lines.splice(at + 1, end - at - 1, ...items.map((s) => `${indent}- ${q(s)}`));
}

export function buildProfile(template, a) {
  const lines = template.split('\n');
  for (const [k, v] of Object.entries(a.candidate)) setScalar(lines, 'candidate', k, q(v));
  replaceItems(lines, keyLine(lines, 'target_roles', 'primary'), a.target_roles, '    ');
  setList(lines, 'target_roles', 'archetypes', a.archetypes.map((x) => `    - { name: ${q(x.name)}, level: ${q(x.level)}, fit: ${x.fit} }`));
  setScalar(lines, 'narrative', 'headline', q(a.narrative.headline));
  setScalar(lines, 'narrative', 'exit_story', q(a.narrative.exit_story));
  setList(lines, 'narrative', 'superpowers', a.narrative.superpowers.map((x) => `    - ${q(x)}`));
  setList(lines, 'narrative', 'proof_points', a.narrative.proof_points.map((x) => `    - { name: ${q(x.name)}, url: ${q(x.url)}, hero_metric: ${q(x.hero_metric)} }`));
  for (const [k, v] of Object.entries(a.compensation)) setScalar(lines, 'compensation', k, q(v));
  const { authorized_in, needs_sponsorship, ...loc } = a.location;
  for (const [k, v] of Object.entries(loc)) setScalar(lines, 'location', k, q(v));
  setScalar(lines, 'location', 'authorized_in', `[${authorized_in.map(q).join(', ')}]`);
  setScalar(lines, 'location', 'needs_sponsorship', String(needs_sponsorship));
  const tier = lines.findIndex((l) => l.startsWith('spend_tier:'));
  if (tier < 0) throw new Error('template has no spend_tier');
  lines[tier] = `spend_tier: ${a.spend_tier}`;
  return lines.join('\n');
}

function blockAfter(lines, header, nextHeader) {
  const start = lines.findIndex((l) => l === header);
  const next = lines.findIndex((l, i) => i > start && l === nextHeader);
  if (start < 0 || next < 0) throw new Error(`template has no "${header.trim()}" block`);
  return [start, next];
}

export function buildPortals(template, a) {
  const p = a.portals;
  const lines = template.split('\n');
  const shippedNegatives = loadYaml(template).title_filter.negative.map((n) => foldTitle(String(n)));

  // Drop shipped negatives that would reject a user positive under the same
  // word:/stem:/substring rules the scanner uses.
  const conflicting = new Set(shippedNegatives.filter((negative) => {
    const matches = compileKeyword(negative);
    return p.positive.some((positive) => matches(foldTitle(positive)));
  }));
  const [negStart, negEnd] = blockAfter(lines, '  negative:', '  seniority_boost:');
  for (let i = negEnd - 1; i > negStart; i--) {
    const match = lines[i].match(/^\s+-\s+(.+)$/);
    if (!match) continue;
    let value;
    try { value = loadYaml(match[1]); } catch { continue; }
    if (typeof value === 'string' && conflicting.has(foldTitle(value))) lines.splice(i, 1);
  }
  const [, filteredNegEnd] = blockAfter(lines, '  negative:', '  seniority_boost:');
  let negInsert = filteredNegEnd;
  while (lines[negInsert - 1].trim() === '') negInsert--;
  const extra = [...new Set(p.negative)].filter((n) => !shippedNegatives.includes(foldTitle(n)));
  lines.splice(negInsert, 0, ...extra.map((n) => `    - ${q(n)}`));

  // Replace active positive entries only; keep the template's keyword guidance.
  const [posStart, posEnd] = blockAfter(lines, '  positive:', '  negative:');
  const keptPositiveNotes = [];
  for (let i = posStart + 1; i < posEnd; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') keptPositiveNotes.push(line);
  }
  lines.splice(posStart + 1, posEnd - posStart - 1, ...keptPositiveNotes, ...p.positive.map((s) => `    - ${q(s)}`));

  if (p.max_posting_age_days > 0) {
    const age = lines.findIndex((l) => /^# max_posting_age_days: \d+$/.test(l));
    if (age < 0) throw new Error('template has no "# max_posting_age_days" line');
    lines[age] = `max_posting_age_days: ${p.max_posting_age_days}`;
  }

  if (p.countries.length || p.cities.length) {
    const at = lines.findIndex((l) => l.startsWith('# -- Country-eligibility filter'));
    if (at < 0) throw new Error('template has no country-eligibility section to anchor location_filter');
    const block = ['location_filter:'];
    if (p.countries.length) block.push('  always_allow:', ...p.countries.map((c) => `    - ${q(c)}`));
    block.push('  allow:', ...[...p.countries, ...p.cities].map((c) => `    - ${q(c)}`), '');
    lines.splice(at, 0, ...block);
  }
  return lines.join('\n');
}

function checkProfile(text, a) {
  const p = loadYaml(text);
  const ok = p.candidate.full_name === a.candidate.full_name
    && JSON.stringify(p.target_roles.primary) === JSON.stringify(a.target_roles)
    && p.location.country === a.location.country
    && p.spend_tier === a.spend_tier;
  if (!ok) throw new Error('profile.yml did not read back as written');
}

function checkPortals(text, templateText, a) {
  const c = loadYaml(text);
  const t = loadYaml(templateText);
  const ok = JSON.stringify(c.title_filter.positive) === JSON.stringify(a.portals.positive)
    && c.tracked_companies.length === t.tracked_companies.length
    && (a.portals.max_posting_age_days > 0 ? c.max_posting_age_days === a.portals.max_posting_age_days : c.max_posting_age_days === undefined);
  if (!ok) throw new Error('portals.yml did not read back as written');
}

function readAnswers(source) {
  if (!source) throw new AnswerError('--answers <file.json | -> is required');
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(source), 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AnswerError(`answers are not valid JSON: ${err.message}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const answers = normalizeAnswers(readAnswers(opts.answers));
  const root = opts.target ? resolve(opts.target) : getCareerOpsRoot();
  const targets = [
    {
      key: 'profile',
      rel: 'config/profile.yml',
      path: getProfilePath(opts.target ? root : undefined),
      build: () => {
        const text = buildProfile(readFileSync(PROFILE_TEMPLATE, 'utf8'), answers);
        checkProfile(text, answers);
        return text;
      },
    },
    {
      key: 'portals',
      rel: 'portals.yml',
      path: opts.target ? join(root, 'portals.yml') : (process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml')),
      build: () => {
        const template = readFileSync(PORTALS_TEMPLATE, 'utf8');
        const text = buildPortals(template, answers);
        checkPortals(text, template, answers);
        return text;
      },
    },
  ];
  const planned = targets.map((t) => ({
    ...t,
    keep: (opts.only !== undefined && opts.only !== t.key) || (existsSync(t.path) && !opts.force),
  }));
  const texts = planned.map((t) => (t.keep ? null : t.build()));
  planned.forEach((t, i) => {
    if (t.keep) return;
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileAtomic(t.path, texts[i]);
  });
  console.log(JSON.stringify({
    written: planned.filter((t) => !t.keep).map((t) => t.rel),
    kept: planned.filter((t) => t.keep).map((t) => t.rel),
  }));
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`onboard-write: ${err.message}`);
    if (err instanceof AnswerError) console.error(USAGE);
    process.exitCode = 1;
  }
}
