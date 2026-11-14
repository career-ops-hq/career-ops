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
 *
 * A JD in Chinese states the same bar as "5年以上工作经验", "3-5年" or
 * "至少三年". Those are read by the same steps with their own patterns (see
 * "Chinese" below); the figure counts only when experience is named with it.
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

// ── Chinese ─────────────────────────────────────────────────────────
// "5年以上", "3-5年", "三到五年", "至少3年", "3年+". The lookbehind keeps "21年"
// out of "2021年"; the lookahead drops 年 that starts another word (年级, 年薪,
// 5年内, 5年后, 3年制, 5年期).
const ZH_DIGITS = '一二两三四五六七八九十';
const ZH_NUM = `(?:\\d{1,2}(?:\\.\\d)?|[${ZH_DIGITS}]{1,3})`;
const ZH_MENTION_RE = new RegExp(
  `(?<![\\d.${ZH_DIGITS}百千万第])(${ZH_NUM})\\s*(\\+)?\\s*(?:(?:-|–|—|~|～|至|到)\\s*(${ZH_NUM})\\s*)?年(?![级代度前来薪终假龄份期间内制]|后(?![端台]))`,
  'g',
);
// Text right after 年 that makes the figure a floor: "5年以上", "5年及以上",
// "5年（含）以上", "5年+".
const ZH_FLOOR_TRAIL = /^\s*(?:\+|(?:[（(]\s*含\s*[）)]\s*)?(?:及|或)?以上)/;
const ZH_FLOOR_LEAD = /(?:至少|不少于|不低于|最少|起码)\s*$/;
// The experience the figure counts.
const ZH_EXPERIENCE = /经验|经历|工作年限|从业|工龄|經驗|經歷|從業|工齡/;
// A ceiling ("5年以下", "不超过5年") or a time window ("近3年", "过去5年"): not a bar.
const ZH_CEILING_LEAD = /(?:不超过|不多于|(?<!不)少于|(?<!不)低于|小于|最多|不满|未满|不足)\s*$/;
const ZH_CEILING_TRAIL = /^\s*(?:及)?(?:以下|以内|之内)/;
const ZH_WINDOW_LEAD = /(?:近|过去|未来|今后|此前|每|满|過去|未來)\s*$/;
// The company's own history, or other people's experience. A bare 团队 is the
// subject only when the verb follows it at once ("团队拥有10年以上行业经验");
// "团队希望候选人拥有10年经验" is about the candidate.
const ZH_NOT_CANDIDATE_LEAD = /(?:成立|创立|创办|上市|运营|深耕|沉淀|平均|創立|創辦)(?:已|了|至今|已经|已有|超过|逾)*\s*$|(?:我们|我司|本公司|公司|团队成员|创始人|创始团队|我們)[^，,；;。]{0,8}(?:拥有|具有|积累|有)[^，,；;。]{0,6}$|(?:团队|團隊)(?:已|已经|共|均|都)?(?:拥有|具有|具备|积累了?|有|擁有)[^，,；;。]{0,6}$/;
// A contract, service or probation term: "合同期5年以上", "服务期不少于3年".
// The word has to name the term itself, right before the figure:
// "合同管理5年以上工作经验" is experience in managing contracts.
const ZH_TERM_LEAD = /(?:合同期限?|合同年限|合约期限?|服务期限?|任期|聘期|聘用期|签约期?|试用期|有效期|合約期限?|服務期限?|簽約期?|試用期)(?:为|為|是|[:：]|至少|不少于|不低于|最少|\s)*$/;
// "本科学历或5年以上工作经验": the years stand in for the degree, so they bind
// only a candidate without it.
const ZH_DEGREE_OR_LEAD = /(?:本科|硕士|博士|大专|专科|学士|研究生|学历|学位|碩士|大專|專科|學士|學歷|學位)[^，,；;。]{0,8}(?:或者?|或是)(?:具有|具备|拥有|有)?(?:同等|相当)?(?:至少|不少于|不低于)?\s*$/;
const ZH_SUB_LEAD = /(?:其中|包括|包含)[^，,；;。]{0,8}$/;
const ZH_PREFERRED_CUE = /优先|加分|更佳|尤佳|为佳|優先|為佳/;
// "有3年以上经验的，优先考虑": the cue opens the next clause.
const ZH_PREFERRED_NEXT = /^\s*(?:可|将|会|则|予以)?(?:优先|優先)|^\s*(?:是|为|可)?加分/;
const ZH_REQUIRED_CUE = /要求|必须|需要|至少|不少于|不低于|最少|任职资格|任职条件|必須|任職資格|任職條件/;
const ZH_DEGREE_WORD = /本科|硕士|博士|大专|专科|学士|研究生|碩士|大專|專科|學士/;
const ZH_PREFERRED_HEADING = /加分|优先|優先/;
const ZH_REQUIRED_HEADING = /(?:任职|岗位|职位|应聘|招聘|基本|任職|崗位|職位|應聘)(?:要求|资格|条件|資格|條件)|职位需求|岗位需求/;
const CJK_RE = /[\u4e00-\u9fff]/;

