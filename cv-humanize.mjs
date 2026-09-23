#!/usr/bin/env node
/**
 * cv-humanize.mjs — Deterministic anti-AI-slop pass for tailored CV JSON payloads.
 *
 * Tier-1 voice-dna rules only (formal ATS register). No LLM. Facts unchanged.
 * Wired into generate-pdf.mjs and generate-cover-letter.mjs before render.
 *
 *   node cv-humanize.mjs --self-test
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Word-level swaps — banned AI fingerprint → plain English (CV-safe). */
const WORD_REPLACEMENTS = new Map([
  ['leverage', 'use'],
  ['leveraged', 'used'],
  ['leveraging', 'using'],
  ['utilize', 'use'],
  ['utilized', 'used'],
  ['utilizing', 'using'],
  ['robust', 'reliable'],
  ['streamlined', 'simplified'],
  ['streamlining', 'simplifying'],
  ['streamline', 'simplify'],
  ['innovative', 'practical'],
  ['scalable', 'high-volume'],
  ['optimize', 'improve'],
  ['optimized', 'improved'],
  ['optimizing', 'improving'],
  ['optimise', 'improve'],
  ['optimised', 'improved'],
  ['optimising', 'improving'],
  ['comprehensive', 'full'],
  ['demonstrated', 'showed'],
  ['spearheaded', 'led'],
  ['orchestrated', 'ran'],
  ['facilitated', 'led'],
  ['synergy', 'coordination'],
  ['synergies', 'coordination'],
  ['holistic', 'end-to-end'],
  ['cutting-edge', 'current'],
  ['cutting edge', 'current'],
  ['data-driven', 'metrics-based'],
  ['proactive', 'active'],
  ['dynamic', 'fast-moving'],
  ['seamless', 'smooth'],
  ['transformative', 'major'],
  ['empower', 'enable'],
  ['empowered', 'enabled'],
  ['enhance', 'improve'],
  ['enhanced', 'improved'],
  ['foster', 'build'],
  ['fostered', 'built'],
  ['showcase', 'show'],
  ['showcased', 'showed'],
  ['showcasing', 'showing'],
  ['underscore', 'stress'],
  ['underscored', 'stressed'],
  ['pivotal', 'key'],
  ['crucial', 'key'],
  ['meticulous', 'careful'],
  ['meticulously', 'carefully'],
]);

