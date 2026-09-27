#!/usr/bin/env node
/**
 * cv-humanize.mjs — Deterministic anti-AI-slop pass for tailored CV JSON payloads.
 *
 * Tier-1 voice-dna rules only (formal ATS register). No LLM. Facts unchanged.
 * Wired into generate-pdf.mjs and generate-cover-letter.mjs before render.
 *
 * Two passes, deliberately unequal in power:
 *
 *   1. Auto-fix. Only where a mechanical rewrite is provably safe — a word with
 *      a registered plain-English replacement, a dead connective that deletes
 *      cleanly, a unicode dash. Never guess at prose.
 *
 *   2. Lint. Reports what a human must judge, per voice-dna §5 ("don't avoid a
 *      word forever just because it's on a banned list — sometimes it's
 *      genuinely the right word"). Reported, never silently deleted.
 *
 * The split exists because deleting an unreplaced banned word produces
 * sentence holes: "We align with the robust platform" becomes "We  with the
 * platform". An earlier revision did exactly that, silently, for 58 of the 82
 * words in §3A. It is what a linter is for.
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
  // Added so the §3A list stops deferring the 58 words it had no answer for.
  // Each is a plain-English equivalent, never a deletion.
  ['aligns', 'matches'],
  ['aligning', 'matching'],
  ['aligned', 'matched'],
  ['delve', 'look at'],
  ['delves', 'looks at'],
  ['leveraging', 'using'],
  ['revolutionize', 'change'],
  ['revolutionized', 'changed'],
  ['groundbreaking', 'unusual'],
  ['pioneering', 'early'],
  ['trailblazing', 'unusual'],
  ['unparalleled', 'unusual'],
  ['unprecedented', 'unusual'],
  ['comprehensive', 'full'],
  ['interplay', 'interaction'],
  ['valuable', 'useful'],
  ['frictionless', 'smooth'],
  ['effortless', 'simple'],
  ['adaptive', 'flexible'],
  ['insightful', 'useful'],
  ['immersive', 'engaging'],
  ['intuitive', 'easy to use'],
  ['transformative', 'major'],
  ['cutting-edge', 'current'],
]);

const PHRASE_REPLACEMENTS = [
  [/\bin order to\b/gi, 'to'],
  [/\bit is worth noting that\b/gi, ''],
  [/\bit's worth noting that\b/gi, ''],
  [/\bit is important to note that\b/gi, ''],
  [/\bfurthermore,?\s*/gi, ''],
  [/\bmoreover,?\s*/gi, ''],
  [/\bthat said,?\s*/gi, ''],
  [/\bwith that in mind,?\s*/gi, ''],
  [/\bat the end of the day,?\s*/gi, ''],
  [/\bin today's\b/gi, 'In current'],
  [/\bin this (?:section|article|post|guide|document),?/gi, ''],
  [/\bto put this in perspective,?\s*/gi, ''],
  [/\bin other words,?\s*/gi, ''],
  [/\bit goes without saying that\b/gi, ''],
  [/\blet's (?:dive in|explore|unpack),?\s*/gi, ''],
  [/\bwhat nobody (?:tells you|is talking about)\b/gi, ''],
  [/\bmost people don't realize\b/gi, ''],
  [/\bthe implications (?:here )?are\b/gi, ''],
  [/\bwhat makes this particularly interesting is\b/gi, ''],
  [/\bas an ai\b/gi, ''],
  [/\bbased on (?:available|the available) information,?\s*/gi, ''],
  [/\bwhile specific details are limited,?\s*/gi, ''],
  [/\badditionally\b/gi, ''],
  [/\bthat being said,?\s*/gi, ''],
  [/\bon top of that,?\s*/gi, ''],
  [/\bit is also worth mentioning that\b/gi, ''],
  [/\blet that sink in\.?/gi, ''],
  [/\bread that again\.?/gi, ''],
  [/\bthis changes everything\.?/gi, ''],
  [/\bgame[- ]changer\b/gi, 'significant change'],
  [/\b10x your\b/gi, 'multiply your'],
  [/\bserves as\b/gi, 'is'],
  [/\bstands as\b/gi, 'is'],
  [/\bholds the distinction of being\b/gi, 'is'],
  [/\bmoving forward,?\s*/gi, ''],
];

/**
 * Structural tells. voice-dna.md documents these at length (§3B–§3F, §4A–§4K)
 * but nothing read them — the parser below only ever attempted §3A, and failed.
 * They are report-only: a lint hit means a human decides, because every one of
 * these has a legitimate exception and an auto-rewrite would sometimes be wrong.
 */
const LINT_RULES = [
  // §3F — the file's own "most reliable tell of AI-generated text".
  { id: '3F', label: 'negative parallelism (reframe)', severity: 'high',
    re: /\b(?:this|it) (?:isn't|is not)\b[^.!?]*[.!?]\s*(?:this|it) (?:is|was)\b/i },
  { id: '3F', label: 'negative parallelism (not X, Y)', severity: 'high',
    re: /\bnot\b[^.!?]{1,80}[.!?]\s+[A-Z]/ },
  { id: '3F', label: 'negative parallelism (not just about)', severity: 'high',
    re: /\bnot (?:just )?about\b[^.!?]{0,60},\s*it'?s about\b/i },
  { id: '3F', label: 'negative parallelism (less X more Y)', severity: 'high',
    re: /\bless\s+[\w\s]{1,30},?\s+more\s+\w/i },
  { id: '3F', label: 'negative parallelism (not only but also)', severity: 'high',
    re: /\bnot only\b[^.!?]{1,60}\bbut (?:also\s+)?\w/i },
  { id: '3F', label: 'negative parallelism (concession pivot)', severity: 'high',
    re: /\bwhile\b[^.!?]{1,60},\s*\w+ (?:is|are) actually\b/i },
  { id: '3F', label: 'negative parallelism (forget X)', severity: 'high',
    re: /\bforget\b[^.!?]{1,40}[.!?]\s*(?:this|that|it)\b/i },

  // §4B — the AI default is three. Two or four is the tell of a person.
  { id: '4B', label: 'rule of three (3-item list)', severity: 'medium',
    re: /\b\w+(?:[- ]\w+)?,\s+\w+(?:[- ]\w+)?,\s+and\s+\w+(?:[- ]\w+)?\b/ },

  // §4A — significance inflation.
  { id: '4A', label: 'puffery', severity: 'medium',
    re: /\b(?:pivotal|landmark|revolutionary|world[- ]class|best[- ]in[- ]class|industry[- ]leading|next[- ]level|cutting[- ]edge|game[- ]changing)\b/i },
  { id: '4A', label: 'significance inflation', severity: 'medium',
    re: /\b(?:setting the stage for|major (?:milestone|turning point)|key turning point|significant shift)\b/i },

  // §4C — a range with no meaningful middle.
  { id: '4C', label: 'false range', severity: 'medium',
    re: /\bfrom\s+\w+\s+traditions?\s+to\s+modern\b/i },

  // §4F — "-ing" clause bolted on to fake depth.
  { id: '4F', label: 'participle padding', severity: 'medium',
    re: /,\s+(?:highlighting|underscoring|reflecting|contributing|reinforcing|showcasing|demonstrating|ensuring|establishing|paving the way|setting the stage|solidifying|cementing)\b[^.]{0,60}/i },

  // §4H — chat leakage into published prose.
  { id: '4H', label: 'collaborative leakage', severity: 'high',
    re: /\b(?:i hope this helps|would you like me to|great question|certainly!|of course!|let me know if)\b/i },
  { id: '4G', label: 'knowledge-cutoff disclaimer', severity: 'high',
    re: /\bas of my last update\b/i },

  // §3E / §3D — hype and engagement bait.
  { id: '3D', label: 'engagement bait', severity: 'medium',
    re: /\b(?:you're not ready for this|are you paying attention|let that sink in)\b/i },
];

/** Acronyms and proper nouns that are legitimately title case in headers (§4K). */
const HEADER_ALLOWLIST = new Set([
  'ai','api','ci','cd','crm','erp','gdpr','gxp','hr','iot','it','kpi','llm',
  'mvp','n8n','prd','qa','roi','saas','sla','sql','ui','ux','vp','cxo','b2b',
  'b2c','ibm','deloitte','us','uk','iim','ais','llms','prds','cvs','tvs',
]);

const BULLET_STARTERS = ['Built', 'Led', 'Drove', 'Delivered', 'Designed', 'Ran', 'Shipped', 'Owned', 'Scoped'];

/**
 * Destructive reframe rewrites, kept separate from LINT_RULES because these
 * *do* edit. Each keeps only the positive claim; the negation is the tic.
 */
const NEGATIVE_PARALLEL_RE = [
  [/\b(?:This|It) isn't [^.!?]+?\.\s*(?:This|It) is ([^.!?]+)\./gi, 'This is $1.'],
  [/\bIt's not about [^.!?]+?\.\s*It's about ([^.!?]+)\./gi, "It's about $1."],
  [/\bIt's not just about [^.!?]+?,\s*it's about ([^.!?]+)\./gi, "It's about $1."],
  [/\bLess [^,]{1,40},?\s+more ([^.!?]+?)\./gi, 'More $1.'],
  [/\bNot only ([^.!?]+?),? but also ([^.!?]+?)\./gi, '$1 and $2.'],
  [/\bForget [^.!?]+?\.\s*(?:This|That|It) is ([^.!?]+)\./gi, 'This is $1.'],
  [/\bThe question isn't [^.!?]+?\.\s*The question is ([^.!?]+)\./gi, 'The question is $1.'],
  [/\bYou don't need [^.!?]+?\.\s*You need ([^.!?]+)\./gi, 'You need $1.'],
  [/\bNo [a-z ]{1,20}, no [a-z ]{1,20}, just ([^.!?]+)\./gi, 'Just $1.'],
  [/\bStop thinking [^.!?]+?\.\s*Start thinking ([^.!?]+)\./gi, 'Start thinking $1.'],
  [/\b[^.!?]{1,40}\bis dead\.?\s*(?:It|Y) is the future\.?/gi, '$1 is the future.'],
  [/\b[^.!?]{1,40}\bis overrated\.?\s*\w+ is what matters\.?/gi, '$1 is what matters.'],
  [/\bX\?\s*No\.\s*([^.!?]+)\./g, '$1.'],
  [/\b(?:Sure|Certainly),?\s+[^.!?]+?\s+works\.?\s*But\s+([^.!?]+)/gi, 'But $1'],
  [/\b([^.!?]{1,50}) gets all the (?:attention|credit), but ([^.!?]+)\./gi,
    (_, lead, claim) => claim.charAt(0).toUpperCase() + claim.slice(1) + '.'],
];

/**
 * Parse the §3A dead-vocabulary list out of voice-dna.md.
 *
 * Split out from the file I/O so the parser — the part that actually broke —
 * is directly testable. The character class must admit hyphens: the list is
 * dominated by them (cutting-edge, data-driven, state-of-the-art, game-changer,
 * paradigm-shifting, plug-and-play, future-proof, leading-edge, mission-critical).
 * A class without `-` matches no line, the lazy scan walks to the end of the
 * file, and the layer reports a clean run having enforced nothing.
 *
 * @returns {{ words: string[], error: string|null }}
 */
export function parseBannedWords(text) {
  const section = text.match(/###\s*3A\.\s*Dead AI vocabulary/i);
  if (!section) {
    return {
      words: [],
      error: 'voice-dna.md has no "### 3A. Dead AI vocabulary" section — nothing to enforce. '
        + 'Restore the section or the dead-vocabulary layer stays inert.',
    };
  }
  const m = text.match(/###\s*3A\.\s*Dead AI vocabulary[\s\S]*?^([a-z0-9, \/()\-]+)$/im);
  if (!m) {
    return {
      words: [],
      error: 'voice-dna.md section "3A. Dead AI vocabulary" holds no single-line comma list. '
        + 'The parser expects one lowercase, comma-separated line; the layer cannot load it.',
    };
  }
  const words = m[1]
    .split(',')
    .map((w) => w.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase())
    .filter((w) => w.length > 2);
  if (!words.length) {
    return { words: [], error: 'voice-dna.md section "3A. Dead AI vocabulary" parsed to zero words.' };
  }
  return { words, error: null };
}

let cachedBanned = null;
function loadBannedWords() {
  if (cachedBanned) return cachedBanned;
  const path = join(ROOT, 'voice-dna.md');
  if (!existsSync(path)) {
    cachedBanned = {
      words: [],
      error: 'voice-dna.md not found — the dead-vocabulary layer is disabled. '
        + 'Copy the template; a CV with no voice profile cannot be checked against one.',
    };
    return cachedBanned;
  }
  cachedBanned = parseBannedWords(readFileSync(path, 'utf-8'));
  return cachedBanned;
}

/** Escape a banned word for use in a RegExp source, keeping `-` literal inside classes. */
function wordPattern(word) {
  return word
    .split('/')
    .map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '\\-'))
    .join('|');
}

function finding(rule, label, severity, match, where, text) {
  return { rule, label, severity, match, where, text: text.slice(0, 160) };
}

/**
 * Apply only the safe, registered rewrites; hand everything else to the caller
 * as a finding. Never deletes a word — see the module header.
 */
function replaceBannedWords(text, where, findings, changes) {
  let out = text;
  for (const [bad, good] of WORD_REPLACEMENTS) {
    const re = new RegExp(`\\b${wordPattern(bad)}\\b`, 'gi');
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      const rep = m[0] === m[0].toUpperCase() ? good[0].toUpperCase() + good.slice(1) : good;
      changes.push(`swapped "${m}" → "${rep}" (${where})`);
      return rep;
    });
  }
  const { words, error } = loadBannedWords();
  if (error) {
    findings.push(finding('3A', error, 'high', 'voice-dna.md', where, text));
    return out;
  }
  const alreadyHandled = new Set([...WORD_REPLACEMENTS.keys()].map((w) => w.toLowerCase()));
  for (const word of words) {
    if (alreadyHandled.has(word)) continue;
    const re = new RegExp(`\\b${wordPattern(word)}\\b`, 'gi');
    const hit = out.match(re);
    if (!hit) continue;
    findings.push(finding('3A', `dead AI vocabulary: "${hit[0]}"`, 'high', hit[0], where, out));
  }
  return out;
}

function normalizeDashes(text) {
  return text
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    // Two or more hyphens is a markdown/typographic artefact, not a separator.
    .replace(/-{2,}/g, '-');
}

function fixPhrases(text, changes) {
  let out = text;
  for (const [re, rep] of PHRASE_REPLACEMENTS) {
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, rep);
      changes.push(`removed dead phrase (${re.source.slice(0, 40)})`);
    }
  }
  out = normalizeDashes(out);
  for (const [re, rep] of NEGATIVE_PARALLEL_RE) {
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, rep);
      changes.push(`collapsed negative parallelism → "${rep}"`);
    }
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

/**
 * Report-only structural checks for one prose string.
 *
 * Severity is context-dependent, because the same shape is a strong tell in
 * one place and correct practice in another:
 *
 *   - A three-slot headline is the AI default, and five lanes sharing that
 *     skeleton is a stronger tell still. A three-item list inside a bullet is
 *     ordinary professional writing — "architecture, integration, and
 *     validation" is what the job actually involved.
 *   - Title case in a headline is §4K's exact target. In a bullet it is almost
 *     always a product name ("Donor Engagement Portal", "Network Modelling
 *     Tool"), which must keep its capitals, and in a competency list it is
 *     standard CV formatting. Checking it there produces false positives on
 *     correct text, which is how a linter trains people to ignore it.
 *
 * @param {string} text
 * @param {string} where — dotted field path, so a finding is actionable
 * @param {object[]} findings
 * @param {string} field — the leaf key the string sat under
 */
export function lintString(text, where, findings, field = '') {
  if (!text || typeof text !== 'string') return;
  const headlineish = field === 'headline' || field === 'summary';
  const inBullet = /\.bullets\[/.test(where);
  for (const rule of LINT_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    let severity = rule.severity;
    if (rule.id === '4B' && !headlineish) severity = 'low';
    if (rule.id === '4K' && !headlineish) continue;
    findings.push(finding(rule.id, rule.label, severity, m[0].trim(), where, text));
  }
  if (inBullet) return;
  // §4I — metronome rhythm. AI paces every sentence identically; flag only a
  // sustained run, so ordinary short-and-long prose is not punished. Judged on
  // coefficient of variation rather than a percentage band, because at 4-5
  // words per sentence a single word is already 25% and any band either
  // misses the tell or fires on normal writing.
  const sentences = text.split(/[.!?]+/).map((s) => s.trim().split(/\s+/).filter(Boolean)).filter((s) => s.length >= 3);
  if (sentences.length >= 5) {
    const lens = sentences.map((s) => s.length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, l) => a + (l - mean) ** 2, 0) / lens.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < 0.15) {
      findings.push(finding('4I', 'metronome rhythm (every sentence the same length)', 'medium',
        `${sentences.length} sentences, variation ${cv.toFixed(2)}`, where, text));
    }
  }
  // §4K — title case runs, only where it is a tell (headline / summary).
  if (!headlineish) return;
  const run = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,})\b/g) || [];
  for (const r of run) {
    const words = r.toLowerCase().split(/\s+/);
    if (words.every((w) => HEADER_ALLOWLIST.has(w))) continue;
    findings.push(finding('4K', 'title case in prose (humans use sentence case)', 'medium', r, where, text));
  }
}

/** Humanize one prose string (summary, bullet, competency). */
export function humanizeText(text, where = 'text', findings = [], changes = [], field = '') {
  if (!text || typeof text !== 'string') return text;
  let out = fixPhrases(text, changes);
  out = replaceBannedWords(out, where || 'text', findings, changes);
  out = fixPhrases(out, changes);
  lintString(out, where || 'text', findings, field);
  return out;
}

/**
 * Fields exempt from banned-word replacement and linting: employer names,
 * contact details, labels. "Synergy Teletech Pvt Ltd" is a company, not an
 * AI tic, and rewriting it would be a factual error.
 */
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
  'lang',
  'page_format',
  'link',
  'label',
]);

