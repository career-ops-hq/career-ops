// @ts-check
/**
 * jd-years.mjs — the years of experience a job description asks for, and
 * whether that is within reach of the candidate (#6153).
 *
 * Titles say little about this. "Lead" roles ask for four years and plain
 * "Analyst" roles ask for ten, so skip_tiers (classify-tier.mjs, which reads
 * the title) cannot answer it. The number is in the JD body, and this module
 * reads it there: rules only, no LLM, so the scanner stays zero-token.
 *
 * Nothing is dropped unless `action: drop` is set; by default an out-of-band
 * posting is kept and marked `above band`. With `drop` on, the one rule
 * everything below serves: a posting is dropped only when the JD
 * states a clear overall requirement and even its lowest reading is out of
 * reach. Everything else (no statement, a preferred-only or skill-only figure,
 * bars that disagree, a JD that could not be read) is kept and labelled. A
 * wrong drop costs the user a real job they never see; a wrong keep costs a
 * glance at one pipeline row.
 *
 * The parse, per sentence:
 *   1. Find each "N years" mention: digits or spelled out ("five (5)"), "N+",
 *      "N or more", "at least N", ranges ("3-5", "between 3 and 5"), months.
 *   2. Keep only mentions about the candidate's experience: the words after
 *      "years" must read as experience ("of", "in", "experience", "working",
 *      ...), and the sentence must not be about age, tenure, contracts,
 *      vesting, degree length ("4-year degree") or the company's own history.
 *   3. Tag each one:
 *      - kind: required / preferred, from the nearest cue in the sentence
 *        ("preferred", "nice to have", "a plus" / "required", "minimum",
 *        "must"), else from the section heading above it.
 *      - scope: overall / skill ("3 years of experience with SQL") /
 *        degree-substitute ("a degree or 4 years of equivalent experience",
 *        which binds only candidates without the degree) / sub ("7 years,
 *        including 2 managing people").
 *      - degreeAlt: one of several degree-conditional bars in one sentence
 *        ("7 with a BS or 5 with an MS").
 *   4. The gating figure is the LOWEST floor among required overall mentions,
 *      the most lenient honest reading. Several bars that differ ("5+ years
 *      of software", "2+ years leading a team") are all required, so the real
 *      bar is at least the highest; gating on the lowest means a drop happens
 *      only when every one of them is out of reach. A bar with an
 *      "equivalent combination" route, or read from a listing description
 *      rather than the full JD, is shown but never drops.
 */

import {
  jdHtmlToText,
  fetchJdViaKnownApi,
  normalizeAshbyJob,
  normalizeGreenhouseJob,
  normalizeLeverJob,
  normalizeSmartRecruitersJob,
  normalizeWorkdayJob,
} from './browser-extract.mjs';
import { resolveAtsApi, JD_TEXT_API_ATS, throttleProviderRequest } from './liveness-api.mjs';
import { fetchJsonWithRetry, makeHttpCtx } from './providers/_http.mjs';

/**
 * @typedef {Object} YearsMention
 * @property {number} floor        Lowest figure ("3" in "3-5 years")
 * @property {number|null} ceiling Upper bound of a range, null for "N+"
 * @property {'required'|'preferred'|'unclear'} kind   unclear: under a heading the parser does not know
 * @property {'overall'|'skill'|'degree-substitute'|'sub'} scope
 * @property {boolean} degreeAlt  One of several degree-conditional bars
 * @property {boolean} [alternative] The JD offers another way to meet it
 *   ("or an equivalent combination of education and experience")
 * @property {string} quote       The sentence it came from (trimmed)
 */

/**
 * @typedef {Object} YearsRequirement
 * @property {'stated'|'preferred-only'|'skill-only'|'none'} status
 *   stated: the JD names a required overall bar; the others carry no gate.
 * @property {number|null} min      Gating floor (lowest required overall floor)
 * @property {number|null} max      Upper bound when that bar is a range
 * @property {boolean} confident    The lowest bar found is a hard bar: the text was the whole
 *   JD and offers no "equivalent combination" route around it
 * @property {string} display       Compact form for the pipeline row
 * @property {YearsMention[]} mentions
 */