/** @param {string} raw "5", "2.5", "五", "十", "十五", "二十" */
function zhNumber(raw) {
  if (/^\d/.test(raw)) return Number(raw);
  const digit = (/** @type {string} */ c) => (c === '两' ? 2 : '一二三四五六七八九'.indexOf(c) + 1);
  const ten = raw.indexOf('十');
  if (ten === -1) return raw.length === 1 ? digit(raw) : NaN;
  if (ten > 1 || raw.length - ten > 2) return NaN;
  return (ten === 1 ? digit(raw[0]) : 1) * 10 + (ten < raw.length - 1 ? digit(raw[ten + 1]) : 0);
}

/** @param {string} raw */
function toNumber(raw) {
  const key = raw.toLowerCase();
  return key in WORD_NUMBERS ? WORD_NUMBERS[key] : Number(raw);
}

const LIST_MARKER = /^\s*(?:[-*•·]|\d+[.)])(?:\s+|$)/;

/**
 * Plain text for parsing. Provider descriptions arrive as HTML, ATS JD
 * normalizers already return text; both end up as lines. jdHtmlToText writes an
 * <li> as "- ", so `item` holds for either source.
 * @param {string} input
 * @returns {{ text: string, item: boolean }[]}
 */
function toLines(input) {
  const raw = String(input ?? '');
  // [^<>]: '<a<a<a…' fails each start at once instead of scanning to the end.
  const text = /<[a-z!/][^<>]*>/i.test(raw) ? jdHtmlToText(raw) : raw;
  // Runs of spaces collapse first: the sentence split is quadratic on them.
  // A marker may also end its line: `<li>\n<p>text` and `<li></li>` arrive as a
  // bare "-", and headingKind would take it for a heading and hide the real one
  // above it. In a 2026-10-30 sample, 654 of 3,573 postings had such a line.
  // The item's text then starts the next line with text, so that line is the
  // item: read without its marker, "Strong analytical skills" under Preferred
  // opened a Required section. A heading after an empty `<li></li>` looks the
  // same, and the flag only ever keeps a line without a colon from opening one.
  const lines = [];
  let marker = false;
  for (const l of text.replace(/[’‘]/g, "'").replace(/[^\S\r\n]+/g, ' ').split(/\r?\n/)) {
    const item = LIST_MARKER.test(l);
    const rest = l.replace(LIST_MARKER, '').trim();
    if (!rest) { marker ||= item; continue; }
    lines.push({ text: rest, item: item || marker });
    marker = false;
  }
  return lines;
}

/**
 * Sentence split that leaves abbreviations ("B.S.", "e.g.", "U.S.") whole:
 * a break needs two word characters before the stop. A Chinese full stop
 * (。！？；) always ends a sentence.
 * @param {string} line
 */