/**
 * Fields that skip the banned-word pass but still get typographic cleanup.
 *
 * `dates` is the case that matters: "Nov 2025 -- Present" holds no AI
 * vocabulary at all, so exempting it cost nothing — until the double hyphen
 * rendered as a typo on every printed CV. Dash normalisation carries no
 * semantic risk, so it is not subject to the same exemption. The same applies
 * to education `year` / `org` ranges and to `role` / `location`, which use
 * "--" as a plain separator.
 *
 * Deliberately excludes url/email/phone/name/display/link: collapsing "--"
 * inside a URL or an address would corrupt it, and the rest are verbatim.
 */
const DASH_SAFE_KEYS = new Set(['dates', 'period', 'year', 'org', 'role', 'location']);

function humanizeStringFields(obj, findings, changes, key = '', where = '') {
  if (typeof obj === 'string') {
    if (STRUCTURAL_KEYS.has(key)) {
      // Still typographically normalised — see DASH_SAFE_KEYS. A date range
      // holds no AI vocabulary, so the word-swap exemption should not also
      // waive a hyphen fix that has no semantic risk.
      return DASH_SAFE_KEYS.has(key) ? normalizeDashes(obj) : obj;
    }
    return humanizeText(obj, where || key, findings, changes, key);
  }
  if (Array.isArray(obj)) {
    return obj.map((v, i) => humanizeStringFields(v, findings, changes, key, `${where}[${i}]`));
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = humanizeStringFields(v, findings, changes, k, where ? `${where}.${k}` : k);
    }
    return out;
  }
  return obj;
}