const WORD_NUMBERS = /** @type {Record<string, number>} */ ({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
});
const NUM = `(?:\\d{1,2}(?:\\.\\d)?|${Object.keys(WORD_NUMBERS).join('|')})`;
// "five (5)" — a spelled number restated in digits.
const RESTATED = `(?:\\s*\\(\\s*\\d{1,2}\\s*\\+?\\s*\\))?`;
const PLUS = `(?:\\s*\\+|[\\s-]*plus\\b)?`;
const OR_MORE = `(?:\\s+or\\s+(?:more|greater|longer))?`;

const MENTION_RE = new RegExp(
  `\\b(between\\s+)?(${NUM})${RESTATED}${PLUS}${OR_MORE}`
  + `(?:\\s*(?:-|–|—|to|and)\\s*(${NUM})${RESTATED}${PLUS})?`
  + `[\\s-]*(years?|yrs?|months?)\\b`,
  'gi',
);
// "a year of experience", "one full year". Only with experience named right
// after it: "$100K a year, depending on experience" is pay, not a bar.
const SINGLE_YEAR_RE = /\b(?:a|an|one)\s+(?:full\s+)?year\b/gi;
const SINGLE_YEAR_TRAIL = /^(?:'s|')?(?:\s+(?:of\s+)?(?:[\w/&-]+\s+){0,3}?(?:experience|exp)\b|\s+(?:in|as|working|managing|leading)\b)/i;

// What may follow "years" for the mention to be about experience.
// A dash counts only when spaced ("5+ years - required"): "a year-long
// program" and "3-year plan" are not about the candidate.
const EXPERIENCE_TRAIL = /^(?:\s+[-—–]|(?:'s|')?\s*(?:\+\s*)?(?:of\b|in\b|as\b|at\b|on\b|within\b|across\b|working|leading|managing|building|doing|designing|developing|running|owning|delivering|supporting|selling|practicing|practising|teaching|serving|consulting|operating|(?:[\w/&-]+\s+){1,3}(?:experience|exp)\b|experience|exp\b|professional|relevant|related|direct|hands|industry|work\b|progressive|combined|total|post|full[- ]time|practical|prior|previous|demonstrated|proven|minimum|min\b|or more|or greater|or longer|plus\b|\(|\)|,|;|:|\.|$|and\b|with\b|using\b|required|preferred))/i;
// "years of X" where X makes it not about work experience.
const NON_EXPERIENCE_OF = /^(?:'s|')?\s*of\s+(?:age|college|university|school|schooling|education|study|studies|service|history|data|operations?|growth|existence|tenure|employment with us)\b/i;
// Words right before the number that make it a time window, not a requirement.
const WINDOW_LEAD = /\b(?:within|after|every|per|ago|the (?:first|next|last|past)|(?:first|next|last|past)|in the|for the|over the|up to the|aged?|age of)\s*$/i;
// A ceiling, not a floor: "up to 10 years", "less than 8 years", "6 years
// or less", "5 years maximum". Never a minimum, so never a bar.
const CEILING_LEAD = /\b(?:up to|less than|fewer than|no more than|not more than|under|at most|maximum of|max(?:imum)?\.?)\s*$/i;
const CEILING_TRAIL = /^(?:'s|')?\s*(?:\+\s*)?(?:of\s+)?(?:[\w/&-]+\s+){0,4}?(?:experience\s+)?(?:or (?:less|fewer|under)|maximum|max\b|at most|at the most)/i;
// Sentences about something other than the candidate's experience.
const NOT_A_REQUIREMENT = /\b(?:year[- ]over[- ]year|years? old|years? of age|ago\b|founded|anniversary|in business|vest(?:s|ed|ing)?\b|contract (?:term|length|duration)|fixed[- ]term|warranty|retention bonus|sabbatical|parental leave|commitment of|\d+[- ]year (?:degree|program|programme|course|plan|contract|term|appointment)|(?:four|two|three)[- ]year (?:degree|college|university|program))/i;
// Company voice ("our team has 50 years of combined experience") with no
// candidate-facing word in the sentence. Case-sensitive "us", so "a US
// multinational" is not read as the company speaking.
// Someone else's experience: "work alongside engineers with 10+ years",
// "learn from mentors who have 15 years". Skipping it can only keep a row.
const THIRD_PARTY_LEAD = /\b(?:engineers|experts|colleagues|peers|leaders|mentors|teammates|team members|veterans|specialists|founders|partners|advisors|people)\s+(?:with|who have|who bring|having)\s+(?:over\s+|more than\s+|a combined\s+|decades and\s+)?$/i;
const THIRD_PARTY_SENTENCE = /\b(?:alongside|learn from|mentored by|surrounded by|led by)\b/i;
// A team's average ("a team that averages 12 years"), or the people the role
// manages, serves or hires ("manage analysts with 5-8 years", "hiring
// candidates with 10+ years"): their experience, not the candidate's.
const THIRD_PARTY_AVERAGE = /\baverag(?:e|es|ing)\s+(?:of\s+)?(?:over\s+|more than\s+)?$/i;
const THIRD_PARTY_OBJECT = /\b(?:manag\w*|lead|leading|supervis\w*|support\w*|serv(?:e|es|ing)|coach\w*|mentor(?:s|ing)?|hir(?:e|es|ing)|recruit\w*|sourc(?:e|es|ing)|interview\w*|team of|group of)\b[^.;]{0,50}\b[a-z]+s\s+with\s+(?:over\s+|more than\s+)?$/i;
const COMPANY_VOICE = /\b(?:[Ww]e|[Ww]e've|[Ww]e're|[Oo]ur|us)\b/;
const CANDIDATE_HAS = /\byou(?:'ve| have| bring| possess|'ll (?:need|have|bring)| will (?:need|have|bring)| should have| must have)\b/i;
const CANDIDATE_VOICE = /\b(?:you|your|candidate|applicant|required|requirements?|minimum|must|should|ideal(?:ly)?|qualif\w*|looking for|seeking|need)\b/i;

