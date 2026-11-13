/**
 * lib/eu-signals.mjs — what a European posting asks of the candidate beyond
 * skills (job-engine tracks: europe): the language it is written in, the
 * languages it requires, and its stance on work authorization.
 *
 * Deterministic and offline. Each reader returns the sentence it relied on,
 * and says 'not_stated' or returns an empty list when the posting is silent.
 */

import { authorizedCountries, europeCountry } from './europe.mjs';
import { findRegions } from './remote-fit.mjs';

const STOPWORDS = {
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'sie', 'ist', 'nicht', 'eine', 'unser', 'bei', 'oder', 'dich', 'deine'],
  en: ['the', 'and', 'with', 'you', 'our', 'for', 'are', 'will', 'your', 'that', 'this', 'have'],
  fr: ['les', 'des', 'et', 'vous', 'nous', 'une', 'pour', 'avec', 'dans', 'votre', 'est', 'sur'],
  es: ['los', 'las', 'para', 'con', 'una', 'que', 'del', 'por', 'nuestro', 'tu', 'como', 'en'],
  nl: ['het', 'een', 'van', 'voor', 'met', 'je', 'wij', 'zijn', 'ons', 'bij', 'naar', 'jouw'],
  it: ['il', 'di', 'per', 'con', 'una', 'che', 'della', 'nel', 'sono', 'gli', 'nostro', 'tuo'],
  pl: ['w', 'z', 'na', 'do', 'się', 'oraz', 'jest', 'dla', 'nie', 'przy', 'nasz', 'lub'],
  pt: ['os', 'as', 'para', 'com', 'uma', 'que', 'não', 'em', 'nosso', 'você', 'dos', 'ou'],
};

/**
 * The language a posting is written in, by function-word count over its
 * first 4000 characters. 'unknown' when the text is short or no language
 * clearly leads.
 */
export function detectPostingLanguage(text) {
  if (typeof text !== 'string') return 'unknown';
  const words = text.slice(0, 4000).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 20) return 'unknown';
  const counts = {};
  for (const w of words) for (const [lang, list] of Object.entries(STOPWORDS)) if (list.includes(w)) counts[lang] = (counts[lang] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 4) return 'unknown';
  if (ranked[1] && ranked[1][1] * 1.3 > ranked[0][1]) return 'unknown';
  return ranked[0][0];
}

export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'];

const LANGUAGE_WORDS = [
  ['de', /(?<![\p{L}])(german|deutsch\w*|allemand|alemán)(?![\p{L}])/iu],
  ['en', /(?<![\p{L}])(english|englisch\w*|anglais|inglés)(?![\p{L}])/iu],
  ['fr', /(?<![\p{L}])(french|französisch\w*|français)(?![\p{L}])/iu],
  ['nl', /(?<![\p{L}])(dutch|niederländisch\w*|nederlands)(?![\p{L}])/iu],
  ['es', /(?<![\p{L}])(spanish|spanisch\w*|español)(?![\p{L}])/iu],
  ['it', /(?<![\p{L}])(italian|italienisch\w*|italiano)(?![\p{L}])/iu],
  ['pl', /(?<![\p{L}])(polish|polnisch\w*|polski)(?![\p{L}])/iu],
  ['pt', /(?<![\p{L}])(portuguese|portugiesisch\w*|português)(?![\p{L}])/iu],
  ['sv', /(?<![\p{L}])(swedish|schwedisch\w*|svenska)(?![\p{L}])/iu],
  ['da', /(?<![\p{L}])(danish|dänisch\w*|dansk)(?![\p{L}])/iu],
];
const LANGUAGE_CONTEXT_RE = /sprach|kenntnisse|language|speak|spoken|written|fluen|fließend|fliessend|wort und schrift|proficien|command of|skills|native|muttersprach|verhandlungssicher|\b[ABC][12]\b|level|niveau|required|erforderlich|vorausgesetzt|working knowledge|must have/i;
const OPTIONAL_RE = /nice[- ]to[- ]have|is a plus|a plus|ein plus|von vorteil|wünschenswert|bonus|advantage|optional|preferred but not|not (?:required|necessary|needed)|nicht (?:erforderlich|notwendig|zwingend)|no german|kein(?:e)? deutsch\w*|idealerweise|ideally|desirable/i;
const NOT_REQUIRED_RE = /not (?:required|necessary|needed)|nicht (?:erforderlich|notwendig|zwingend)|\bno (?:german|english|french|dutch|spanish)\b|kein(?:e)? (?:deutsch|englisch)\w*/i;