/**
 * @param {object} payload — CV JSON (modes/pdf.md schema)
 * @returns {{ payload: object, changes: string[], findings: object[] }}
 */
export function humanizeCvPayload(payload) {
  const changes = [];
  const findings = [];
  const before = JSON.stringify(payload);
  const out = humanizeStringFields(payload, findings, changes);

  // varyBulletStarters only. The generic walk above has already humanized and
  // linted these strings — re-running humanizeText here reported every bullet
  // finding twice, under two different paths.
  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((job) => {
      if (!Array.isArray(job.bullets)) return job;
      return { ...job, bullets: varyBulletStarters(job.bullets) };
    });
  }
  if (Array.isArray(out.projects)) {
    out.projects = out.projects.map((p) => ({
      ...p,
      bullets: Array.isArray(p.bullets) ? varyBulletStarters(p.bullets) : p.bullets,
    }));
  }
  if (out.summary) out.summary = humanizeText(out.summary, 'summary', findings, changes, 'summary');

  // §4B applied to the headline as a structure rather than a word: every lane
  // landing on exactly three pipe-separated slots is the AI default, and five
  // lanes sharing one skeleton is a stronger tell than any single phrase.
  if (typeof out.headline === 'string') {
    const slots = out.headline.split('|').map((s) => s.trim()).filter(Boolean);
    if (slots.length === 3) {
      findings.push(finding('4B', 'headline is a rule-of-three triple (use 2 or 4)', 'medium',
        out.headline, 'headline', out.headline));
    }
  }

  if (JSON.stringify(out) !== before && !changes.length) {
    changes.push('humanized prose (banned-word swap, phrase trim, bullet variety)');
  }
  return { payload: out, changes, findings };
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
 * @returns {{ payload: object, changes: string[], findings: object[] }}
 */