function sentences(line) {
  return line.split(/(?<=[a-z0-9)]{2}[.!?])\s+(?=[A-Z("])|;\s+|\s+[•·]\s+|(?<=[。！？；])/).map(s => s.trim()).filter(Boolean);
}

/**
 * @param {string} line
 * @param {boolean} item the line was a list item
 */
function headingKind(line, item) {
  if (!CJK_RE.test(line)) return latinHeadingKind(line, item);
  // "任职要求：", "加分项": a section name, alone on its line.
  const bare = line.replace(/\s*[（(][^）)]*[）)]\s*/g, '').replace(/[:：]\s*$/, '').trim();
  const colon = /[:：]\s*$/.test(line);
  // A line that states a figure is a sentence, whatever opens it:
  // "任职要求：五年以上经验" has no digit, and is not a heading.
  if (bare.length <= 12 && !/\d|[。！？；，,:：]/.test(bare) && bare.search(ZH_MENTION_RE) === -1 && (colon || !item)) {
    if (ZH_PREFERRED_HEADING.test(bare)) return 'preferred';
    if (ZH_REQUIRED_HEADING.test(bare)) return 'required';
  }
  // Chinese has no spaces between words, so the word count below cannot tell
  // a heading from a sentence. Without a colon, a line the parser does not
  // know is an item, not a heading.
  const latin = latinHeadingKind(line.replace(/：\s*$/, ':'), item);
  return latin === 'other' && !colon ? null : latin;
}

/**
 * @param {string} line
 * @param {boolean} item the line was a list item
 */
function latinHeadingKind(line, item) {
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
  // "Excellent communication skills" and "Experience in fintech" are items that
  // happen to hold a heading word. Read as Required, one under Preferred
  // Qualifications turned the bars after it into a confident drop. A colon
  // makes a list item a heading, but "Experience in fintech:" introduces the
  // items after it, not a section.
  if (known === 'required' && ((item && !/:$/.test(bare)) || /^experience (?:in|with|of)\b/i.test(bare))) return null;
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

  const zh = sentence.includes('年') && ZH_EXPERIENCE.test(sentence) ? zhMentionsIn(sentence, sectionKind) : [];
  found.push(...zh);

  // Degree-conditional alternatives: two or more overall bars in one sentence,
  // each with a degree named beside it.
  const overall = found.filter(f => f.scope === 'overall');
  if (overall.length >= 2) {
    const withDegree = overall.filter(f => (zh.includes(f) ? ZH_DEGREE_WORD.test(clauseAround(sentence, f.at, f.end).text) : DEGREE_WORD.test(sentence.slice(Math.max(0, f.at - 45), f.end + 45))));
    if (withDegree.length >= 2 && (zh.length ? withDegree.length === overall.length : /\bor\b|\//i.test(sentence))) for (const f of withDegree) f.degreeAlt = true;
  }
  return found.map(({ at: _at, end: _end, ...rest }) => rest);
}

/**
 * The clause a span sits in: the text between the commas and stops around it.
 * "、" joins a list inside one clause ("3年以上Java、Go开发经验").
 * @param {string} sentence
 * @param {number} at
 * @param {number} end
 */
function clauseAround(sentence, at, end) {
  const before = sentence.slice(0, at);
  const start = Math.max(before.lastIndexOf('，'), before.lastIndexOf(','), before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('。')) + 1;
  const stop = sentence.slice(end).search(/[，,；;。]/);
  const close = stop === -1 ? sentence.length : end + stop;
  return { text: sentence.slice(start, close), start, close };
}

/**
 * Experience mentions written in Chinese, in one sentence that names
 * experience. A figure counts when its own clause names experience
 * ("5年以上开发经验", "工作年限：3-5年"), or when it is written as a floor or a
 * range and another clause does ("本科5年以上，硕士3年以上工作经验"). A bare
 * "成立5年" or "合同期3年" is never read.
 * @param {string} sentence
 * @param {'required'|'preferred'|'unclear'} sectionKind
 * @returns {Array<YearsMention & {at: number, end: number}>}
 */
function zhMentionsIn(sentence, sectionKind) {
  /** @type {Array<YearsMention & {at: number, end: number}>} */
  const found = [];
  for (const m of sentence.matchAll(ZH_MENTION_RE)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const floor = zhNumber(m[1]);
    const ceiling = m[3] ? zhNumber(m[3]) : null;
    if (Number.isNaN(floor) || Number.isNaN(ceiling) || floor > 20) continue;
    const clause = clauseAround(sentence, at, end);
    const lead = sentence.slice(clause.start, at);
    const trail = sentence.slice(end, clause.close);
    if (ZH_CEILING_LEAD.test(lead) || ZH_CEILING_TRAIL.test(trail)) continue;
    if (ZH_WINDOW_LEAD.test(lead) || ZH_NOT_CANDIDATE_LEAD.test(lead) || ZH_TERM_LEAD.test(lead)) continue;
    const floorShaped = Boolean(m[2]) || ceiling !== null || ZH_FLOOR_TRAIL.test(trail) || ZH_FLOOR_LEAD.test(lead);
    if (!ZH_EXPERIENCE.test(clause.text) && !floorShaped) continue;
    /** @type {YearsMention['kind']} */
    let kind = sectionKind;
    if (ZH_PREFERRED_CUE.test(clause.text) || ZH_PREFERRED_NEXT.test(sentence.slice(clause.close + 1))) kind = 'preferred';
    else if (ZH_REQUIRED_CUE.test(sentence)) kind = 'required';
    found.push({
      floor,
      ceiling: ceiling !== null && ceiling > floor ? ceiling : null,
      kind,
      scope: ZH_DEGREE_OR_LEAD.test(lead) && found.length === 0 ? 'degree-substitute'
        : ZH_SUB_LEAD.test(lead) && found.some(f => f.scope === 'overall') ? 'sub' : 'overall',
      degreeAlt: false,
      quote: sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence,
      at,
      end,
    });
  }
  return found;
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
  for (const { text: line, item } of lines) {
    if (NO_EXPERIENCE_RE.test(line)) noExperience = true;
    const heading = headingKind(line, item);
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