const PREFERRED_CUE = /\b(?:prefer(?:red|ably|ence)?|nice[- ]to[- ]have|bonus|a (?:big |huge |strong )?plus|is a plus|are a plus|ideally|desired|desirable|advantageous|would be (?:great|nice|helpful|ideal)|is helpful|not required|extra credit|stand out)\b/gi;
const TRAILING_PREFERRED = /\b(?:preferred|desired|desirable|a (?:big |huge |strong )?plus|nice[- ]to[- ]have|helpful|advantageous)\W*$/i;
const REQUIRED_CUE = /\b(?:require[ds]?|requirements?|minimum|must|at least|basic qualifications?|mandatory|essential|need(?:ed|s)?)\b/gi;

const DEGREE_WORD = /\b(?:degree|bachelor'?s?|master'?s?|mba|ph\.?\s?d|doctorate|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|bsc|msc|undergraduate|graduate|advanced degree|diploma)\b/i;
const DEGREE_SUBSTITUTE_AFTER = /^[^.;]{0,50}\b(?:in lieu of|instead of|in place of|as a substitute|equivalent to a degree|without a degree)/i;
const DEGREE_SUBSTITUTE_OWN = /^(?:'s|')?\s*(?:of\s+)?(?:\w+\s+){0,2}?equivalent\b/i;
const DEGREE_OR_BEFORE = /\b(?:degree|bachelor'?s?|diploma|b\.?s\.?|b\.?a\.?|bsc)\b[^.;]{0,40}\bor\s+(?:an?\s+)?(?:equivalent\s+)?(?:combination\s+of\s+)?(?:at least\s+|a minimum of\s+|minimum of\s+)?$/i;
const SUB_LEAD = /\b(?:including|incl\.?|of which|of those|of this|within that|with at least|out of which)\s*(?:at least\s+|a minimum of\s+)?$/i;
// "with a Bachelor's" names the degree the bar goes with, not a skill.
const DEGREE_TRAIL = /^(?:'s|')?\s*(?:\+\s*)?(?:of\s+(?:\w+\s+){0,2}?)?(?:experience\s+)?(?:with|and|plus|\+)\s+(?:an?\s+|the\s+)?(?:relevant\s+|related\s+)?(?:degree|bachelor|master|mba|ph\.?\s?d|doctorate|b\.?s\b|b\.?a\b|m\.?s\b|m\.?a\b|bsc|msc|advanced|graduate|undergraduate)/i;
const SKILL_TRAIL = /^(?:'s|')?\s*(?:\+\s*)?(?:of\s+)?(?:(?:hands[- ]on|direct|professional|practical|relevant|production|commercial)\s+)?(?:experience\s+)?(?:with|using|programming|coding|writing|scripting)\b/i;

// "or an equivalent combination of education and experience": the bar can
// be met another way, so it is shown but never drops on its own.
const EQUIVALENT_COMBINATION = /\bequivalent combination\b|\bor (?:an? )?equivalent (?:amount|level|mix) of\b|\bcombination of (?:education|training) and (?:work )?experience\b/i;

const NO_EXPERIENCE_RE = /\bno (?:prior |previous )?(?:work |professional |industry )?experience (?:is )?(?:required|necessary|needed)\b/i;

// Heading shapes: short, no year figure, and a recognisable section name.
const PREFERRED_HEADING = /\b(?:prefer|nice[- ]to[- ]have|good[- ]to[- ]have|great[- ]to[- ]have|bonus|desir|plus|ideal|extra credit|stand out|even better|would be (?:great|nice)|great if|added advantage|differentiat|love to see|also have)/i;
const REQUIRED_HEADING = /\b(?:require|minimum|basic|must|qualif|what you(?:'ll)? (?:need|bring)|you (?:have|bring)|looking for|about you|who you are|experience|skills)/i;

/** @param {string} raw */
function toNumber(raw) {
  const key = raw.toLowerCase();
  return key in WORD_NUMBERS ? WORD_NUMBERS[key] : Number(raw);
}

/**
 * Plain text for parsing. Provider descriptions arrive as HTML, ATS JD
 * normalizers already return text; both end up as lines.
 * @param {string} input
 */
function toLines(input) {
  const raw = String(input ?? '');
  // [^<>]: '<a<a<a…' fails each start at once instead of scanning to the end.
  const text = /<[a-z!/][^<>]*>/i.test(raw) ? jdHtmlToText(raw) : raw;
  // Runs of spaces collapse first: the sentence split is quadratic on them.
  return text.replace(/[’‘]/g, "'").replace(/[^\S\r\n]+/g, ' ').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

/**
 * Sentence split that leaves abbreviations ("B.S.", "e.g.", "U.S.") whole:
 * a break needs two word characters before the stop.
 * @param {string} line
 */
function sentences(line) {
  return line.split(/(?<=[a-z0-9)]{2}[.!?])\s+(?=[A-Z("])|;\s+|\s+[•·]\s+/).map(s => s.trim()).filter(Boolean);
}

/** @param {string} line */
function headingKind(line) {
  // "Preferred Qualifications (any 2 of the following)": the parenthetical
  // is an aside, not a figure.
  const bare = line.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  // A lead-in line that introduces a preferred list, however long ("It would
  // be great if you also have the following things").
  if (bare.length <= 120 && !/\d/.test(bare) && PREFERRED_HEADING.test(bare) && /(?::|\bfollowing\b[\w\s]*)$/i.test(bare)) return 'preferred';
  if (bare.length > 60 || /\d/.test(bare)) return null;
  const words = bare.split(/\s+/).length;
  if (!/:$/.test(bare) && (words > 6 || /[.!?]$/.test(bare))) return null;
  // A digit only inside a parenthetical is allowed for a heading that names
  // its section; "Ability to travel (50%+)" is a bullet, not a heading.
  const known = PREFERRED_HEADING.test(bare) ? 'preferred'
    // "Additional Qualifications" may be required or preferred: unclear.
    : REQUIRED_HEADING.test(bare) && !/^additional\b/i.test(bare) ? 'required' : null;
  if (/\d/.test(line) && !known) return null;
  return known ?? 'other';
}

/**
 * Required or preferred, from the cue nearest the mention: the last cue
 * before it, else the first after it, else the section default.
 * @param {string} sentence
 * @param {number} at
 * @param {'required'|'preferred'|'unclear'} fallback
 * @returns {'required'|'preferred'|'unclear'}
 */
function mentionKind(sentence, at, fallback) {
  // A sentence that ends on the cue ("Minimum of 2 years ... preferred")
  // qualifies the whole of itself, whatever word opened it.
  if (TRAILING_PREFERRED.test(sentence)) return 'preferred';
  /** @type {{pos: number, kind: 'required'|'preferred'}[]} */
  const cues = [];
  for (const m of sentence.matchAll(PREFERRED_CUE)) cues.push({ pos: m.index ?? 0, kind: 'preferred' });
  for (const m of sentence.matchAll(REQUIRED_CUE)) cues.push({ pos: m.index ?? 0, kind: 'required' });
  if (cues.length === 0) {
    // Under a heading the parser does not know ("About the role",
    // "Responsibilities"), only a sentence addressed to the candidate is a bar.
    if (fallback === 'unclear') return CANDIDATE_HAS.test(sentence) ? 'required' : 'unclear';
    return fallback;
  }
  const before = cues.filter(c => c.pos < at).sort((a, b) => b.pos - a.pos)[0];
  if (before) return before.kind;
  return cues.sort((a, b) => a.pos - b.pos)[0].kind;
}

/**
 * Every experience mention in one sentence.
 * @param {string} sentence
 * @param {'required'|'preferred'|'unclear'} sectionKind
 * @returns {YearsMention[]}
 */
function mentionsIn(sentence, sectionKind) {
  if (NOT_A_REQUIREMENT.test(sentence)) return [];
  if (COMPANY_VOICE.test(sentence) && !CANDIDATE_VOICE.test(sentence)) return [];
  if (THIRD_PARTY_SENTENCE.test(sentence)) return [];

  /** @type {Array<YearsMention & {at: number, end: number}>} */
  const found = [];
  const consider = (/** @type {number} */ at, /** @type {number} */ end, /** @type {number} */ floor, /** @type {number|null} */ ceiling, /** @type {string} */ unit) => {
    const lead = sentence.slice(Math.max(0, at - 40), at);
    const trail = sentence.slice(end);
    if (WINDOW_LEAD.test(lead) || THIRD_PARTY_LEAD.test(lead) || THIRD_PARTY_AVERAGE.test(lead) || THIRD_PARTY_OBJECT.test(lead)) return;
    if (CEILING_LEAD.test(lead) || CEILING_TRAIL.test(trail)) return;
    if (NON_EXPERIENCE_OF.test(trail)) return;
    const months = /^mo/i.test(unit);
    if (months && !/^(?:'s|')?\s*(?:of\s+)?(?:\w+\s+){0,3}?experience\b/i.test(trail)) return;
    if (!EXPERIENCE_TRAIL.test(trail)) return;
    // Bare "N years." needs experience named nearby ("Experience: 5+ years").
    if (/^(?:'s|')?\s*(?:[,;:.)]|$)/.test(trail) && !/\bexp(?:erience)?\b/i.test(sentence)) return;
    const scale = months ? 1 / 12 : 1;
    const lo = Math.round(floor * scale * 10) / 10;
    const hi = ceiling === null ? null : Math.round(ceiling * scale * 10) / 10;
    if (lo > 20) return; // company history, not a hiring bar
    let scope = /** @type {YearsMention['scope']} */ ('overall');
    // "a degree or 4 years" is a substitute only when no earlier bar in the
    // sentence owns that degree; "10 years with a BS, or 8 with an MS" is a
    // list of alternatives, not a substitute.
    const substitute = (DEGREE_OR_BEFORE.test(lead) && found.length === 0)
      || DEGREE_SUBSTITUTE_AFTER.test(trail) || DEGREE_SUBSTITUTE_OWN.test(trail);
    if (substitute) {
      scope = 'degree-substitute';
    } else if (SKILL_TRAIL.test(trail) && !DEGREE_TRAIL.test(trail)) {
      scope = 'skill';
    } else if (SUB_LEAD.test(lead) && found.some(f => f.scope === 'overall')) {
      scope = 'sub';
    }
    found.push({
      floor: lo,
      ceiling: hi !== null && hi > lo ? hi : null,
      kind: mentionKind(sentence, at, sectionKind),
      scope,
      degreeAlt: false,
      quote: sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence,
      at,
      end,
    });
  };

  for (const m of sentence.matchAll(MENTION_RE)) {
    const [whole, between, a, b, unit] = m;
    const at = m.index ?? 0;
    // "and" joins a range only after "between"; otherwise "3 and 5 years" is two bars.
    const joiner = b ? whole.slice(whole.search(/(?:-|–|—|to|and)\s*/i)).match(/^(-|–|—|to|and)/i)?.[1] : null;
    if (b && joiner?.toLowerCase() === 'and' && !between) {
      consider(at + whole.length - (unit.length), at + whole.length, toNumber(b), null, unit);
      continue;
    }
    consider(at, at + whole.length, toNumber(a), b ? toNumber(b) : null, unit);
  }
  for (const m of sentence.matchAll(SINGLE_YEAR_RE)) {
    const at = m.index ?? 0;
    if (found.some(f => at >= f.at && at < f.end)) continue;
    if (!SINGLE_YEAR_TRAIL.test(sentence.slice(at + m[0].length))) continue;
    consider(at, at + m[0].length, 1, null, 'year');
  }

  // Degree-conditional alternatives: two or more overall bars in one sentence,
  // each with a degree named beside it.
  const overall = found.filter(f => f.scope === 'overall');
  if (overall.length >= 2) {
    const withDegree = overall.filter(f => DEGREE_WORD.test(sentence.slice(Math.max(0, f.at - 45), f.end + 45)));
    if (withDegree.length >= 2 && /\bor\b|\//i.test(sentence)) for (const f of withDegree) f.degreeAlt = true;
  }
  return found.map(({ at: _at, end: _end, ...rest }) => rest);
}

/** @param {number} n */
const fmt = n => String(n);

/** @param {{floor: number, ceiling: number|null}} m */
function rangeText(m) {
  return m.ceiling !== null ? `${fmt(m.floor)}-${fmt(m.ceiling)}` : `${fmt(m.floor)}+`;
}

/**
 * Read the stated years-of-experience requirement from JD text or HTML.
 * @param {string} jd
 * @returns {YearsRequirement}
 */
export function parseYearsRequirement(jd) {
  const lines = toLines(jd);
  /** @type {YearsMention[]} */
  const mentions = [];
  /** @type {'required'|'preferred'} */
  // Text before any heading reads as required; a heading the parser does not
  // know makes its section unclear, so its bars show but never gate.
  /** @type {'required'|'preferred'|'unclear'} */
  let section = 'required';
  let noExperience = false;
  /** @type {YearsMention[]} */
  let previous = [];
  for (const line of lines) {
    if (NO_EXPERIENCE_RE.test(line)) noExperience = true;
    const heading = headingKind(line);
    if (heading) {
      section = heading === 'other' ? 'unclear' : heading;
      continue;
    }
    for (const sentence of sentences(line)) {
      const found = mentionsIn(sentence, section);
      if (EQUIVALENT_COMBINATION.test(sentence)) {
        // Its own bars, or the ones just before it ("5+ years.\n- Or an
        // equivalent combination ...").
        for (const m of found.length ? found : previous) m.alternative = true;
      }
      mentions.push(...found);
      if (found.length) previous = found;
    }
  }

  // Unclear bars count toward the lowest reading, so they can show and keep a
  // row, but a reading that rests on one is never confident: it cannot drop.
  const gating = mentions.filter(m => (m.kind === 'required' || m.kind === 'unclear') && m.scope === 'overall');
  if (gating.length === 0 && noExperience) {
    return { status: 'stated', min: 0, max: null, confident: true, display: '0+', mentions };
  }
  if (gating.length === 0) {
    const preferred = mentions.filter(m => m.kind === 'preferred' && m.scope === 'overall');
    const skill = mentions.filter(m => m.kind === 'required' && m.scope === 'skill');
    if (preferred.length > 0) {
      const lowest = preferred.reduce((a, b) => (b.floor < a.floor ? b : a));
      return { status: 'preferred-only', min: null, max: null, confident: false, display: `pref ${rangeText(lowest)}`, mentions };
    }
    if (skill.length > 0) {
      const lowest = skill.reduce((a, b) => (b.floor < a.floor ? b : a));
      return { status: 'skill-only', min: null, max: null, confident: false, display: `skill ${rangeText(lowest)}`, mentions };
    }
    return { status: 'none', min: null, max: null, confident: false, display: 'none stated', mentions };
  }

  const lowest = gating.reduce((a, b) => (b.floor < a.floor ? b : a));
  const floors = [...new Set(gating.map(m => m.floor))].sort((a, b) => a - b);
  let display = rangeText(lowest);
  if (floors.length > 1) {
    display = gating.every(m => m.degreeAlt) ? `${floors.join('/')}+ by degree` : `${floors.join('/')}+`;
  }
  const alternative = gating.some(m => m.alternative);
  const unclear = gating.some(m => m.kind === 'unclear' && m.floor === lowest.floor);
  const confident = !alternative && !unclear;
  if (alternative) display = `${display} or equivalent`;
  return { status: 'stated', min: lowest.floor, max: lowest.ceiling, confident, display, mentions };
}

/**
 * Band verdict. 'out' only for a stated requirement whose lowest reading is
 * beyond the candidate's years plus the stretch they allow, read from a whole
 * JD (not a truncated listing description).
 *
 * @param {YearsRequirement|null} req - null when the JD could not be read
 * @param {{years: number, stretchYears: number}} band
 * @returns {'in'|'out'|'unknown'}
 */
export function classifyYears(req, { years, stretchYears }) {
  if (!req || req.status !== 'stated' || req.min === null) return 'unknown';
  if (req.min <= years + stretchYears) return 'in';
  return req.confident ? 'out' : 'unknown';
}

/**
 * The `yrs:` pipeline segment body.
 * @param {YearsRequirement|null} req - null when the JD could not be read
 * @param {'in'|'out'|'unknown'} verdict
 * @returns {string}
 */
export function formatYearsSegment(req, verdict) {
  if (!req) return 'yrs: unread';
  return verdict === 'out' ? `yrs: ${req.display} above band` : `yrs: ${req.display}`;
}

/**
 * Resolve `experience_filter` (portals.yml) against the candidate's years
 * (config/profile.yml `candidate.years_of_experience`).
 *
 * Off unless the block is present and not `enabled: false`. An enabled block
 * with no usable years is reported, not guessed at: the filter stays off.
 *
 * @param {unknown} block - portals.yml `experience_filter`
 * @param {unknown} profileYears - profile.yml `candidate.years_of_experience`
 * @returns {{enabled: false, reason?: string} | {enabled: true, years: number, stretchYears: number, action: 'drop'|'label', concurrency: number}}
 */
export function resolveExperienceFilter(block, profileYears) {
  if (block === undefined || block === null) return { enabled: false };
  if (typeof block !== 'object' || Array.isArray(block)) return { enabled: false, reason: 'experience_filter must be an object' };
  const cfg = /** @type {Record<string, unknown>} */ (block);
  if (cfg.enabled === false) return { enabled: false };
  // Off rather than guessed: `enabled: "false"` must not switch it on.
  if (cfg.enabled !== undefined && cfg.enabled !== true) return { enabled: false, reason: 'experience_filter.enabled must be true or false' };
  const years = cfg.years ?? profileYears;
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0 || years > 60) {
    return { enabled: false, reason: 'experience_filter is on but no years are set: add candidate.years_of_experience to config/profile.yml (or experience_filter.years)' };
  }
  const stretch = cfg.stretch_years ?? 1;
  const stretchYears = typeof stretch === 'number' && Number.isFinite(stretch) && stretch >= 0 ? stretch : 1;
  // `label` unless `drop` is asked for: a wrong drop silently costs a real job,
  // a wrong label costs one glance at a row.
  const action = cfg.action === 'drop' ? 'drop' : 'label';
  const conc = cfg.concurrency;
  const concurrency = Number.isInteger(conc) && /** @type {number} */ (conc) >= 1 && /** @type {number} */ (conc) <= 16 ? /** @type {number} */ (conc) : 4;
  return { enabled: true, years, stretchYears, action, concurrency };
}

// ── JD fetch ────────────────────────────────────────────────────────

// ATS whose JD comes from one public GET returning JSON. These go through
// providers/_http.mjs (SSRF-guarded connect, no redirects, body cap) with its
// shared retry, which honours Retry-After on a 429. The remaining
// JD_TEXT_API_ATS entries (an embed hop, an HTML page) use
// fetchJdViaKnownApi as-is. Normalizers are browser-extract.mjs's own, so
// fetch-jd.mjs, `browser-extract.mjs jd` and this read the same text.
const JSON_JD = /** @type {Record<string, (json: any, resolved: any, url: string, cap: number) => {text: string}|null>} */ ({
  greenhouse: (json, _r, url, cap) => normalizeGreenhouseJob(json, url, cap),
  lever: (json, _r, url, cap) => normalizeLeverJob(json, url, cap),
  ashby: (json, r, url, cap) => normalizeAshbyJob(json, r.parts.jobId, url, cap),
  workday: (json, _r, url, cap) => normalizeWorkdayJob(json, url, cap),
  smartrecruiters: (json, _r, url, cap) => normalizeSmartRecruitersJob(json, url, cap),
});

// A whole JD, qualifications included: they often sit at the end.
const JD_TEXT_CAP = 60_000;
const JD_TIMEOUT_MS = 15_000;
const JD_RETRY_POLICY = { retries: 2 };

/**
 * Full JD text for a posting, or null when its host has no known public JD
 * API. Throws on a failed request (the caller labels the row `unread`).
 *
 * @param {string} url
 * @param {{ boardCache?: Map<string, Promise<any>>, ctx?: any }} [opts]
 *   boardCache: Ashby's API is the whole board, so one fetch serves every
 *   posting on it for the rest of the run.
 * @returns {Promise<string|null>}
 */
export async function fetchJdText(url, { boardCache, ctx = makeHttpCtx() } = {}) {
  const resolved = resolveAtsApi(url);
  if (!resolved || !JD_TEXT_API_ATS.has(resolved.ats)) return null;
  const normalize = JSON_JD[resolved.ats];
  if (!normalize) {
    const result = await fetchJdViaKnownApi(url, JD_TEXT_CAP, JD_TIMEOUT_MS);
    if (!result) throw new Error(`${resolved.ats} JD fetch returned nothing`);
    return result.text;
  }
  const apiUrl = resolved.ats === 'greenhouse' ? `${resolved.apiUrl}?content=true` : resolved.apiUrl;
  const get = async () => {
    await throttleProviderRequest(resolved.ats, resolved.throttleMs);
    return fetchJsonWithRetry(ctx, apiUrl, {
      timeoutMs: resolved.timeoutMs || JD_TIMEOUT_MS,
      headers: { accept: 'application/json' },
    }, JD_RETRY_POLICY);
  };
  let json;
  if (resolved.ats === 'ashby' && boardCache) {
    // A failure is cached too: get() already retried, so asking again for
    // every other posting on a down board would only repeat that backoff.
    if (!boardCache.has(apiUrl)) boardCache.set(apiUrl, get());
    json = await boardCache.get(apiUrl);
  } else {
    json = await get();
  }
  const result = normalize(json, resolved, url, JD_TEXT_CAP);
  if (!result?.text) throw new Error(`${resolved.ats} answered without a JD for this posting`);
  return result.text;
}

/**
 * @typedef {Object} YearsVerdict
 * @property {YearsRequirement|null} req   null when the JD could not be read
 * @property {'in'|'out'|'unknown'} verdict
 * @property {'ats'|'listing'|null} source
 * @property {string|null} error
 * @property {string} label                 the `yrs:` segment body ("5+", "unread")
 */

/**
 * Read each offer's stated years and split the list by band.
 *
 * One JD request per offer at most, through its ATS's public API. The full JD
 * always wins over the listing's own description: a listing can carry a
 * teaser or a capped excerpt that states a bar and leaves out the
 * alternative or the "preferred" that follows it. So a reading taken from the
 * listing (no JD API for the host, or the request failed) is shown but never
 * drops. Every failure keeps the offer. Order is preserved.
 *
 * @template {{url: string, description?: string}} T
 * @param {T[]} offers
 * @param {{years: number, stretchYears: number, action: 'drop'|'label', concurrency: number}} filter
 * @param {{ fetchJd?: (url: string) => Promise<string|null>, onProgress?: (done: number, total: number) => void }} [deps]
 * @returns {Promise<{ kept: Array<T & {years: YearsVerdict}>, dropped: Array<T & {years: YearsVerdict}> }>}
 */
export async function applyExperienceFilter(offers, filter, deps = {}) {
  const boardCache = new Map();
  const fetchJd = deps.fetchJd || (url => fetchJdText(url, { boardCache }));
  /** @type {Array<T & {years: YearsVerdict}>} */
  const annotated = new Array(offers.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < offers.length) {
      const i = cursor++;
      const offer = offers[i];
      /** @type {YearsRequirement|null} */
      let req = null;
      /** @type {YearsVerdict['source']} */
      let source = null;
      let error = null;
      let text = null;
      try {
        text = await fetchJd(offer.url);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      // Capped like an ATS read: a provider's description has no size limit.
      const listing = typeof offer.description === 'string' ? offer.description.slice(0, JD_TEXT_CAP).trim() : '';
      if (text) {
        req = parseYearsRequirement(text);
        source = 'ats';
      } else if (listing) {
        req = { ...parseYearsRequirement(listing), confident: false };
        source = 'listing';
      }
      const verdict = classifyYears(req, filter);
      const label = formatYearsSegment(req, verdict).replace(/^yrs: /, '');
      annotated[i] = { ...offer, years: { req, verdict, source, error, label } };
      deps.onProgress?.(++done, offers.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(filter.concurrency, offers.length) }, worker));
  const dropped = filter.action === 'drop' ? annotated.filter(o => o.years.verdict === 'out') : [];
  const kept = annotated.filter(o => !dropped.includes(o));
  return { kept, dropped };
}