export function humanizeCoverPayload(payload) {
  const changes = [];
  const findings = [];
  const out = { ...payload };
  if (out.letter) {
    out.letter = { ...out.letter };
    for (const key of COVER_LETTER_PROSE_KEYS) {
      if (typeof out.letter[key] === 'string') {
        out.letter[key] = humanizeText(out.letter[key], `letter.${key}`, findings, changes);
      }
    }
  }
  return { payload: out, changes, findings };
}

function selfTest() {
  let failures = 0;
  const ok = (label, cond) => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}`);
    if (!cond) failures++;
  };

  // The §3A parser is the part that shipped inert. Pin the real file's shape,
  // including the hyphenated entries that a naive character class cannot match.
  const fixture = [
    '### 3A. Dead AI vocabulary',
    '',
    'Prose that must be skipped, with commas, and words, and more prose.',
    '',
    'delve, cutting-edge, data-driven, state-of-the-art, align, intricate/intricacies, robust',
  ].join('\n');
  const parsed = parseBannedWords(fixture);
  ok('3A parser loads the list', parsed.error === null && parsed.words.length === 7);
  ok('3A parser keeps hyphens', parsed.words.includes('cutting-edge') && parsed.words.includes('state-of-the-art'));
  ok('3A parser handles slash alternatives', parsed.words.includes('intricate/intricacies'));
  ok('3A parser does not swallow surrounding prose', !parsed.words.some((w) => w.includes('prose')));
  ok('3A parser reports a missing section', parseBannedWords('## 3. BANNED LIST').error !== null);
  ok('3A parser reports an unparseable section',
    parseBannedWords('### 3A. Dead AI vocabulary\n\nNo comma list on its own line.').error !== null);

  const { words: live, error: liveErr } = loadBannedWords();
  ok('live voice-dna.md loads', liveErr === null && live.length > 40);

  ok('leverage→use', humanizeText('Leverage LLM agents to streamline delivery') === 'Use LLM agents to simplify delivery');
  ok('strips furthermore', !/furthermore/i.test(humanizeText('Furthermore, led the portal build.')));
  ok('negative parallelism', !/isn't/i.test(humanizeText("This isn't a side project. This is production work.")));

  // The destructive behaviour the split exists to prevent.
  const holey = humanizeText('We align with the vibrant, dynamic landscape of delivery.');
  ok('never deletes a banned word', !/\s{2,}/.test(holey) && /align|vibrant|dynamic|landscape/.test(holey));
  const noisy = [];
  humanizeText('We align with the vibrant, dynamic landscape of delivery.', 'x', noisy);
  ok('reports unreplaced banned words instead', noisy.some((f) => f.rule === '3A' && f.severity === 'high'));

  ok('collapses double hyphen', humanizeText('Nov 2025 -- Present') === 'Nov 2025 - Present');
  ok('collapses hyphen run', humanizeText('May -- Oct 2025') === 'May - Oct 2025');
  ok('normalises em dash', humanizeText('a — b') === 'a - b');
  ok('dates field still gets dash cleanup', humanizeCvPayload({
    experience: [{ company: 'Acme', role: 'PM', dates: 'Nov 2025 -- Present', bullets: ['Did things.'] }],
  }).payload.experience[0].dates === 'Nov 2025 - Present');
  ok('url is not dash-mangled', humanizeCvPayload({
    candidate: { name: 'A', url: 'https://x.dev/a--b' },
  }).payload.candidate.url === 'https://x.dev/a--b');
  ok('education year range gets dash cleanup', humanizeCvPayload({
    education: [{ org: 'Some University -- formerly Other College', year: '2020 -- 2022' }],
  }).payload.education[0].year === '2020 - 2022');

  // The auto-fixer owns the shapes it can rewrite safely, so the linter is
  // only ever asked about the ones it cannot — hence the "sneaky versions"
  // from §3F rather than the plain constructions.
  const f = (text) => { const s = []; lintString(text, 'probe', s, 'summary'); return s; };
  const fires = (text, rule, field = 'summary') => {
    const s = [];
    lintString(text, 'probe', s, field);
    return s.some((x) => x.rule === rule);
  };

  ok('auto-fixes plain negative parallelism',
    !/not only/i.test(humanizeText('Not only did it scale, but also it shipped.')));
  ok('auto-fixes "less X more Y"',
    !/less tooling/i.test(humanizeText('Less tooling, more delivery.')));
  ok('lints unfixable negative parallelism', fires(
    'While this might seem right, growth is actually the real answer', '3F'));
  ok('auto-fixes "gets all the attention" pivot without dropping the predicate',
    humanizeText('The logo gets all the attention, but delivery is what actually matters.')
      === 'Delivery is what actually matters.');
  ok('lints rule of three', fires('speed, efficiency, and innovation', '4B'));
  ok('lints puffery', fires('a pivotal milestone in our journey', '4A'));
  ok('lints participle padding', fires('Shipped the portal, highlighting its importance', '4F'));
  ok('lints chat leakage', fires('I hope this helps!', '4H'));
  ok('lints false range', fires('From ancient traditions to modern innovations', '4C'));
  ok('lints engagement bait', fires("You're not ready for this", '3D'));
  ok('lints metronome rhythm', fires(
    'The team shipped it. The client signed off. We built the router. They paid the invoice. Sales grew steady.',
    '4I'));
  ok('metronome does not fire on varied prose', !fires(
    'Shipped the router. Cut client release cycles by a quarter. Then ran the ops for two ventures on spreadsheets, WhatsApp groups and cold confirmations.',
    '4I'));
  ok('title case flagged in headline', fires('Global Context Critical Mineral Demand', '4K', 'headline'));
  ok('title case not flagged in a bullet (product name)', !fires('Shipped the Network Modelling Tool', '4K', 'bullets'));
  ok('title case not flagged in a competency label', !fires('Product Lifecycle Ownership', '4K', 'competencies'));
  ok('title case allowed for acronyms', !fires('Built on IBM and GxP rules', '4K', 'headline'));

  const triple = [];
  humanizeCvPayload({ headline: 'Product | Delivery | AI' }).findings.forEach((f) => triple.push(f));
  ok('headline rule of three flagged', triple.some((f) => f.rule === '4B' && f.where === 'headline'));
  const two = humanizeCvPayload({ headline: 'Product | Delivery' }).findings;
  ok('two-slot headline not flagged', !two.some((f) => f.where === 'headline'));

  ok('company name safe', humanizeCvPayload({
    experience: [{ company: 'Synergy Teletech Pvt Ltd', role: 'Field Executive', bullets: ['Led IoT.'] }],
  }).payload.experience[0].company.includes('Synergy'));

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.error('Usage: node cv-humanize.mjs --self-test');
    process.exit(1);
  }
}