const PHRASE_REPLACEMENTS = [
  [/\bin order to\b/gi, 'to'],
  [/\bit is worth noting that\b/gi, ''],
  [/\bit's worth noting that\b/gi, ''],
  [/\bit is important to note that\b/gi, ''],
  [/\bfurthermore,?\s*/gi, ''],
  [/\badditionally,?\s*/gi, ''],
  [/\bmoreover,?\s*/gi, ''],
  [/\bthat said,?\s*/gi, ''],
  [/\bwith that in mind,?\s*/gi, ''],
  [/\bmoving forward,?\s*/gi, ''],
  [/\bat the end of the day,?\s*/gi, ''],
  [/\bin today's\b/gi, 'In current'],
];

const BULLET_STARTERS = ['Built', 'Led', 'Drove', 'Delivered', 'Designed', 'Ran', 'Shipped', 'Owned', 'Scoped'];

const NEGATIVE_PARALLEL_RE = [
  /\b(?:This|It) isn't [^.!?]+?\.\s*(?:This|It) is ([^.!?]+)\./gi,
  /\bIt's not about [^.!?]+?\.\s*It's about ([^.!?]+)\./gi,
  /\bNot [^.!?]+?\.\s*([A-Z][^.!?]+)\./g,
];

function loadBannedWords() {
  const path = join(ROOT, 'voice-dna.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const m = text.match(/### 3A\. Dead AI vocabulary[\s\S]*?^([a-z, /()]+)$/m);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((w) => w.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase())
    .filter((w) => w.length > 2 && !WORD_REPLACEMENTS.has(w));
}

let cachedBanned = null;
function getBannedWords() {
  if (!cachedBanned) cachedBanned = loadBannedWords();
  return cachedBanned;
}

function replaceBannedWords(text) {
  let out = text;
  for (const [bad, good] of WORD_REPLACEMENTS) {
    const re = new RegExp(`\\b${bad}\\b`, 'gi');
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? good[0].toUpperCase() + good.slice(1) : good));
  }
  for (const word of getBannedWords()) {
    if (WORD_REPLACEMENTS.has(word)) continue;
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, '');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function fixPhrases(text) {
  let out = text;
  for (const [re, rep] of PHRASE_REPLACEMENTS) out = out.replace(re, rep);
  out = out.replace(/\u2014/g, '-').replace(/\u2013/g, '-');
  for (const re of NEGATIVE_PARALLEL_RE) {
    out = out.replace(re, (_, keep) => (keep ? keep.trim() : ''));
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

function varyBulletStarters(bullets) {
  if (!Array.isArray(bullets) || bullets.length < 3) return bullets;
  const starts = bullets.map((b) => (String(b).match(/^([A-Za-z]+)/) || ['', ''])[1]);
  const out = [...bullets];
  for (let i = 2; i < starts.length; i++) {
    if (starts[i] && starts[i] === starts[i - 1] && starts[i] === starts[i - 2]) {
      const alt = BULLET_STARTERS.find((s) => s !== starts[i]) || 'Ran';
      out[i] = out[i].replace(/^[A-Za-z]+/, alt);
      starts[i] = alt;
    }
  }
  return out;
}

/** Humanize one prose string (summary, bullet, competency). */
export function humanizeText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = fixPhrases(replaceBannedWords(text));
  out = out.replace(/\b(\w+ing)\s+(\w+ing)\s+and\s+(\w+ing)\b/gi, '$1 and $3');
  return out;
}

/** Fields that must not be word-swapped (employer names, contact, labels). */
const STRUCTURAL_KEYS = new Set([
  'company',
  'role',
  'name',
  'email',
  'phone',
  'location',
  'org',
  'title',
  'year',
  'tech',
  'badge',
  'url',
  'display',
  'dates',
  'lang',
  'page_format',
]);

function humanizeStringFields(obj, key = '') {
  if (typeof obj === 'string') return STRUCTURAL_KEYS.has(key) ? obj : humanizeText(obj);
  if (Array.isArray(obj)) return obj.map((v) => humanizeStringFields(v, key));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = humanizeStringFields(v, k);
    return out;
  }
  return obj;
}

/**
 * @param {object} payload — CV JSON (modes/pdf.md schema)
 * @returns {{ payload: object, changes: string[] }}
 */
export function humanizeCvPayload(payload) {
  const changes = [];
  const before = JSON.stringify(payload);
  const out = humanizeStringFields(payload);

  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((job) => {
      if (!Array.isArray(job.bullets)) return job;
      const varied = varyBulletStarters(job.bullets.map(humanizeText));
      return { ...job, bullets: varied };
    });
  }
  if (Array.isArray(out.projects)) {
    out.projects = out.projects.map((p) => ({
      ...p,
      bullets: Array.isArray(p.bullets) ? varyBulletStarters(p.bullets.map(humanizeText)) : p.bullets,
      description: p.description ? humanizeText(p.description) : p.description,
    }));
  }
  if (out.summary) out.summary = humanizeText(out.summary);

  const after = JSON.stringify(out);
  if (before !== after) changes.push('humanized prose (banned-word swap, phrase trim, bullet variety)');
  return { payload: out, changes };
}

const COVER_LETTER_PROSE_KEYS = [
  'opening',
  'profile_intro',
  'problems_section',
  'closing',
  'language_closing',
];

/**
 * @param {object} payload — cover letter JSON (modes/cover.md schema)
 * @returns {{ payload: object, changes: string[] }}
 */
export function humanizeCoverPayload(payload) {
  const changes = [];
  const before = JSON.stringify(payload);
  const out = JSON.parse(JSON.stringify(payload));

  if (out.letter && typeof out.letter === 'object') {
    const letter = out.letter;
    for (const key of COVER_LETTER_PROSE_KEYS) {
      if (letter[key]) letter[key] = humanizeText(letter[key]);
    }
    if (Array.isArray(letter.achievements)) {
      letter.achievements = letter.achievements.map((ach) => ({
        ...ach,
        lead: ach.lead ? humanizeText(ach.lead) : ach.lead,
        impact: ach.impact ? humanizeText(ach.impact) : ach.impact,
      }));
    }
    if (Array.isArray(letter.footnotes)) {
      letter.footnotes = letter.footnotes.map((fn) => {
        if (typeof fn === 'string') return humanizeText(fn);
        if (fn && typeof fn === 'object') {
          return { ...fn, text: fn.text ? humanizeText(fn.text) : fn.text };
        }
        return fn;
      });
    }
  }

  const after = JSON.stringify(out);
  if (before !== after) changes.push('humanized cover letter prose (banned-word swap, phrase trim)');
  return { payload: out, changes };
}

function selfTest() {
  let failed = 0;
  const ok = (label, cond) => {
    if (cond) console.log(`  ✓ ${label}`);
    else { console.error(`  ✗ ${label}`); failed++; }
  };

  ok('leverage→use', humanizeText('Leverage LLM agents to streamline delivery') === 'Use LLM agents to simplify delivery');
  ok('strips furthermore', !/furthermore/i.test(humanizeText('Furthermore, led the portal build.')));
  ok('negative parallelism', !/isn't/i.test(humanizeText("This isn't a side project. This is production work.")));
  ok('bullet variety', humanizeCvPayload({
    experience: [{ company: 'X', role: 'Y', bullets: ['Led a', 'Led b', 'Led c'] }],
  }).payload.experience[0].bullets[2].match(/^(Built|Drove|Delivered)/));
  ok('preserves employer names', humanizeCvPayload({
    experience: [{ company: 'Synergy Teletech Pvt Ltd', role: 'Field Executive', bullets: ['IoT trucks.'] }],
  }).payload.experience[0].company === 'Synergy Teletech Pvt Ltd');
  ok('cover letter humanize', humanizeCoverPayload({
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'AI Product Manager',
      company: 'Acme Corp',
      opening: 'Furthermore, I leverage seamless AI workflows.',
      profile_intro: 'I led product at SigmaX.',
      achievements: [{ lead: 'Led portal build', impact: 'streamlined releases by 25%' }],
    },
  }).payload.letter.opening.includes('use'));

  process.exit(failed ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.error('Usage: node cv-humanize.mjs --self-test');
    process.exit(1);
  }
}