function levelIn(sentence) {
  const explicit = sentence.match(/\b([ABC][12])\b/);
  if (explicit) return explicit[1];
  if (/native|muttersprach\w*|mother tongue|bilingual/i.test(sentence)) return 'native';
  if (/verhandlungssicher|fluen\w*|fließend|fliessend|business[- ]fluent|proficien\w*|sehr gut\w*|excellent|full professional|professional working|wort und schrift|hervorragend\w*|ausgezeichnet\w*|strong command/i.test(sentence)) return 'C1';
  if (/\bgut\w*|good|solid|conversational|working knowledge|sicher\w*/i.test(sentence)) return 'B2';
  if (/grundkenntnisse|basic|elementary/i.test(sentence)) return 'A2';
  return 'B2';
}

/**
 * Languages the posting asks for. A posting written in German that never
 * mentions German still expects it: that entry is marked implied.
 *
 * @returns {Array<{ language: string, level: string, required: boolean, implied: boolean, evidence: string }>}
 */
export function readLanguageRequirements(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const lines = text.slice(0, 40000).split(/(?<=[.!?])\s+|\n+|[•;]/).map(s => s.trim()).filter(Boolean);
  for (const s of lines) {
    if (!LANGUAGE_CONTEXT_RE.test(s) && !OPTIONAL_RE.test(s)) continue;
    for (const [language, re] of LANGUAGE_WORDS) {
      if (!re.test(s) || out.some(o => o.language === language)) continue;
      if (NOT_REQUIRED_RE.test(s)) {
        out.push({ language, level: 'A1', required: false, implied: false, evidence: s.slice(0, 160) });
        continue;
      }
      out.push({ language, level: levelIn(s), required: !OPTIONAL_RE.test(s), implied: false, evidence: s.slice(0, 160) });
    }
  }
  const written = detectPostingLanguage(text);
  if (written !== 'unknown' && written !== 'en' && !out.some(o => o.language === written)) {
    out.push({ language: written, level: 'C1', required: true, implied: true, evidence: 'The posting is written in this language.' });
  }
  return out;
}

/**
 * Compare the posting's language requirements with the levels the user holds
 * ({ de: 'native', en: 'C1' }). A required language the user lacks, or holds
 * two or more levels below the ask, is a gap; one level below is a stretch.
 */
export function compareLanguages(requirements, held = {}) {
  const rank = level => LANGUAGE_LEVELS.indexOf(String(level || '').trim().replace(/^native$/i, 'native').replace(/^([abc][12])$/i, m => m.toUpperCase()));
  const gaps = [];
  const stretches = [];
  for (const req of requirements) {
    if (!req.required) continue;
    const have = rank(held[req.language]);
    const need = rank(req.level);
    if (have < 0 || need - have >= 2) gaps.push(req);
    else if (need - have === 1) stretches.push(req);
  }
  return { verdict: gaps.length ? 'gap' : stretches.length ? 'stretch' : 'ok', gaps, stretches };
}

const SPONSOR_REFUSED_RE = /\b(no (?:visa )?sponsorship|not (?:able|in a position) to (?:offer|provide) (?:visa )?sponsor\w*|cannot sponsor|can't sponsor|unable to sponsor|(?:unable|not able) to (?:offer|provide) (?:visa )?sponsor\w*|cannot (?:offer|provide) (?:visa )?sponsor\w*|do(?:es)? not sponsor|don't sponsor|won't sponsor|will not sponsor|do(?:es)? not (?:offer|provide) (?:visa )?sponsor\w*|without (?:the need for |requiring )?(?:visa )?sponsorship|sponsorship is not (?:available|offered|provided)|kein(?:e)? (?:visa|visum)\w*[- ]?(?:sponsor\w*|unterstützung))\b/i;
const SPONSOR_OFFERED_RE = /\b(visa sponsorship (?:is )?(?:available|offered|provided|possible)|we (?:offer|provide|can offer|can provide|will) (?:visa )?sponsor\w*|sponsor(?:ing)? (?:your |a |work )?visas?|visa (?:and relocation )?support|blue card|relocation (?:support|package|assistance)|visumssponsoring|unterstützung bei(?:m)? (?:visum|der relocation|relocation)|skilled worker visa)\b/i;
const RIGHT_TO_WORK_RE = /\b(?:right|eligib\w+|authori[sz]\w+|permission|permit|entitled|legally (?:able|allowed)) to work in\b|\bvalid (?:work(?:ing)? permit|work visa)\b|\bgültige arbeitserlaubnis\b|\barbeitserlaubnis (?:für|in)\b|\bEU[- ]arbeitserlaubnis\b|\bEU work permit\b|\bmust (?:be|hold) (?:an? )?(?:EU|EEA|UK|US|Swiss) (?:citizen|national|passport)\w*\b/i;
const CLEARANCE_RE = /\b(security clearance|sicherheitsüberprüfung\w*|SC cleared|DV cleared|citizens? only|staatsbürgerschaft (?:erforderlich|vorausgesetzt)|US citizen(?:ship)?|ITAR)\b/i;

/** What the posting says about visas and the right to work. */
export function readWorkAuthorization(text) {
  const out = { sponsorship: 'not_stated', rightToWork: [], clearance: null, evidence: [] };
  if (typeof text !== 'string' || !text) return out;
  const lines = text.slice(0, 40000).split(/(?<=[.!?])\s+|\n+|[•;]/).map(s => s.trim()).filter(Boolean);
  for (const s of lines) {
    if (out.sponsorship !== 'refused' && SPONSOR_REFUSED_RE.test(s)) { out.sponsorship = 'refused'; out.evidence.push(s.slice(0, 160)); }
    else if (out.sponsorship === 'not_stated' && SPONSOR_OFFERED_RE.test(s)) { out.sponsorship = 'offered'; out.evidence.push(s.slice(0, 160)); }
    if (RIGHT_TO_WORK_RE.test(s)) {
      for (const hit of findRegions(s)) if (!out.rightToWork.includes(hit.id)) out.rightToWork.push(hit.id);
      out.evidence.push(s.slice(0, 160));
    }
    if (!out.clearance) {
      const m = s.match(CLEARANCE_RE);
      if (m) { out.clearance = m[0]; out.evidence.push(s.slice(0, 160)); }
    }
  }
  return out;
}

/**
 * Whether the user may take this job as things stand.
 *
 *   ok                 authorized where the job is (or where it demands)
 *   needs_permit       not authorized there; the posting offers sponsorship or says nothing
 *   blocked            not authorized there and the posting refuses sponsorship
 *   check              a clearance or citizenship clause needs a human read
 *   unknown            the posting names no country to check
 *
 * @param {ReturnType<typeof readWorkAuthorization>} signal
 * @param {{ status: string, baseCountry: string, jobCountries?: string[] }} who  jobCountries: ISO codes or region ids from the location
 */
export function assessWorkAuthorization(signal, { status, baseCountry, jobCountries = [] } = {}) {
  if (!status) return { verdict: 'unknown', reason: 'tracks.europe.work_authorization is not set, so I cannot check where you may work.' };
  const base = europeCountry(baseCountry);
  const allowed = authorizedCountries(status, base ? base.iso : '');
  const regionOk = id => id === 'worldwide'
    || allowed.has(id)
    || ((id === 'europe' || id === 'emea') && allowed.size > 1)
    || (['dach', 'nordics', 'benelux'].includes(id) && status === 'eu_citizen');
  const demanded = signal.rightToWork.length ? signal.rightToWork : jobCountries;
  if (signal.clearance) return { verdict: 'check', reason: 'The posting mentions "' + signal.clearance + '". Read the clause before investing time.' };
  if (!demanded.length) return { verdict: 'unknown', reason: 'The posting names no country whose work authorization I can check.' };
  if (demanded.some(regionOk)) return { verdict: 'ok', reason: 'You are authorized to work in ' + demanded.filter(regionOk).join(', ') + ' as things stand.' };
  if (signal.sponsorship === 'refused') return { verdict: 'blocked', reason: 'Requires the right to work in ' + demanded.join(', ') + ' and refuses sponsorship.' };
  return {
    verdict: 'needs_permit',
    reason: 'You would need a permit for ' + demanded.join(', ') + (signal.sponsorship === 'offered' ? '; the posting offers sponsorship.' : '; the posting does not say whether it sponsors.'),
  };
}
