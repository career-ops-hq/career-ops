#!/usr/bin/env node

/**
 * Verify generated candidate-facing documents against the user's source facts.
 *
 * The CLI remains useful for CVs, while the exported verifyFacts function is
 * shared by PDF generators so every generated document gets the same gate.
 *
 * Usage:
 *   node verify-cv-facts.mjs <generated-cv.html|md|tex>
 *   node verify-cv-facts.mjs <generated-cv> --source cv.md --source article-digest.md
 *   node verify-cv-facts.mjs --self-test
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, basename } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

// Two roots, because this gate compares user-layer files against a user-layer
// config and previously resolved neither from the user's data root.
//
// cv.md and article-digest.md are the Source-of-Truth Boundary's primary files.
// As bare relative strings they resolved against process.cwd(), so from any
// directory that is not the data root the gate read NO sources — and a fact
// check with no sources does not fail open quietly, it fails LOUD and WRONG:
// every quantified claim in the generated CV is reported as "absent from
// sources", including claims copied verbatim out of the user's own cv.md.
//
// config/cv-facts.json is user-layer too (it holds the user's forbidden and
// advisory phrases). Resolved from the CODE root it was simply absent for any
// configured data root, and the gate said so and carried on:
//
//     ⚠️  fact-gate config not found: <CHECKOUT>/config/cv-facts.json
//         — forbidden/advisory phrase checks did not run.
//
// So one invocation both invented failures and silently skipped half its
// checks. --source and --config still override; only the defaults move.
const DATA_ROOT = getCareerOpsRoot();
const DEFAULT_SOURCES = [join(DATA_ROOT, 'cv.md'), join(DATA_ROOT, 'article-digest.md')];
const DEFAULT_CONFIG = join(DATA_ROOT, 'config', 'cv-facts.json');
const TOOL_PROSE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'built', 'by', 'containerized', 'deployment',
  'deployments', 'delivery', 'diagnosing', 'efficiency', 'feedback', 'for', 'from', 'improve',
  'improving', 'in', 'of', 'on', 'on-time', 'operations', 'production', 'project',
  'recurring', 'resolving', 'submission', 'team', 'the', 'to', 'using', 'with',
]);
// Words that are prose only when they are the whole fragment, in any case.
// "not just using AI, building for it" leaves "building" alone after the
// split, and it starts the next clause (#4394). It cannot join
// TOOL_PROSE_WORDS, which drops an unshaped fragment when any of its words is
// listed: "using SQL, building Looker models" would then lose Looker
// unchecked. isLikelyTool checks this set before the shape and source checks,
// because a capital letter does not make the bare word a name.
// The pronoun "I" is capitalised, so it is tool-shaped; in "using Java so I
// could ship weekly" it is the one name-shaped word after Java.
const PROSE_FRAGMENTS = new Set(['building', 'i']);
// A leading determiner marks ordinary reference, not a product list: "using
// that campaign", "using our playbook". The class is closed, so unlike
// TOOL_PROSE_WORDS it cannot turn into a list that grows by one word per bug
// report (#4004).
const DETERMINER_LEAD_RE = /^(?:the|that|this|these|those|our|your|their|its|his|her|my)(?:\s+|$)/i;
// "a" or "an" before a word opens a noun phrase, and it is a name only inside
// the phrase: "a Kubernetes cluster" claims Kubernetes, not the cluster. Unlike
// the determiners above it does not mark the clause as prose, because "using
// React and an ASP.NET backend" is a list whose second item opens with one.
const ARTICLE_LEAD_RE = /^an?\s+/i;
// The ending a name takes from the phrase around it, not from itself: a
// possessive ("Elasticsearch's index") and a lowercase hyphenated suffix
// ("Kubernetes-based"). A version or a capital after the hyphen ("GPT-4",
// "T-Mobile") is part of the name. A single letter before the suffix
// ("C-suite", "E-commerce", "X-ray") is the start of an ordinary word, so the
// word is not a name at all.
const POSSESSIVE_SUFFIX_RE = /['\u2019]s$/i;
const LOWERCASE_SEGMENT_RE = /^\p{Ll}+$/u;
const DECLARED_TOOL_TRIGGER_RE = /^(?:technologies?|tech stack)\s*:/i;
// What separates the names in a tool list. Beside the comma (Arabic and
// ideographic ones too) and the three connector words: a double quote, a
// backtick, a pipe, a bullet, a dash or an arrow, none of which occurs inside
// a name, so two names joined by a dash with no spaces are still two names.
// Any other symbol separates names only when it stands alone between spaces
// ("Java & Kubernetes"), because "AT&T", "C++" and "CI/CD" carry one inside.
// A connector joined by a hyphen is part of a word ("in-house", "built-in"),
// not a separator.
const TOOL_LIST_SEPARATOR_RE = /[,\u060c\u3001]|(?<!-)\b(?:and|with|in)\b(?!-)|["\u201c\u201d\u201e\u201a\u00ab\u00bb\u2039\u203a\u0060|\u2022\u00b7\u2013\u2014\u2190\u2192]|(?<=^|\s)[^\p{L}\p{N}\s]+(?=\s|$)/iu;
// Where a list item ends without the list ending: a bracket, or a colon, "!"
// or "?" before a space. An ideographic full stop and an Arabic semicolon take
// no space after them; they end the sentence the way "!" and "?" do.
// `toolFragments` reads the piece beside one differently from an ordinary item.
const TOOL_SENTENCE_END_RE = /[!?\u3002\u061b]/;
const TOOL_BOUNDARY_RE = /([([{)\]}]|[:!?](?=\s|$)|[\u3002\u061b])/;
// The articles and prepositions in TOOL_PROSE_WORDS that can sit inside a
// list item. They join names as readily as they join prose ("Kubernetes on
// AWS"), so on their own they do not make an item prose; see
// `toolNameBeforeConnector`. "and", "with" and "in" are left out because the
// list is split on them. "for" is left out because a capture ends at a "for"
// after a space, and an item that still starts with one ("Kafka,for
// analytics") is prose. A closed class, like the determiners above.
const TOOL_PROSE_CONNECTORS = new Set(['a', 'an', 'at', 'by', 'from', 'of', 'on', 'the', 'to']);
// "Worked with" takes a team or a person as often as a tool ("worked with
// Finance on pricing"), so `toolNameBeforeConnector` is not applied to a list
// it opens. Tested against the start of the match, which is the trigger.
const WORKED_WITH_RE = /^worked with\b/i;
// "using" opening a later list item: "using React, using Kubernetes". The
// other prose triggers end in "with", which the list is split on, so they
// never open an item.
const INNER_TOOL_TRIGGER_RE = /^\s*using\s+/i;
// A name with a dot inside it: "Node.js", "ASP.NET", ".NET". Every part between
// dots has two or more characters, so an abbreviation ("U.S.", "e.g.") is not
// one. `isDottedName` also wants a letter in the first and the last part, so a
// version ("22.04", "v18.17") or a figure with a unit ("12.5M", "99.9ms") is
// not one either.
const DOTTED_NAME_RE = /^(?:\.[\p{L}\p{N}]{2,}|[\p{L}\p{N}][\p{L}\p{N}+#-]+(?:\.[\p{L}\p{N}][\p{L}\p{N}+#-]+)+)$/u;
const LETTER_RE = /\p{L}/u;
const TOOL_PHRASE_PATTERN = /^(?=.{1,80}$)[\p{L}\p{N}.][\p{L}\p{N}+#./-]*(?:\s+[\p{L}\p{N}.][\p{L}\p{N}+#./-]*){0,2}$/u;
const DELEGATED_PARTY_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b/i;
const DELEGATION_RE = /\b(?:commissioned|coordinated|directed|engaged|hired|managed|oversaw|partnered with|supervised)\b/i;
const DIRECT_AUTHORSHIP_SIGNAL_RE = /\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;
const THIRD_PARTY_EXECUTION_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b[^.;!?]{0,120}\b(?:which|who|that)\b[^.;!?]{0,120}\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;
const DIRECT_AUTHORSHIP_CLAIM_RE = /\b(authored|built|coded|developed|engineered|implemented|programmed|wrote)\b\s+(?:the\s+|an?\s+|my\s+|our\s+)?([^.;!?]{1,160})/giu;
const ATTRIBUTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'authored', 'build', 'built', 'by', 'coded',
  'commissioned', 'coordinated', 'created', 'developed', 'directed', 'engineered',
  'engaged', 'for', 'from', 'hired', 'implemented', 'in', 'managed', 'my', 'of',
  'on', 'our', 'oversaw', 'partnered', 'programmed', 'supervised', 'the', 'through',
  'to', 'vendor', 'vendors', 'with', 'wrote',
]);
const METRIC_NOUNS = [
  'users', 'customers', 'clients', 'employees', 'engineers', 'teams', 'companies',
  'partners', 'organizations', 'organisations', 'brands', 'countries',
  'hours', 'days', 'weeks', 'months', 'years', 'minutes', 'seconds',
  'requests', 'tokens', 'documents', 'workflows', 'pipelines', 'agents',
  'interviews', 'applications', 'offers', 'reports', 'cvs', 'resumes',
  'enrollments', 'enrolments', 'completions', 'courses', 'certifications',
  'certificates', 'sessions', 'responses', 'surveys', 'cohorts',
  'commits', 'contributions', 'repositories', 'repos', 'modules', 'tools',
  'servers', 'guides', 'articles', 'datasets', 'examples', 'deployments',
  'services', 'downloads', 'stars', 'lines', 'projects', 'integrations', 'tests',
  // Headcount outside software. The list above counts users, engineers and
  // repos, so a CV in operations, facilities, healthcare, education or the
  // trades produced NO claim for the one number those CVs actually inflate:
  // how many people were managed. "Managed 45 staff" against a source saying
  // 20 passed the gate silently, which is the exact fabrication class this
  // script exists to catch.
  'staff', 'personnel', 'people', 'technicians', 'operators', 'contractors',
  'vendors', 'scientists', 'researchers', 'volunteers', 'students', 'patients',
  'crew',
  // People a candidate mentored or hired: "Mentored 12 interns" against a
  // source saying 3 passed, because none of these nouns was listed (#5348).
  'interns', 'mentees', 'apprentices', 'hires',
  // Physical assets and scale, for the same reason.
  'facilities', 'sites', 'buildings', 'rooms', 'labs', 'laboratories', 'plants',
  'machines', 'devices', 'instruments', 'vehicles', 'units', 'locations',
  'acres', 'hectares', 'shifts', 'rounds', 'inspections', 'audits', 'incidents',
  'alarms', 'tickets',
  // Education and training, for the same reason as the headcount block above.
  // 'students' and 'staff' were already here, but the nouns an education or
  // L&D CV actually inflates were not: how many people were put through a
  // program and how many sites it covered. "Trained 900+ candidates across 60
  // schools" against a source saying 250 and 20 passed the gate in silence.
  'candidates', 'trainees', 'learners', 'participants', 'attendees',
  'graduates', 'alumni', 'teachers', 'instructors', 'educators', 'faculty',
  'schools', 'districts', 'campuses', 'classrooms', 'programs', 'programmes',
  'workshops', 'assessments', 'exams',
  // German (language.output: de / modes/de). Without these a German CV or cover
  // letter produced no count claim at all and only got the coverage warning,
  // so "45 Mitarbeiter" against a source saying 20 passed unchecked. Inflected
  // forms are listed explicitly (no stemming) and folded to the English
  // canonical noun in NOUN_SYNONYMS, so a German document checks against an
  // English or German source alike. German TIME nouns (Tage, Jahre, ...) are
  // deliberately left out: sources state durations as table cells ("Day
  // Streak | 316") far more often than as "316 Tage", so adding them would fail
  // truthful documents without catching the inflation class this gate targets.
  'mitarbeiter', 'mitarbeitende', 'mitarbeitenden', 'kunden', 'projekte',
  'projekten', 'standorte', 'standorten', 'zertifikate', 'zertifikaten',
  'blogbeiträge', 'blogbeiträgen', 'beiträge', 'beiträgen', 'posts',
  'werkzeuge', 'werkzeugen',
  'mitarbeitern', 'mitarbeiterinnen', 'teammitglieder', 'teammitgliedern',
  'nutzer', 'nutzern', 'entwickler', 'entwicklern', 'entwicklerinnen',
  'ingenieure', 'ingenieuren', 'ingenieurinnen',
  // French (language.output: fr / modes/fr), on the same terms as German above:
  // plural forms listed explicitly and folded to the English canonical noun in
  // NOUN_SYNONYMS, so "Encadré 45 collaborateurs" checks against a cv.md that
  // says "45 employees". Nouns French spells like English (clients, sites,
  // services, audits, ...) were already read. Time nouns (ans, années, mois)
  // stay out for the reason the German block gives.
  'collaborateurs', 'collaboratrices', 'salariés', 'salariées', 'employés',
  'employées',
  'personnes', 'utilisateurs', 'utilisatrices', 'ingénieurs', 'ingénieures',
  'développeurs', 'développeuses', 'techniciens', 'techniciennes',
  'opérateurs', 'opératrices', 'équipes', 'stagiaires', 'apprentis',
  'alternants', 'étudiants', 'étudiantes', 'apprenants', 'formateurs',
  'enseignants', 'chercheurs', 'bénévoles', 'entreprises', 'sociétés',
  'partenaires', 'fournisseurs', 'prestataires', 'sous-traitants', 'pays',
  'projets', 'chantiers', 'usines', 'bâtiments', 'agences', 'magasins',
  'outils', 'serveurs', 'rapports', 'déploiements', 'formations',
  'clientes', 'recrutements', 'interventions',
];
// How many words may sit between a number and the noun it counts. The same
// regex parses the generated CV and the sources, so the window is symmetric by
// construction — but a window still decides WHETHER a claim exists, and the CV
// and its source rarely word a fact identically. At {0,2}, "~5 live Cloud Run
// deployments" (three modifiers) yielded no claim while the paraphrase
// "~5 Cloud Run deployments" (two) did, which broke the gate in both
// directions (#2279):
//
//   - a truthful CV failed, because the claim existed on the CV side only;
//   - a CHANGED number passed, because a 3-modifier phrasing on the CV side
//     produced no claim to compare — and catching invented numbers is the
//     entire point of this script.
//
// Four covers the phrasings seen in real CVs ("live Cloud Run deployments",
// "active monthly paying customers"). Widening cannot hide an invented number:
// it only ever extracts MORE claims, on both sides. A number is a hard barrier
// for the chain — modifiers are alphabetic only — so a wider window still
// cannot jump across an intervening figure to bind an unrelated noun.
const MODIFIER_WINDOW = 4;
// The number capture takes a magnitude as part of the number, in both the
// adjacent-suffix spelling (50k, 1.5M) and the spelled-out one (50 thousand, 1.5
// million), mirroring what the currency pattern below already does.
//
// Without the suffix branch the modifier window re-consumed that letter as a
// generic word, so "50k users" normalized to the claim "50 users" and matched a CV
// that said 50 — letting a 1000x inflation through the gate while a smaller "900
// users" was correctly caught.
//
// The spelled branch closes the same hole one magnitude further out. Left to the
// modifier window, "50 million" normalized to "50", so a source saying "Served 50
// users" was accepted as evidence for "Served 50 million users" — the 10^6 version
// of the same miss. SPELLED_MAGNITUDES folds each word onto the suffix it
// abbreviates, so both spellings of one quantity produce one claim and a document
// cannot pass by writing the magnitude out in words (#4872).
//
// Both branches require the magnitude to END the token, so "50kg users" (k not at
// a boundary) and "50 millionaire users" ("millionaire" is not the magnitude word)
// keep their previous normalization and still read as "50".
// Spelled-out magnitudes, folded onto the suffix each one abbreviates so that a
// quantity compares equal however it is written. The words mirror the existing
// `[kKmMbB]` suffix set exactly: a word with no suffix counterpart would be a
// magnitude the claim key has nothing to normalize it against.
const SPELLED_MAGNITUDES = new Map([
  ['thousand', 'k'],
  ['million', 'm'],
  ['billion', 'b'],
]);
const SPELLED_MAGNITUDE_ALT = [...SPELLED_MAGNITUDES.keys()].join('|');

const COUNT_CLAIM_RE = new RegExp(
  // LAZY (`{0,N}?`), so the number binds to the NEAREST noun in the window
  // rather than the farthest. Greedy, the quantifier consumed as many filler
  // words as the window allowed before looking for a noun, and only backtracked
  // if that failed — so whenever two METRIC_NOUNS sat within the window it
  // reported the wrong one (#3414):
  //
  //   "15+ years scaling teams and platforms"        -> 15 platforms, not 15 years
  //   "20+ years leading engineering organizations"  -> 20 organizations, not 20 years
  //
  // The same sentence's plainer paraphrase ("15+ years of experience") produced
  // "15 years", so a truthful line copied verbatim out of cv.md could be flagged
  // as invented: the CV and the source stated the same fact and the extractor
  // read two different claims out of them.
  //
  // Lazy cannot LOSE a claim. Both directions match exactly when some noun sits
  // inside the window; only WHICH one is bound differs, and the nearest is the
  // one a human reads. #2279's wide-window cases are unaffected — "~5 live
  // Cloud Run deployments" still yields "5 deployments", because there is only
  // one noun to bind to.
  //
  // A number glued to letters by a hyphen is a standard's identifier, not a
  // count: "EIP-712 signed offers" is not a claim of 712 offers, nor
  // "ERC-4626 vaults" one of 4626 vaults. Without the lookbehind, a tailored
  // bullet that drops a word the source had inside the modifier window (so
  // the source yields no claim and the bullet does) fails the gate.
  //
  // Modifiers are any letters (\p{L}), not ASCII only, so German, French and
  // Spanish modifiers with diacritics ("veröffentlichte") no longer end the
  // window. `(?:[\p{L}\p{N}]+-)*` lets the counted noun close a hyphenated
  // compound ("318 TryHackMe-Rooms"): German writes the modifier and the noun
  // as one hyphenated token, which a whitespace-only window never saw.
  String.raw`(?<![A-Za-z]-)\b(\d[\d,.]*(?:[kKmMbB]\b|\s+(?:${SPELLED_MAGNITUDE_ALT})\b)?)\s*\+?\s*(?:\p{L}[\p{L}\p{M}-]*\s+){0,${MODIFIER_WINDOW}}?(?:[\p{L}\p{N}]+-)*(${METRIC_NOUNS.join('|')})(?![\p{L}\p{N}])`,
  'giu'
);
const NOUN_SYNONYMS = new Map([
  ['repos', 'repositories'],
  ['enrolments', 'enrollments'],
  ['organisations', 'organizations'],
  ['cvs', 'resumes'],
  ['certificates', 'certifications'],
  ['articles', 'guides'],
  // A CV and its source rarely word a headcount identically; "20 personnel"
  // restating a source's "20 staff" is a paraphrase, not a fabrication.
  ['personnel', 'staff'],
  ['labs', 'laboratories'],
  // German forms fold to the English canonical noun (see METRIC_NOUNS).
  ['mitarbeiter', 'employees'],
  ['mitarbeitern', 'employees'],
  ['mitarbeiterinnen', 'employees'],
  ['mitarbeitende', 'employees'],
  ['mitarbeitenden', 'employees'],
  ['teammitglieder', 'employees'],
  ['teammitgliedern', 'employees'],
  ['kunden', 'customers'],
  ['nutzer', 'users'],
  ['nutzern', 'users'],
  ['entwickler', 'engineers'],
  ['entwicklern', 'engineers'],
  ['entwicklerinnen', 'engineers'],
  ['ingenieure', 'engineers'],
  ['ingenieuren', 'engineers'],
  ['ingenieurinnen', 'engineers'],
  ['projekte', 'projects'],
  ['projekten', 'projects'],
  ['standorte', 'locations'],
  ['standorten', 'locations'],
  ['zertifikate', 'certifications'],
  ['zertifikaten', 'certifications'],
  ['blogbeiträge', 'posts'],
  ['blogbeiträgen', 'posts'],
  ['beiträge', 'posts'],
  ['beiträgen', 'posts'],
  ['werkzeuge', 'tools'],
  ['werkzeugen', 'tools'],
  // French forms fold to the English canonical noun (see METRIC_NOUNS).
  ['collaborateurs', 'employees'],
  ['collaboratrices', 'employees'],
  ['salariés', 'employees'],
  ['salariées', 'employees'],
  ['employés', 'employees'],
  ['employées', 'employees'],
  ['personnes', 'people'],
  ['utilisateurs', 'users'],
  ['utilisatrices', 'users'],
  ['ingénieurs', 'engineers'],
  ['ingénieures', 'engineers'],
  ['développeurs', 'engineers'],
  ['développeuses', 'engineers'],
  ['techniciens', 'technicians'],
  ['techniciennes', 'technicians'],
  ['opérateurs', 'operators'],
  ['opératrices', 'operators'],
  ['équipes', 'teams'],
  ['stagiaires', 'interns'],
  ['apprentis', 'apprentices'],
  ['alternants', 'apprentices'],
  ['étudiants', 'students'],
  ['étudiantes', 'students'],
  ['apprenants', 'learners'],
  ['formateurs', 'instructors'],
  ['enseignants', 'teachers'],
  ['chercheurs', 'researchers'],
  ['bénévoles', 'volunteers'],
  ['entreprises', 'companies'],
  ['sociétés', 'companies'],
  ['partenaires', 'partners'],
  ['fournisseurs', 'vendors'],
  ['prestataires', 'contractors'],
  ['sous-traitants', 'contractors'],
  ['pays', 'countries'],
  ['projets', 'projects'],
  ['chantiers', 'sites'],
  ['usines', 'plants'],
  ['bâtiments', 'buildings'],
  ['agences', 'locations'],
  ['magasins', 'locations'],
  ['outils', 'tools'],
  ['serveurs', 'servers'],
  ['rapports', 'reports'],
  ['déploiements', 'deployments'],
  ['formations', 'courses'],
  ['clientes', 'clients'],
  ['recrutements', 'hires'],
]);
// One claim, however it is spelled (#5348). Each pattern below is a spelling of
// a percentage, an amount of money or a multiplier, and canonicalMetric() folds
// every match onto one key: `45 percent` / `45 per cent` / `45%` -> `45%`,
// `USD 3M` / `3 million dollars` / `$3M` -> `$3m`, `10-fold` / `10x` -> `10x`.
// With only the symbol spellings recognized, the same inflated figure blocked
// as `45%` and passed as `45 percent`, so whether the gate caught a number
// depended on wording an LLM rewriter picks freely.
//
// Currency codes are matched case-sensitively: lowercase "eur" or "gbp" in prose
// is not a currency. A bare "pound(s)" is left out because it is also a weight.
const MAGNITUDE_ALT = String.raw`(?:\s?(?:thousand|million|billion)\b|\s?[kKmMbB](?![\p{L}]))`;
const SIMPLE_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?[^\S\n]?(?:%|(?:percent|per\s?cent|pct)\b)/gi,
  new RegExp(String.raw`(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?(?:thousand|million|billion)\b|\s?[kKmMbB])?`, 'gu'),
  new RegExp(String.raw`(?:\b(?:USD|EUR|GBP)|\bUS\$)\s?\d[\d,.]*${MAGNITUDE_ALT}?`, 'gu'),
  new RegExp(String.raw`\b\d[\d,.]*${MAGNITUDE_ALT}?\s?-?\s?(?:(?:USD|EUR|GBP)\b|(?:[Dd]ollars?|[Ee]uros?)\b)`, 'gu'),
  /\b\d+(?:\.\d+)?\s?x\b/gi,
  /\b\d+(?:\.\d+)?\s?-?\s?fold\b/gi,
];

const CURRENCY_SYMBOLS = new Map([
  ['$', '$'], ['us$', '$'], ['usd', '$'], ['dollar', '$'], ['dollars', '$'],
  ['€', '€'], ['eur', '€'], ['euro', '€'], ['euros', '€'],
  ['£', '£'], ['gbp', '£'],
]);

/**
 * Fold one SIMPLE_CLAIM_PATTERNS match onto the key its other spellings share.
 *
 * Anything this does not recognize falls back to normalizeClaim, so an entry
 * in allow_metrics written in an unusual spelling still compares the way it
 * always did.
 *
 * @param {string} raw - the matched text
 * @returns {string}
 */
function canonicalMetric(raw) {
  const claim = normalizeClaim(raw);
  const percent = /^(\d+(?:\.\d+)?) ?(?:%|percent|per ?cent|pct)$/.exec(claim);
  if (percent) return `${percent[1]}%`;
  const multiplier = /^(\d+(?:\.\d+)?) ?(?:x|-? ?fold)$/.exec(claim);
  if (multiplier) return `${multiplier[1]}x`;
  const amount = String.raw`(\d[\d.]*)(?: ?(thousand|million|billion|[kmb]))?`;
  const lead = new RegExp(String.raw`^(\$|€|£|us\$|usd|eur|gbp) ?${amount}$`).exec(claim);
  const trail = lead ? null : new RegExp(String.raw`^${amount} ?-? ?(usd|eur|gbp|dollars?|euros?)$`).exec(claim);
  if (!lead && !trail) return claim;
  const [symbol, number, magnitude] = lead ? [lead[1], lead[2], lead[3]] : [trail[3], trail[1], trail[2]];
  const suffix = magnitude ? (SPELLED_MAGNITUDES.get(magnitude) ?? magnitude) : '';
  return `${CURRENCY_SYMBOLS.get(symbol)}${number}${suffix}`;
}

// Spelled-out numbers, rewritten as digits before the claim patterns run, so
// "Led forty engineers" and "Led 40 engineers" make the same claim (#5348).
// Before, only the digit form was read, and a rewriter that spelled the
// number out got an inflated headcount past the gate.
//
// "one" on its own is left alone: "one of the engineers" is not a count of
// one engineer, and every count noun here is plural anyway. It is read only as
// the start of "one hundred". The `-fold` multiplier is read for four and up,
// because "a twofold approach" and "a threefold mission" are prose far more
// often than they are metrics.
const NUMBER_WORD_VALUES = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9],
  ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15],
  ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70],
  ['eighty', 80], ['ninety', 90],
]);
const UNIT_WORDS = 'one|two|three|four|five|six|seven|eight|nine';
const TENS_WORDS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const TEEN_WORDS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const SPELLED_NUMBER_RE = new RegExp(
  String.raw`\b(?:(?<tens>${TENS_WORDS})(?:[-\s](?<tensUnit>${UNIT_WORDS}))?|(?<teen>${TEEN_WORDS})|(?<unit>two|three|four|five|six|seven|eight|nine)|(?<one>one)(?=\s+hundred\b))(?<hundred>\s+hundred)?\b`,
  'gi',
);
const SPELLED_FOLD_RE = /\b(four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|thousand)-?fold\b/gi;

/** Rewrite spelled-out English numbers as digits, for metric extraction only. */
function spellNumbers(text) {
  return text
    .replace(SPELLED_FOLD_RE, (_, word) => {
      const lower = word.toLowerCase();
      const value = lower === 'hundred' ? 100 : lower === 'thousand' ? 1000 : NUMBER_WORD_VALUES.get(lower);
      return `${value}-fold`;
    })
    .replace(SPELLED_NUMBER_RE, (...args) => {
      const groups = args.at(-1);
      const word = (name) => NUMBER_WORD_VALUES.get(groups[name]?.toLowerCase()) ?? 0;
      const value = word('tens') + word('tensUnit') + word('teen') + word('unit') + word('one');
      return String(groups.hundred ? value * 100 : value);
    });
}

/** Read a UTF-8 file when it exists, otherwise return an empty string. */
function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

// Unicode decimal-digit blocks, by the code point of their zero. Every claim
// pattern in this file is written with ASCII `\d`, so a CV that spells its
// numbers in any other script produced ZERO claims and the gate reported a
// pass without having checked anything — in ar, hi, ja, zh and zh-TW, all of
// which ship mode sets. NFKC alone is not enough: it folds full-width digits
// (ja/zh) but leaves Arabic-Indic, Persian and Devanagari untouched.
const DIGIT_ZEROS = [
  0x0660, // Arabic-Indic (ar)
  0x06f0, // Extended Arabic-Indic (fa, ur)
  0x0966, // Devanagari (hi)
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0x1040, // Myanmar
  0x17e0, // Khmer
  0x1810, // Mongolian
];

/**
 * Rewrite every Unicode decimal digit as its ASCII counterpart, plus the
 * separators and percent signs that travel with them, so the claim patterns
 * see the same numbers whatever script wrote them.
 *
 * Applied to the generated document AND to the sources, so it can only ever
 * make MORE claims visible on both sides — it cannot hide one.
 *
 * @param {string} text
 * @returns {string}
 */
export function foldDigits(text) {
  // NFKC first: it maps full-width digits and ％ to ASCII outright.
  let out = text.normalize('NFKC');
  out = out.replace(/\p{Nd}/gu, (char) => {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x30 && cp <= 0x39) return char;
    for (const zero of DIGIT_ZEROS) {
      const value = cp - zero;
      if (value >= 0 && value <= 9) return String(value);
    }
    return char; // a decimal digit from a block we don't list: left as-is
  });
  // Arabic separators and percent sign, which NFKC does not fold either.
  out = out
    .replace(/\u066a/g, '%')   // ٪ Arabic percent sign
    .replace(/\u066b/g, '.')   // ٫ Arabic decimal separator
    .replace(/\u066c/g, ',');  // ٬ Arabic thousands separator
  // A SPACE-grouped thousand ("16 181", common in fr/ru/sv and as NNBSP in
  // typeset text) has to be joined here, before extraction: the claim pattern
  // reads a number as `\d[\d,.]*`, so it would stop at the space and extract
  // "181 users" — a claim the sources never contain, failing a truthful CV.
  // The `(?<!\d)\d{1,3}` guard keeps it to real grouping: in "in 2026 100
  // users" the left part is four digits, so nothing is joined.
  return out.replace(/(?<!\d)(\d{1,3})[\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1');
}

const HTML_ENTITY_RE = /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]{2,31}));/gi;
const HTML_NAMED_ENTITIES = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['nbsp', ' '], ['quot', '"'], ['apos', "'"],
  ['lsquo', '\u2018'], ['rsquo', '\u2019'], ['sbquo', '\u201a'], ['ldquo', '\u201c'],
  ['rdquo', '\u201d'], ['bdquo', '\u201e'], ['laquo', '\u00ab'], ['raquo', '\u00bb'],
  ['ndash', '\u2013'], ['mdash', '\u2014'], ['hellip', '\u2026'], ['bull', '\u2022'],
  ['middot', '\u00b7'], ['reg', '\u00ae'], ['trade', '\u2122'], ['copy', '\u00a9'],
  ['shy', '\u00ad'], ['zwnj', '\u200c'], ['zwj', '\u200d'], ['zerowidthspace', '\u200b'],
]);
// Decoded only after tags are stripped, so escaped markup stays text and an
// escaped "&" cannot join what follows it into another entity.
const MARKUP_ENTITY_CHARACTERS = new Set(['&', '<', '>', ' ']);

/**
 * The character an HTML entity encodes. A control character renders as white
 * space at most, so it decodes to a space. An unknown entity, and one outside
 * the pass asked for (`markup` decodes only `MARKUP_ENTITY_CHARACTERS`, the
 * other pass everything else), is returned unchanged.
 */
function decodeHtmlEntity(entity, decimal, hex, name, markup) {
  const codePoint = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : null;
  const char = codePoint === null
    ? HTML_NAMED_ENTITIES.get(name.toLowerCase())
    : codePoint < 0x20 ? ' ' : (codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : undefined);
  if (char === undefined || MARKUP_ENTITY_CHARACTERS.has(char) !== markup) return entity;
  return char;
}

// Only the body of a LaTeX document is CV content. The preamble is package
// names, lengths and macro definitions, and read as text it made claims of its
// own: `\pdfgentounicode=1` above a `%%%%` banner was the metric "1%", and
// the `0em` lengths outvoted a short CV's English in the language check
// ("em" is Portuguese). Comments go too, since a comment runs from an
// unescaped `%` to the end of the line. Only a LaTeX document is treated this
// way: everywhere else `%` is a percent sign.
const LATEX_DOCUMENT_RE = /\\documentclass\b|\\begin\{document\}/;
const LATEX_COMMENT_RE = /(?<!\\)%.*$/gm;
const LATEX_BODY_RE = /\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/;

/** The body of a LaTeX document without its comments; any other text unchanged. */
function latexBody(text) {
  const raw = String(text);
  if (!LATEX_DOCUMENT_RE.test(raw)) return raw;
  const uncommented = raw.replace(LATEX_COMMENT_RE, '');
  return LATEX_BODY_RE.exec(uncommented)?.[1] ?? uncommented;
}

/** Remove HTML, basic LaTeX commands, and excess whitespace from document text. */
export function stripMarkup(text, { keepLineBreaks = false } = {}) {
  text = latexBody(text);
  // An entity is the character it encodes, and a default-ignorable character
  // (zero-width space, joiner, soft hyphen, directional mark, variation
  // selector) renders as nothing. Both are resolved before anything else reads
  // the text, digit grouping included, so every claim pattern sees what the
  // reader sees. Left in, either one split a word: "Kuber&shy;netes", or the
  // same word with a zero-width space inside, was never compared with the
  // sources, and an entity's ";" ended a tool list.
  const visible = String(text)
    .replace(HTML_ENTITY_RE, (entity, decimal, hex, name) => decodeHtmlEntity(entity, decimal, hex, name, false))
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    // A trademark sign is not part of the name it marks. Left in, it joined
    // the name inside a clause, and normalization turns "\u2122" into "TM".
    .replace(/[\u00ae\u2120\u2122]/g, '');
  return foldDigits(visible)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    // Only strip things that actually look like tags: `<name …>` or `</name>`.
    // A bare `<` is ordinary prose in these sources (`p<0.001`, `ρ < 0.3`, `<30 min`),
    // and `[^>]` matches newlines — so the old `/<[^>]+>/g` let one stray `<` swallow
    // everything up to the next `>`, deleting real evidence from the allow-list and
    // failing truthful CVs (article-digest.md lost 1,327 chars, incl. two metrics).
    // A BLOCK boundary becomes a sentence break, not a space. Collapsing
    // `</li><li>` to ' ' glues two bullets into one line, and the employer /
    // title captures chain consecutive Capitalised words — so a truthful
    // "…as a Principal Engineer" followed by a bullet starting "Built…" was
    // read as the title "Principal Engineer Built", which no source contains.
    // The markdown sources never had the problem (their newlines break the
    // chain), so the two sides now normalise the same way.
    .replace(/<\/?(?:li|p|div|tr|h[1-6]|section|article|ul|ol|table|br)\b[^>\n]*>/gi, '. ')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    // An escaped special character is the character. LaTeX writes a percent
    // sign as `\%` (and markdown allows the same escape), and the backslash
    // broke the digit-percent adjacency the claim pattern needs, so every
    // percentage in a .tex CV was invisible to the gate (#5348). `\&`, `\#`
    // and `\_` matter to names: "R\&D", "C\#".
    .replace(/\\([%$&#_])/g, '$1')
    // Markdown emphasis (`**bold**`, `__bold__`, `*italic*`) — the house style
    // used to bold nearly every metric in cv.md/article-digest.md. A closing
    // marker sitting directly against the number severed the number-noun
    // adjacency the claim patterns require, so a bolded metric quoted verbatim
    // from the source was reported as "invented" (#4085). Requires
    // non-whitespace touching each marker (the standard markdown emphasis
    // rule), so a lone unpaired asterisk — a footnote marker like "40%*", or
    // two of them on one line — is left alone rather than paired into a false
    // span. Single underscores are load-bearing in these sources (snake_case,
    // env_keys.json, file paths), so only a DOUBLED underscore is stripped.
    // Must run AFTER the LaTeX pass above: a LaTeX star-variant command
    // (`\section*{...}`) leaves a single bare `*` behind if consumed first,
    // and that stray star can pair with an unrelated later `*...*` span and
    // mangle both. Bold before italic, so the italic pass never splits a
    // `**...**` run in two. Bold may span a wrapped line (`keepLineBreaks`);
    // italic is deliberately kept single-line, to stay conservative about the
    // more collision-prone single-asterisk form.
    //
    // Deliberately NOT letter/digit-boundary-guarded (e.g. `(?<![\p{L}\p{N}_])`)
    // even though that would preserve literal patterns like `2*3*4` or
    // `foo*bar*baz`: a LaTeX star command directly abutting the next word
    // (`\section*{Foo}and*emphasis*done` -> `Foo and*emphasis*done`) leaves
    // the italic span's markers touching letters on both sides, which such a
    // guard rejects — turning real emphasis back into a false negative. The
    // covered CV/article-digest sources never contain literal multiplication
    // asterisks, so this trades an untested hypothetical for a real,
    // regression-tested case (see the LaTeX star-command test below).
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, ' $1 ')
    .replace(/__(\S(?:[\s\S]*?\S)?)__/g, ' $1 ')
    .replace(/\*(\S(?:[^\n*]*\S)?)\*/g, ' $1 ')
    .replace(HTML_ENTITY_RE, (entity, decimal, hex, name) => decodeHtmlEntity(entity, decimal, hex, name, true))
    // keepLineBreaks preserves a newline as a CLAUSE boundary for the plan-horizon
    // scan. Horizontal whitespace still collapses, and every claim pattern spans a
    // newline through `\s`, so extraction is unaffected either way.
    .replace(keepLineBreaks ? /[^\S\n]+/g : /\s+/g, ' ')
    .replace(/ *\n+ */g, keepLineBreaks ? '\n' : ' ')
    .trim();
}

/**
 * Normalize a claim for case- and whitespace-insensitive comparison.
 *
 * Thousands separators are removed FIRST, so the same number compares equal
 * however it is grouped: "16,181" / "16 181" / "16181". Without that step the
 * old rule turned "16,181" into "16 181" while an ungrouped source stayed
 * "16181", and the two never matched — a truthful CV failed the gate because
 * of a comma. That bites hardest in the scripts folded above, since Arabic and
 * Devanagari numerals are usually written without a separator at all.
 *
 * Only a separator followed by EXACTLY three digits is removed, so a decimal
 * comma ("1,2 million") and ordinary prose are left alone.
 *
 * The period is in the class for the same reason the comma is, from the other
 * side of the convention: this repo ships mode sets for markets that group
 * with a period, so a JD or a portfolio note written "16.181 users" is a
 * source a CV written "16,181 users" is checked against. Grouping style is not
 * evidence of a different number, and the gate reported one as invented.
 *
 * The three-digit window is what makes this safe to widen: it leaves a genuine
 * decimal alone at every precision a metric noun realistically carries ("2.5
 * hours", "99.95 uptime"). It cannot disambiguate a three-place decimal, where
 * "1.250 million" reads as thousands - an ambiguity the comma branch already
 * carries in the mirror direction, and one no separator rule can resolve
 * without knowing the document's locale. allow_metrics covers the rest.
 */
export function normalizeClaim(claim) {
  return String(claim)
    .toLowerCase()
    .replace(/(\d)[,.\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1')
    .replace(/[,\s]+/g, ' ')
    .trim();
}

/** Normalize a non-metric fact and remove terminal punctuation. */
function normalizeFact(value) {
  return normalizeClaim(value).replace(/[.;:,]+$/g, '').trim();
}

/** Whether a raw (unnormalized) tool fragment looks like a real product name: Title Case, or carries a digit/version token (e.g. "n8n", "Python 3.11", "GPT-4"). */
function looksToolShaped(rawValue) {
  const trimmed = String(rawValue).trim();
  if (!trimmed) return false;
  // A digit anywhere marks a version or a name built on one: "n8n", "GPT-4",
  // "Python 3.11".
  if (/\d/.test(trimmed)) return true;
  // Every word capitalised: "React", "Google Cloud", "Node.js". A lowercase
  // connector inside a capitalised phrase ("Kubernetes on AWS") makes it not
  // tool-shaped, which leaves it to the prose-word check in isLikelyTool.
  return trimmed.split(/\s+/).every(word => /^[\p{Lu}]/u.test(word));
}

/**
 * Keep likely technology names while dropping ordinary prose fragments.
 *
 * A fragment that is exactly a `PROSE_FRAGMENTS` word, in any case, is
 * rejected first, before the shape and source checks below.
 *
 * A fragment that does not look tool-shaped (see `looksToolShaped`) is kept
 * anyway when it is already an exact substring of the source files: a real
 * lowercase tool name ("kubernetes", "n8n") a user genuinely used and listed
 * in cv.md must still pass, and rejecting it on casing alone would just trade
 * one false-positive class for another.
 *
 * A fragment whose every word already occurs in the source is dropped: that
 * is the document's own vocabulary reworded, and tailoring rewords "using"
 * sentences by design. A name the source never mentions is unaffected, so
 * "kubernetes" in a CV that never says it stays fail-closed.
 *
 * Anything left is retained by default, preserving that fail-closed behavior
 * for lowercase names. Only exact words observed as prose false positives are
 * rejected here, through `TOOL_PROSE_WORDS`; morphological suffixes are
 * deliberately not used because real products such as Spring, Unity, and
 * Processing share them.
 *
 * Neither length nor punctuation rejects a fragment. A fragment of more than
 * three words, or one holding a character outside letters, digits and
 * "+#./-", used to be dropped here before any check, so "Google Cloud Vertex
 * AI" or "AT&T Cloud" was never compared with the sources and a fabricated
 * one passed the gate. Dropping is the fail-open direction. `toolFragments`
 * now strips the punctuation around a name and reads a long fragment by its
 * names, and what reaches this function goes through the checks above.
 */
function isLikelyTool(value, sourceNormalized) {
  const normalized = normalizeFact(value);
  const words = normalized.split(' ');
  if (!normalized) return false;
  // Before the shape and source checks: the whole fragment is the prose word,
  // so a title-cased "Building" is no more a name than "building" is.
  if (PROSE_FRAGMENTS.has(normalized)) return false;
  if (looksToolShaped(value)) return true;
  if (sourceNormalized != null && sourceContainsFact(sourceNormalized, normalized)) return true;
  // Every word of the fragment already occurs in the source: this is the
  // document's own vocabulary reworded, not a technology the source never
  // mentions. Tailoring rewords "using" sentences by design, so without this
  // the only thing between ordinary prose and a tool claim is
  // TOOL_PROSE_WORDS (#4004).
  if (sourceNormalized != null && words.every(word => sourceContainsFact(sourceNormalized, word))) return false;
  return !words.some(word => TOOL_PROSE_WORDS.has(word));
}

// A word that is a quantity rather than a name: one with no letter ("30",
// "70:20:10"), or a number with a unit of at most two letters ("3x", "12M",
// "99.9ms", "40%").
const QUANTITY_WORD_RE = /^(?:\P{L}*|\d[\d.,]*\p{L}{0,2}%?)$/u;
// What the same test accepts as a measure when a digit-led word may be a name.
// A measure is a number alone, or a number with one suffix letter from k, m, b
// or x in either case: the suffixes the metric patterns read on a number
// ("50k users", "1.5M users", "10x"). Any other letters make the word a name,
// lowercase or not: "3CX", "4d", "3cx", "4me" and "12MB". The suffix cannot
// tell a product from a unit, so "4K" and "3M" read as measures.
const MEASURE_WORD_RE = /^(?:\P{L}*|\d[\d.,]*[kKmMbBxX]?)$/u;
// A word of single letters joined by dots or slashes: "U.S.", "A/B", "I/O".
const ABBREVIATION_WORD_RE = /^\p{L}(?:[./]\p{L})+\.?$/u;

/**
 * The runs of consecutive tool-shaped words in a fragment: "Salesforce" in
 * "Salesforce across three regions". A word with a capital after a lowercase
 * letter counts ("iOS", "macOS"), and so does a dotted name (".NET"). A
 * quantity or an abbreviation names nothing, so it ends a run and is left
 * out: "CAC 30%" checks CAC, and "A/B" checks nothing. A word joined by a
 * slash to a dotted name is two names, so "Node.js/Express" checks both.
 * `skipLoneLetter` drops a run of one letter, which is what a capture that
 * stopped at the dot in "U.S." leaves behind. `digitNames` reads a digit-led
 * word as a name unless it is a measure (`MEASURE_WORD_RE`), where the
 * default also drops any word with one or two letters after its digits.
 */
function toolNameRuns(fragment, { skipLoneLetter = false, digitNames = false } = {}) {
  const quantity = digitNames ? MEASURE_WORD_RE : QUANTITY_WORD_RE;
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length) runs.push(run.join(' '));
    run = [];
  };
  for (const word of fragment.split(/\s+/)) {
    const parts = word.includes('/') && word.split('/').some(isDottedName) ? word.split('/') : [word];
    parts.forEach((part, index) => {
      if (index > 0) flush();
      const named = looksToolShaped(part) || /\p{Ll}\p{Lu}/u.test(part) || isDottedName(part);
      if (named && !quantity.test(part) && !ABBREVIATION_WORD_RE.test(part)) run.push(part);
      else flush();
    });
  }
  flush();
  return skipLoneLetter ? runs.filter(name => !/^\p{L}$/u.test(name)) : runs;
}

/**
 * A fragment without the punctuation around it: a single quote, which cannot
 * separate names because the same character is the apostrophe in "Moody's",
 * or a footnote mark. A leading "." is kept (".NET"), and so is a trailing
 * "+", "#" or "-" ("C++", "C#", "C--"). The end is trimmed one character at a
 * time, because an end-anchored pattern rescans a run of symbols from every
 * position in it.
 */
function trimToolFragment(raw) {
  const chars = Array.from(raw.replace(/^[^\p{L}\p{N}.]+/u, ''));
  let end = chars.length;
  while (end > 0 && !/[\p{L}\p{N}+#-]/u.test(chars[end - 1])) end--;
  return chars.slice(0, end).join('');
}

/**
 * Split the text a tool trigger introduced into the fragments `isLikelyTool`
 * judges.
 *
 * A list item of up to three words is returned whole. A longer one is a
 * clause ("Salesforce across three regions"), returned as its tool-shaped
 * words (`toolNameRuns`): read whole, it is a claim no source contains, and a
 * truthful CV blocks.
 *
 * A piece that held a boundary's character (`TOOL_BOUNDARY_RE`) used to be
 * dropped unread. The piece just inside a bracket, the piece just after one,
 * and the piece after a colon are now read by their tool-shaped words too. A
 * bracket holds a description as often as a name ("Java (self-hosted)"), and
 * a colon introduces a clause as often as a list, so lowercase words there are
 * not read as tools. The piece after "!", "?" or another sentence end
 * (`TOOL_SENTENCE_END_RE`) begins the next sentence and is still not read. A piece before a boundary is an ordinary item:
 * "Kubernetes" in "Kubernetes (EKS)" or "Kubernetes: cut release time".
 */
function toolFragments(listText) {
  const fragments = [];
  // Text at even indexes; the boundary between two texts at the odd index.
  const parts = listText.split(TOOL_BOUNDARY_RE);
  for (let index = 0; index < parts.length; index += 2) {
    const before = parts[index - 1] ?? '';
    const after = parts[index + 1] ?? '';
    const pieces = parts[index].split(TOOL_LIST_SEPARATOR_RE).map(trimToolFragment);
    pieces.forEach((piece, position) => {
      const first = position === 0;
      const last = position === pieces.length - 1;
      if (!piece || (first && TOOL_SENTENCE_END_RE.test(before))) return;
      // Pushed one at a time: spread into push(), hundreds of thousands of
      // names overflow the call stack.
      if ((first && /[([{)\]}:]/.test(before)) || (last && /[)\]}]/.test(after))) {
        for (const name of toolNameRuns(piece)) fragments.push(name);
      } else if (!DETERMINER_LEAD_RE.test(piece)) {
        if (piece.split(/\s+/).length <= 3) fragments.push(piece);
        else for (const name of toolNameRuns(piece, { skipLoneLetter: true })) fragments.push(name);
      }
    });
  }
  return fragments;
}

function isDottedName(word) {
  if (!DOTTED_NAME_RE.test(word)) return false;
  const parts = word.split('.').filter(Boolean);
  return LETTER_RE.test(parts[0]) && LETTER_RE.test(parts[parts.length - 1]);
}

/**
 * The dotted names among the words before the first connector of a fragment
 * `isLikelyTool` rejected, whatever the fragment's length.
 *
 * The three-word limit drops "Node.js on AWS Lambda" whole, which leaves the
 * name to the pattern that stops at the dot, and that one checks "node". A
 * source that says "Node", or "next quarter" for "Next.js", then backs the
 * claim. A dotted name (see `isDottedName`) names a product or a site, so
 * these are kept without the shape and prose checks the rest of the fragment
 * needs. A word is split at a slash first, so "Node.js/Express" yields
 * "Node.js". The plain name beside it stays unread. Words after the connector
 * stay unread, as in `toolNameBeforeConnector`.
 */
function dottedNamesBeforeConnector(value) {
  if (!value.includes('.')) return [];
  const words = value.trim().split(/\s+/);
  const connector = words.findIndex(word => TOOL_PROSE_CONNECTORS.has(normalizeFact(word)));
  return words.slice(0, connector < 0 ? words.length : connector).flatMap(word => word.split('/')).filter(isDottedName);
}

/**
 * The tool-shaped name a connector hid inside a fragment `isLikelyTool`
 * rejected, or '' when there is none.
 *
 * A prose word rejects its whole fragment, which is right for ordinary
 * English and wrong for a name followed by a connector: in "Kubernetes on AWS"
 * the "on" discarded Kubernetes, so the name the trigger introduced was never
 * checked. When every prose word in the fragment is a connector
 * (`TOOL_PROSE_CONNECTORS`), the words before the first one are that name, and
 * they are kept if `looksToolShaped` accepts them. Any other prose word still
 * rejects the whole fragment, so "Ops on deployment" yields nothing:
 * "deployment" marks it as a sentence about work.
 *
 * Only the name before the connector is kept. What follows one is usually
 * where or when the tool was used ("Looker on Mondays", "GCP at Initech").
 * #4394 kept a place after "in" or "with" as a claim that allow_facts clears.
 * Reading this position the same way would block those words too, so it is
 * left unread.
 *
 * The name must be tool-shaped, so a lowercase head such as "data" in "data
 * on Mondays" stays with `isLikelyTool` and this never widens its default
 * acceptance. Like `isLikelyTool`, it reads at most three words, so a longer
 * fragment such as "Kubernetes on Google Cloud" is still dropped whole.
 */
function toolNameBeforeConnector(value) {
  const trimmed = value.trim();
  if (!TOOL_PHRASE_PATTERN.test(trimmed)) return '';
  const words = trimmed.split(/\s+/).map(word => ({ word, normalized: normalizeFact(word) }));
  const proseWords = words.filter(({ normalized }) => TOOL_PROSE_WORDS.has(normalized));
  if (!proseWords.every(({ normalized }) => TOOL_PROSE_CONNECTORS.has(normalized))) return '';
  const connector = words.findIndex(({ normalized }) => TOOL_PROSE_CONNECTORS.has(normalized));
  if (connector <= 0) return '';
  const name = words.slice(0, connector).map(({ word }) => word).join(' ');
  return looksToolShaped(name) ? name : '';
}

/**
 * The values one tool fragment claims, and whether `isLikelyTool` accepted the
 * fragment whole: the claim is then the whole fragment. When it did not, the
 * claims are the names `dottedNamesBeforeConnector` and, with `useConnector`,
 * `toolNameBeforeConnector` recover from it.
 */
function toolFragmentClaims(fragment, sourceNormalized, useConnector) {
  const value = normalizeFact(fragment);
  if (!value) return { whole: false, values: [] };
  if (isLikelyTool(fragment, sourceNormalized)) return { whole: true, values: [value] };
  const names = dottedNamesBeforeConnector(fragment);
  if (useConnector) names.push(toolNameBeforeConnector(fragment));
  return { whole: false, values: names.filter(Boolean).map(normalizeFact) };
}

/**
 * A name run read out of a phrase, without the ending the phrase gave it: the
 * quotes around it, a possessive and a lowercase hyphenated suffix. Returns ''
 * when nothing is left that names a tool, as for "C-suite".
 *
 * The suffix is found by splitting at hyphens and dropping trailing
 * all-lowercase segments, one pass over the word. An end-anchored pattern
 * would rescan a long run of hyphens from every one of them.
 */
function tidyToolName(name) {
  const parts = name.replace(POSSESSIVE_SUFFIX_RE, '').split('-');
  let end = parts.length;
  while (end > 1 && LOWERCASE_SEGMENT_RE.test(parts[end - 1])) end--;
  if (end === parts.length) return trimToolFragment(parts.join('-'));
  const stem = trimToolFragment(parts.slice(0, end).join('-'));
  return Array.from(stem).length < 2 ? '' : stem;
}

/**
 * Extract explicitly asserted employer, title, and tool claims from text.
 *
 * `sourceNormalized` (from `normalizeFact(stripMarkup(sourceText))`, as
 * `verifyFacts` already builds it) is optional and used only to let a
 * lowercase-but-genuine tool fragment through `isLikelyTool` when it is
 * already backed by a source file — see that function's doc comment. Callers
 * that omit it (existing direct callers, tests) get the same conservative
 * shape-only behaviour as before: a tool-shaped fragment is extracted, an
 * ordinary lowercase one is not.
 */
export function factClaims(text, sourceNormalized = null) {
  const clean = stripMarkup(text);
  const claims = [];
  const patterns = [
    // The TRIGGER is case-insensitive, the CAPTURE is not. Both patterns used
    // to be plain /g, so only a lowercase trigger matched — and a CV is
    // written in capitalised bullets, so the phrasings that actually occur
    // were invisible:
    //
    //   "- Worked at Initech as a Principal Engineer"  ->  no claim, gate passed
    //   "he worked at Initech as a Principal Engineer" ->  employer + title
    //
    // A fabricated employer or title therefore shipped unflagged in the
    // spelling CVs use, which is the half of this gate that enforces
    // AGENTS.md's "authorship claims are non-negotiable".
    //
    // The `i` flag is NOT applied to the whole regex on purpose: the capture
    // leans on `[A-Z]` to tell a proper noun from ordinary prose, and making
    // that case-insensitive would read "worked at the office as a manager" as
    // an employer claim. Only the trigger words carry an explicit case class.
    ['employer', /\b(?:[Ww]orked [Aa]t|[Jj]oined|[Ee]mployer\s*:\s*|[Cc]ompany\s*:\s*)\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/g],
    // A title may carry a lowercase connector: stopping at it truncated "Head
    // of Data" to "head", which made it indistinguishable from "Head of
    // Engineering" — so an inflated title compared equal to the real one and
    // passed the gate (CodeRabbit review). The connector list is closed and
    // each one must be followed by another Capitalised word, so the capture
    // cannot wander into ordinary prose.
    //
    // #3907 — the first captured token used `[A-Z][\w/-]*`, whose `*` allows
    // a bare single capital letter to satisfy it. Ordinary prose like "...to
    // this role: I do not have..." then read the pronoun "I" as a one-letter
    // job title. The fix requires at least one more character after the
    // leading capital (`+` instead of `*`), which a real title always has —
    // even a 2-letter acronym like "VP" or "PM" still matches — while a bare
    // "I" or "A" no longer can. Only the FIRST token of each alternative is
    // tightened; the subsequent tokens in the `{0,4}` repetition keep `*`
    // because a later short word in a real multi-word title (e.g. the "AI"
    // in "Head of AI") must still be allowed.
    ['title', /\b(?:[Ss]erved [Aa]s|[Ww]orked [Aa]s|[Tt]itle\s*:\s*|[Rr]ole\s*:\s*)\s*(?:an?\s+|the\s+)?([A-Z][\w/-]+(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})|\b(?:[Ww]orked [Aa]t|[Jj]oined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+[Aa]s\s+(?:an?\s+|the\s+)?([A-Z][\w/-]+(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})/g],
    ['tool', /\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)([^.;\n]+?)(?=\s+\bfor\b|[.;\n]|$)/gi],
    // The same capture, except that a dot ends it only where no letter or
    // digit follows. The pattern above stops inside "Node.js", "ASP.NET" and
    // ".NET", so nothing after the dot was read: "using Node.js and Kafka"
    // never checked Kafka. A sentence missing the space after its period
    // ("Tableau.Grew pipeline") reads as one name here and blocks, which is
    // the fail-closed side of that ambiguity. It stays as it is beside this one rather than being
    // replaced, because reading through the dot can lengthen a fragment past
    // the three words `isLikelyTool` accepts ("Node.js's event loop on AWS
    // Lambda"), and then the name the shorter capture did check would go
    // unchecked. `dottedNamesBeforeConnector` recovers a dotted name from such
    // a fragment only when it stands as a word of its own, or is joined to
    // another by a slash.
    ['tool', /\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)((?:[^.;\n]|\.(?=[\p{L}\p{N}]))+?)(?=\s+\bfor\b|\.(?![\p{L}\p{N}])|[;\n]|$)/giu],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const rawText = kind === 'tool' ? match[1].trim() : '';
      // "Technologies:" and "tech stack:" declare a list whatever follows them.
      // The prose triggers do not: a determiner straight after "using" or
      // "worked with" means the trigger is ordinary English, so the whole clause
      // is prose and "worked with the team in London" must not yield London.
      const declaredList = kind === 'tool' && DECLARED_TOOL_TRIGGER_RE.test(match[0]);
      const rawValues = kind === 'tool'
        // A determiner LATER in a list taints only its own fragment, so filter
        // after the split and keep its siblings, including a name the gate has
        // to block (#4004).
        ? ((!declaredList && DETERMINER_LEAD_RE.test(rawText)) ? [] : toolFragments(rawText))
        : [match[1] || match[2]];
      const connectorRule = kind === 'tool' && !WORKED_WITH_RE.test(match[0]);
      for (const raw of rawValues) {
        // A later item can open with its own "using": "using React, using
        // Kubernetes". Read it after that trigger, the way the first item is
        // read, instead of dropping the item as prose for holding "using". A
        // determiner after it marks prose as it does after the first trigger,
        // so that item is read whole, as it always was.
        const afterTrigger = kind === 'tool' ? raw.replace(INNER_TOOL_TRIGGER_RE, '') : raw;
        const innerTrigger = afterTrigger !== raw && !DETERMINER_LEAD_RE.test(afterTrigger.trim());
        const fragment = innerTrigger ? afterTrigger : raw;
        if (kind !== 'tool') {
          const value = normalizeFact(fragment);
          if (value) claims.push({ kind, value });
          continue;
        }
        // A leading "a" or "an" changes nothing about whether the fragment is
        // a tool claim. It is stripped and the rest goes through the decision a
        // fragment with no article gets. Only when that decision claims the
        // whole fragment does the article matter: the names in it are claimed
        // instead, each alone, so "a Kubernetes cluster" checks "kubernetes"
        // where the source says "Kubernetes". The names are the ones
        // `toolNameRuns` reads: capitalised words, words with an inner
        // capital, words with a digit that are not a measure ("3CX", "n8n"),
        // and dotted names such as "node.js". A fragment with none of them ("a
        // small team", "a 2024 roadmap") then claims nothing, and neither does
        // a word that is only ever prose (`PROSE_FRAGMENTS`).
        const trimmed = fragment.trim();
        const article = ARTICLE_LEAD_RE.exec(trimmed);
        const subject = article ? trimToolFragment(trimmed.slice(article[0].length)) : fragment;
        const decision = toolFragmentClaims(subject, sourceNormalized, connectorRule || innerTrigger);
        // One letter left from a capture that stopped at the dot of an
        // abbreviation ("a U.S. agency" reaches here as "a U") names nothing.
        const values = article && decision.whole
          ? (/^\p{L}$/u.test(subject) ? [] : toolNameRuns(subject, { digitNames: true })
            .map(tidyToolName).filter(Boolean).map(normalizeFact).filter(name => !PROSE_FRAGMENTS.has(name)))
          : decision.values;
        for (const value of values) claims.push({ kind, value });
      }
    }
  }
  // Report each claim once. Both tool patterns read most names, so without
  // this every tool would be listed twice. Repeated employer and title claims
  // collapse too, as they already did in verifyFacts.
  const seen = new Set();
  return claims.filter(({ kind, value }) => !seen.has(`${kind}\n${value}`) && seen.add(`${kind}\n${value}`));
}

// The fields the CV builders emit as structure rather than prose (#5348).
// factClaims() reads an employer only after a prose trigger ("worked at",
// "joined", "Company:"), and a built CV never phrases its employer that way: it
// is a `job-company` span. So a payload that swapped the employer, the degree
// or a certification rendered and passed the gate, which is the fabrication
// AGENTS.md treats as most serious.
//
// Employer, education and certification fields BLOCK when no source contains
// them. The job title only WARNS: cv-title-check.mjs is deliberately warn-only
// about titles, because reframing one is sometimes the candidate's call, and a
// second check that blocked on the same field would overrule that choice.
// Skills lists are not read here. Rewording a skill into the posting's
// vocabulary is the reformulation the tailoring is allowed to do.
//
// Templates with section partials (#2183) may use other class names, and a
// markdown CV has no markup to read, so neither is covered.
const STRUCTURED_HTML_FIELDS = [
  ['job-company', 'employer', true],
  ['edu-title', 'education', true],
  ['edu-org', 'education', true],
  ['cert-title', 'certification', true],
  ['job-role', 'title', false],
];
// One level of nested braces, enough for `\textbf{...}` inside an argument.
const LATEX_ARG = String.raw`\s*\{((?:[^{}]|\{[^{}]*\})*)\}`;
// build-cv-latex.mjs writes `\resumeSubheading{organization}{…}{title or degree}{…}`
// for both experience and education, so the first argument is an employer or
// an institution and the third a role or a degree. The first blocks; the third
// is read as a title and warns, for the reason given above.
const LATEX_SUBHEADING_RE = new RegExp(String.raw`\\resumeSubheading${LATEX_ARG}${LATEX_ARG}${LATEX_ARG}${LATEX_ARG}`, 'g');

/**
 * Find balanced (span|div) elements matching an open-tag regex.
 * Yields { tag, openStart, contentStart, contentEnd, elementEnd }.
 */
function findBalancedElements(raw, openRe) {
  const elements = [];
  let openMatch;
  while ((openMatch = openRe.exec(raw)) !== null) {
    const tag = openMatch[1];
    const openStart = openMatch.index;
    const contentStart = openRe.lastIndex;
    if (openMatch[0].endsWith('/>')) {
      elements.push({ tag, openStart, contentStart, contentEnd: contentStart, elementEnd: contentStart });
      continue;
    }
    const tagRe = new RegExp(String.raw`</?${tag}\b[^>]*>`, 'gi');
    tagRe.lastIndex = contentStart;
    let depth = 1;
    let tagMatch;
    let contentEnd = -1;
    let elementEnd = -1;
    while ((tagMatch = tagRe.exec(raw)) !== null) {
      if (tagMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          contentEnd = tagMatch.index;
          elementEnd = tagRe.lastIndex;
          openRe.lastIndex = elementEnd;
          break;
        }
      } else if (!tagMatch[0].endsWith('/>')) {
        depth++;
      }
    }
    if (elementEnd !== -1) {
      elements.push({ tag, openStart, contentStart, contentEnd, elementEnd });
    }
  }
  return elements;
}

/**
 * Remove balanced elements matching openRe, replacing each with a space.
 */
function removeBalancedElements(raw, openRe) {
  const elements = findBalancedElements(raw, openRe);
  if (elements.length === 0) return raw;
  let result = '';
  let lastIndex = 0;
  for (const el of elements) {
    result += raw.slice(lastIndex, el.openStart) + ' ';
    lastIndex = el.elementEnd;
  }
  result += raw.slice(lastIndex);
  return result;
}

/**
 * Extract inner contents of structured HTML elements matching class `cls`,
 * accounting for potential nested tags of the same type (e.g. nowrap spans inside
 * a span field like job-company, or nested divs inside edu-title).
 */
function extractStructuredFieldInners(raw, cls) {
  const openRe = new RegExp(String.raw`<(span|div)\b[^>]*\bclass="[^"]*(?<![\w-])${cls}(?![\w-])[^"]*"[^>]*>`, 'gi');
  return findBalancedElements(raw, openRe).map(el => raw.slice(el.contentStart, el.contentEnd));
}

/**
 * Employer, education, certification and title claims a CV builder emitted as
 * structured fields.
 *
 * @param {string} text - generated HTML or LaTeX
 * @returns {{kind: string, value: string, line: string, blocking: boolean}[]}
 */
export function structuredFieldClaims(text) {
  const raw = latexBody(text ?? '');
  const claims = [];
  const add = (kind, inner, blocking) => {
    const line = stripMarkup(inner);
    const value = normalizeFact(line);
    if (value) claims.push({ kind, value, line, blocking });
  };
  for (const [cls, kind, blocking] of STRUCTURED_HTML_FIELDS) {
    for (const inner of extractStructuredFieldInners(raw, cls)) {
      // edu-title encloses its edu-org span or div, which is read on its own.
      // Remove the full nested classed element (accounting for inner formatting
      // spans); unclassed formatting spans like nowrap wrappers must be kept.
      const withoutEduOrg = removeBalancedElements(
        inner,
        /<(span|div)\b[^>]*\bclass="[^"]*(?<![\w-])edu-org(?![\w-])[^"]*"[^>]*>/gi,
      );
      const cleaned = removeBalancedElements(
        withoutEduOrg,
        /<span\b[^>]*\bclass="[^"]*"[^>]*>/gi,
      );
      add(kind, cleaned, blocking);
    }
  }
  for (const match of raw.matchAll(LATEX_SUBHEADING_RE)) {
    add('organization', match[1], true);
    add('title', match[3], false);
  }
  const seen = new Set();
  return claims.filter(({ kind, value }) => !seen.has(`${kind}\n${value}`) && seen.add(`${kind}\n${value}`));
}

/** Split generated/source documents into bounded statements for attribution checks. */
function factStatements(text) {
  const withLineBoundaries = String(text ?? '').replace(/\r?\n+/g, '. ');
  return stripMarkup(withLineBoundaries)
    .split(/(?:[.!?]\s+|[.!?]$)/u)
    .map(statement => statement.trim())
    .filter(Boolean);
}

/** Return conservative content tokens used only to link a rewrite to its source statement. */
function attributionTokens(text) {
  return normalizeFact(text)
    .split(/[^\p{L}\p{N}+#./-]+/u)
    .filter(token => token.length >= 3 && !ATTRIBUTION_STOP_WORDS.has(token));
}

/**
 * Detect a narrow authorship escalation: a source explicitly attributes
 * execution to a third party, while the generated rewrite claims direct
 * implementation and drops that attribution.
 *
 * This deliberately does not guess from generic leadership prose. It requires
 * a delegation verb, a named third-party role, and at least two shared content
 * tokens between the source and generated statements. Ambiguous source
 * statements that also contain a direct implementation verb are left alone;
 * an explicit relative clause such as "vendor X, which built Y" is treated as
 * third-party execution evidence rather than candidate direct-work evidence.
 */
export function delegatedAuthorshipClaims(targetText, sourceText) {
  const sourceStatements = factStatements(sourceText);
  const directSources = sourceStatements
    .filter(statement => DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement))
    .filter(statement => !THIRD_PARTY_EXECUTION_RE.test(statement))
    .map(statement => new Set(attributionTokens(statement)));
  const delegatedSources = sourceStatements
    .filter(statement => DELEGATED_PARTY_RE.test(statement) && DELEGATION_RE.test(statement))
    .filter(statement => (
      !DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement) || THIRD_PARTY_EXECUTION_RE.test(statement)
    ))
    .map(statement => ({
      statement,
      tokens: new Set(attributionTokens(statement)),
    }));
  if (!delegatedSources.length) return [];

  const claims = [];
  for (const statement of factStatements(targetText)) {
    // Keeping the third-party attribution is not an authorship escalation.
    if (DELEGATED_PARTY_RE.test(statement)) continue;
    DIRECT_AUTHORSHIP_CLAIM_RE.lastIndex = 0;
    for (const match of statement.matchAll(DIRECT_AUTHORSHIP_CLAIM_RE)) {
      const value = normalizeFact(`${match[1]} ${match[2]}`);
      const tokens = [...new Set(attributionTokens(match[2]))];
      if (tokens.length < 2) continue;
      // Explicit direct-work evidence wins over a nearby delegated project
      // that happens to use the same technology or artifact vocabulary.
      if (directSources.some(source => tokens.filter(token => source.has(token)).length >= 2)) {
        continue;
      }
      const delegatedSource = delegatedSources.find(source => (
        tokens.filter(token => source.tokens.has(token)).length >= 2
      ));
      if (delegatedSource) {
        claims.push({ kind: 'authorship', value });
      }
    }
  }
  return claims.filter((claim, index, all) => (
    all.findIndex(other => other.value === claim.value) === index
  ));
}

// A PLAN HORIZON is the window a candidate proposes to work in, and it asserts
// nothing about the past:
//
//   "I'd welcome the chance to talk through how I'd approach the first 90 days"
//
// The time units it uses belong in METRIC_NOUNS -- "cut deployment time to 2
// days" and "saved 20 hours a week" are exactly the claims this gate exists to
// check -- so the stock cover-letter closing above was extracted as the claim
// "90 days" and reported as unsupported. No source can ever evidence a proposal,
// so the only remedy was an allow_metrics entry per phrasing, and every fresh
// wording came back red.
//
// Two signals are required together, and each alone would silence a real claim:
//
//   - a horizon LEAD adjacent to the number ("the first", "my next"). Alone it
//     would swallow "revenue grew in the first 12 months", a past-tense claim.
//   - a FORWARD marker in the same sentence: one of the four modals that frame
//     a proposal (would, will, shall, should), a contracted 'd/'ll, or an
//     explicit intent verb. Ability and possibility modals (can, could, may,
//     might) are deliberately out, since they frame what is possible rather
//     than what is planned. Alone this half would swallow "I would bring 20
//     years of experience", where the number is a real claim inside a
//     hypothetical sentence.
//
// CLAUSE-scoped on purpose. Document-scoped, one conditional courtesy line
// would silence every time-unit claim in the letter; sentence-scoped, a marker in
// a later clause ("...in the first 99 months, and I would be glad to repeat it")
// silences a fabricated PAST number, which is the direction this gate exists to
// prevent. A newline ends a clause, so a soft-wrapped letter cannot join two.
const TIME_NOUNS = new Set(['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds']);
const HORIZON_LEAD_RE = /\b(?:the|my|our|your)?\s*(?:first|next)\s+$/i;
// `'d` is "had" as often as "would", so it only counts when the verb after it is
// not a past participle. The -ed test is a heuristic: an irregular participle
// ("I'd built the first 12 months") still reads as a marker, which is why the
// clause scope below carries the weight rather than this test alone.
const FORWARD_MARKER_RE = /\b(?:would|will|shall|should)\b|['\u2019]d\b(?!\s+[A-Za-z]+ed\b)|['\u2019]ll\b|\b(?:plan|plans|planning|intend|intends)\s+to\b|\bgoing to\b|\blooking forward\b/i;

// A DISCLOSED REQUIREMENT is a number the candidate cites from the POSTING
// itself, in order to disclaim a gap against it -- nothing about the candidate
// is being asserted:
//
//   "my background is at the individual-contributor level, without the 7+
//   years of progressive L&D leadership ... this role's scope calls for"
//
// COUNT_CLAIM_RE reads that as the candidate personally claiming "7 years",
// which cv.md never says, and the fact gate blocks generation over a number
// that was only ever cited to be disclaimed (#3915).
//
// Two signals, EITHER of which is sufficient alone, mirroring the two-signal
// design of the plan-horizon exception above -- but here each signal stands on
// its own, because each already names a THIRD PARTY's threshold rather than
// merely gesturing at time:
//
//   - a REQUIREMENT CITATION anywhere in the same clause as the number,
//     naming what the posting/role/position/job asks for ("this role's scope
//     calls for", "the posting requires", "this position calls for", "this
//     job wants").
//   - a NEGATION LEAD immediately before the number ("without (the)",
//     "lacking", "don't have (the)", "doesn't have (the)", "do not have
//     (the)") -- the candidate stating what they do NOT have.
//
// Clause-scoped for the same reason as the plan-horizon exception: a citation
// elsewhere in the letter must not silence an unrelated number. A genuine
// personal claim carries NEITHER signal -- "I have 12 years of experience" has
// no negation lead and no role/posting/position/job citation nearby, and
// "I bring 7+ years of L&D leadership" is the same shape -- so both are left
// alone and still get checked against the sources.
const REQUIREMENT_CITATION_RE = /\b(?:role|posting|position|job)\b[^.,;:!?\n]{0,30}\b(?:calls?\s+for|requires?|asks?\s+for|wants?)\b/gi;
const NEGATION_LEAD_RE = /\b(?:without(?:\s+the)?|lack(?:ing)?(?:\s+the)?|don['\u2019]?t\s+have(?:\s+the)?|doesn['\u2019]?t\s+have(?:\s+the)?|do\s+not\s+have(?:\s+the)?)\s*$/i;

/**
 * The CLAUSE of `text` containing `index`.
 *
 * Bounded by `. ! ? , ; :` and by a newline, so a marker in a neighbouring
 * clause cannot reach the number: "grew in the first 99 months, and I would be
 * glad to repeat it" keeps its claim, and so does the same pair soft-wrapped
 * across two lines. A separator BETWEEN DIGITS is not a boundary, or the clause
 * around "1.5 years" would end inside the number and lose its own marker.
 *
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function clauseBounds(text, index, { extendCoordinated = true } = {}) {
  const isBoundary = (i) => {
    const c = text[i];
    if (c === '\n') return true;
    if (c !== '.' && c !== '!' && c !== '?' && c !== ',' && c !== ';' && c !== ':') return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  };
  const isSentenceEnd = (i) => {
    const c = text[i];
    if (c === '\n') return true;
    if (c !== '.' && c !== '!' && c !== '?') return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  };
  let start = 0;
  for (let i = index - 1; i >= 0; i--) if (isBoundary(i)) { start = i + 1; break; }
  let end = text.length;
  for (let i = index; i < text.length; i++) if (isBoundary(i)) { end = i; break; }
  // A clause opened by a coordinator continues the one before it, and a plan
  // stated once governs both halves: "I'd approach the first 90 days by
  // listening, and the first 30 days by shipping". The lookback stops at a
  // SENTENCE end, so it can never reach across "…first 99 months. I would…".
  if (extendCoordinated && /^\s*(?:and|or|then|plus)\b/i.test(text.slice(start, end))) {
    let sentenceStart = 0;
    for (let i = start - 1; i >= 0; i--) if (isSentenceEnd(i)) { sentenceStart = i + 1; break; }
    return { start: sentenceStart, end };
  }
  return { start, end };
}

/**
 * The CLAUSE of `text` containing `index`.
 *
 * Bounded by `. ! ? , ; :` and by a newline, so a marker in a neighbouring
 * clause cannot reach the number: "grew in the first 99 months, and I would be
 * glad to repeat it" keeps its claim, and so does the same pair soft-wrapped
 * across two lines. A separator BETWEEN DIGITS is not a boundary, or the clause
 * around "1.5 years" would end inside the number and lose its own marker.
 *
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function clauseAround(text, index) {
  const { start, end } = clauseBounds(text, index);
  return text.slice(start, end);
}

/**
 * Whether `match` is a number the candidate is citing from the posting's own
 * stated requirement (to disclaim a gap against it), rather than a personal
 * claim about themself. See the REQUIREMENT_CITATION_RE / NEGATION_LEAD_RE
 * commentary above for the two independent signals this checks.
 *
 * `allMatches` is every COUNT_CLAIM_RE hit in the document, not just this one.
 * A citation names ONE requirement, and when two numbers share an undivided
 * clause with no comma/semicolon between them -- "I have 12 years of
 * experience but this role requires 7 years" -- testing the citation against
 * the WHOLE clause would suppress BOTH, quietly waving through a genuinely
 * fabricated "12 years" personal claim alongside the correctly-cited "7
 * years" (flagged in review of #3917). Instead, each citation is bound
 * directionally: an immediately preceding count in "7 years this role
 * requires" belongs to the citation; otherwise bind the first count after the
 * citation phrase, falling back to the nearest preceding count when none
 * follows. Here that binds "7", while "12" gets no citation match and is left
 * to the normal source check like any other claim.
 *
 * @param {string} clean
 * @param {RegExpMatchArray} match
 * @param {RegExpMatchArray[]} allMatches
 * @returns {boolean}
 */
function isDisclosedRequirement(clean, match, allMatches) {
  const lead = clean.slice(Math.max(0, match.index - 40), match.index);
  if (NEGATION_LEAD_RE.test(lead)) return true;

  const { start, end } = clauseBounds(clean, match.index);
  const clause = clean.slice(start, end);
  REQUIREMENT_CITATION_RE.lastIndex = 0;
  const citations = [...clause.matchAll(REQUIREMENT_CITATION_RE)];
  if (!citations.length) return false;

  const numbersInClause = allMatches.filter((m) => m.index >= start && m.index < end);
  if (!numbersInClause.length) return false;

  return citations.some((citation) => {
    const citationStart = start + citation.index;
    const citationEnd = start + citation.index + citation[0].length;
    const preceding = numbersInClause.filter((m) => m.index < citationStart).at(-1);
    const precedingEnd = preceding ? preceding.index + preceding[0].length : citationStart;
    const precedingGap = clean.slice(precedingEnd, citationStart);
    const precedesCitation = preceding && (
      /^\s*(?:this|that|the)?\s*$/i.test(precedingGap)
      || (
        /\b(?:this|that)\s*$/i.test(precedingGap)
        && !/[,;:]|\b(?:and|but)\b/i.test(precedingGap)
      )
    );
    const following = numbersInClause.find((m) => m.index >= citationEnd);
    const cited = precedesCitation ? preceding : (following ?? preceding);
    return cited?.index === match.index;
  });
}

// An EMPLOYER FIGURE is a number about the company the letter is addressed to,
// not about the candidate: "your team ran four regional sessions in July". The
// candidate asserts nothing about themself, and cv.md can never contain it, so
// requiring a source for it blocks every cover letter that cites what the
// employer actually did, which is most of what makes a letter specific.
//
// One signal, clause-scoped like the two above: the nearest subject pronoun
// before the number is second person ("your", "you", "you're") rather than
// first ("I", "my", "we"). Nearest, not merely present, so the same clause can
// hold both a third-party figure and a personal claim and each gets the right
// verdict: "your team ran four sessions and I have three years" exempts the
// first and still checks the second, and "I ran four sessions for your team"
// stays a personal claim because "your" comes after the number.
//
// "your" and a bare "you" are only a subject when nothing first-person governs
// them: in "I managed your 12 engineers" or "I worked with you for 12 years" the
// candidate is the subject and the second-person word is a possessive or an
// object, so the count stays a personal claim. The contractions ("you've",
// "you're", ...) are always subjects and need no such check. A
// complementizer between the two ("I read that your team ran four sessions",
// "I admire how your team grew") starts a new clause whose subject is "your
// team", so that case is still an employer figure. Where the two cannot be told
// apart ("I saw your team ran four sessions", or a coordinated "I shipped 4
// integrations and you shipped 12") the count stays checked: treating "and you" as
// a new clause would also exempt "I thanked Sam and you for 12 years".
const SECOND_PERSON_RE = /\b(?:your|yours|you|you['\u2019](?:re|ve|ll|d))\b/gi;
const FIRST_PERSON_RE = /\b(?:I|I['\u2019](?:m|ve|ll|d)|me|my|mine|myself|we|we['\u2019](?:re|ve|ll|d)|our|ours)\b/gi;
const BARE_SECOND_PERSON_RE = /^(?:you|yours?)$/i;
// Must END the text between the two words: it has to introduce the pronoun
// directly ("that your team"), not merely appear earlier ("because of you").
const COMPLEMENTIZER_RE = /\b(?:that|how|what|when|where|why|because|since|while|as|if|whether)\s*$/i;

/**
 * Whether `match` is a number about the addressed employer (second-person
 * subject nearest before it) rather than a claim about the candidate. See the
 * SECOND_PERSON_RE / FIRST_PERSON_RE commentary above.
 *
 * @param {string} clean
 * @param {RegExpMatchArray} match
 * @returns {boolean}
 */
function isEmployerFigure(clean, match) {
  // The plain clause: a clause opened by "and" must not borrow the previous
  // clause's "your" ("I admire your team, and ran four sessions").
  const { start } = clauseBounds(clean, match.index, { extendCoordinated: false });
  const before = clean.slice(start, match.index);
  const second = [...before.matchAll(SECOND_PERSON_RE)].at(-1);
  if (!second) return false;
  const firsts = [...before.matchAll(FIRST_PERSON_RE)];
  // A first-person word nearer the number than the second-person one: the
  // candidate is the nearest subject.
  if (firsts.some((m) => m.index > second.index)) return false;
  const first = firsts.at(-1);
  if (!first || !BARE_SECOND_PERSON_RE.test(second[0])) return true;
  return COMPLEMENTIZER_RE.test(before.slice(first.index + first[0].length, second.index));
}

/**
 * Count-claim matches in `clean`, minus the ones that assert nothing.
 *
 * Shared by metricClaims and diagnoseCoverage so the two cannot disagree about
 * whether a document contained a readable count.
 *
 * @param {string} clean
 * @returns {RegExpMatchArray[]}
 */
function countMatches(clean, { keepPlanHorizons = false } = {}) {
  COUNT_CLAIM_RE.lastIndex = 0;
  const allMatches = [...clean.matchAll(COUNT_CLAIM_RE)];
  return allMatches.filter((match) => {
    if (isDisclosedRequirement(clean, match, allMatches)) return false;
    if (isEmployerFigure(clean, match)) return false;
    if (keepPlanHorizons) return true;
    if (!TIME_NOUNS.has(match[2].toLowerCase())) return true;
    const lead = clean.slice(Math.max(0, match.index - 40), match.index);
    if (!HORIZON_LEAD_RE.test(lead)) return true;
    return !FORWARD_MARKER_RE.test(clauseAround(clean, match.index));
  });
}

// Scope-of-ownership verbs, ranked. A CV that upgrades the verb without
// upgrading the evidence reads as a fact and is not one: "led the migration"
// against a source that says "contributed to the migration" is the case that
// prompted #3685, and the numeric gate above cannot see it because no number
// changed.
//
// The three tiers are the ones #3685 fixes. Inflections are listed because the
// tier of a claim is a property of the verb, not of its conjugation, and a
// table that only knew `led` would be bypassed by `leads` or `leading`.
//
// `driven` is left out on purpose. At the start of a line it is the adjective
// ("Driven backend engineer"), never the verb, so it claimed an ownership the
// line does not assert.
const SCOPE_VERB_TIERS = new Map([
  // Tier 1 — participation. Someone else owned the outcome.
  ['contribute', 1], ['contributed', 1], ['contributes', 1], ['contributing', 1],
  ['help', 1], ['helped', 1], ['helps', 1], ['helping', 1],
  ['support', 1], ['supported', 1], ['supports', 1], ['supporting', 1],
  // Tier 2 — execution. Did the work, without claiming the mandate.
  ['build', 2], ['built', 2], ['builds', 2], ['building', 2],
  ['implement', 2], ['implemented', 2], ['implements', 2], ['implementing', 2],
  ['design', 2], ['designed', 2], ['designs', 2], ['designing', 2],
  // Tier 3 — ownership. Claims the mandate as well as the work.
  ['lead', 3], ['led', 3], ['leads', 3], ['leading', 3],
  ['own', 3], ['owned', 3], ['owns', 3], ['owning', 3],
  ['architect', 3], ['architected', 3], ['architects', 3], ['architecting', 3],
  ['drive', 3], ['drove', 3], ['drives', 3], ['driving', 3],
]);

// Bullet glyphs and list markers survive stripMarkup. They have to come off
// before the "opens with" test can see the verb, and before a claim value is
// built: an allow_facts entry a user would actually write ("led the migration")
// can never match a value that still carries its "- " prefix, which would leave
// the documented escape hatch unusable on any real bulleted CV.
const LIST_MARKER_RE = /^[\s•‣◦⁃∙*+-]+/u;

/** Drop a leading list marker so a bullet and a plain sentence read the same. */
function stripListMarker(statement) {
  return String(statement ?? '').replace(LIST_MARKER_RE, '').trim();
}

/** The opening verb of a statement, with its tier, or null when it opens with neither. */
function openingScopeVerb(statement) {
  const text = stripListMarker(statement);
  const opening = text.match(/^([\p{L}]+)/u);
  if (!opening) return null;
  const verb = opening[1].toLowerCase();
  const tier = SCOPE_VERB_TIERS.get(verb);
  if (!tier) return null;
  // "Led to" is causation, not ownership: "led to a 40% speedup" claims a
  // result, not a mandate. Only reachable now that the target side is split
  // into clauses, which puts a mid-sentence "and led to ..." at the start of
  // one, where it would otherwise read as a tier-3 ownership claim.
  if (/^(?:lead|leads|leading|led)\s+to\b/i.test(text)) return null;
  if (opensWithJobTitle(text)) return null;
  return { verb, tier };
}

// "Lead backend engineer for the billing migration", "Architect for the
// payments platform": the bare form opening a line is a job title, not a verb,
// the same reason `driven` is left out of the table. Read as a verb it claimed
// tier-3 ownership the line never asserts and blocked a truthful CV whose
// source said "Contributed to the billing migration".
//
// Only the bare forms can be a title, and only in two shapes: followed straight
// by a preposition ("Architect for ...", "Lead on ..."), or by a role noun
// within the next few words with no determiner in between ("Lead backend
// engineer"). A determiner is what marks the verb: "Lead the platform team",
// "Lead a team of engineers" are present-tense ownership claims and stay
// checked. The role noun is singular on purpose, so "Lead engineers through
// the migration" still reads as the verb it is.
const TITLE_BARE_FORM_RE = /^(?:lead|architect)$/iu;
const TITLE_PREPOSITIONS = new Set(['for', 'on', 'of', 'at', 'in', 'with']);
const TITLE_DETERMINERS = new Set([
  'the', 'a', 'an', 'our', 'my', 'their', 'its', 'his', 'her', 'this', 'that',
  'these', 'those', 'all', 'every', 'each', 'both', 'two', 'three', 'four', 'five',
]);
const TITLE_ROLE_NOUNS = new Set([
  'engineer', 'developer', 'designer', 'architect', 'manager', 'scientist',
  'analyst', 'consultant', 'programmer', 'researcher', 'administrator',
  'specialist', 'strategist', 'technologist', 'tester', 'writer',
]);
const TITLE_LOOKAHEAD_WORDS = 3;

/** True when a statement opens with "Lead"/"Architect" used as a job title, not as a verb. */
function opensWithJobTitle(text) {
  const words = String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 2 || !TITLE_BARE_FORM_RE.test(words[0])) return false;
  if (TITLE_PREPOSITIONS.has(words[1])) return true;
  for (const word of words.slice(1, 1 + TITLE_LOOKAHEAD_WORDS)) {
    if (TITLE_DETERMINERS.has(word) || /^\p{N}/u.test(word)) return false;
    if (TITLE_ROLE_NOUNS.has(word)) return true;
  }
  return false;
}

// Tier evidence a single word cannot carry. "Worked on" is the participation
// wording #3685 names alongside "contributed to", but `worked` alone is the
// ordinary verb of employment: "Worked at Acme Labs" asserts a job, not a
// scope, and scoring it as tier 1 would make every employer line evidence that
// the candidate merely participated in whatever it linked to.
const SCOPE_PHRASE_TIERS = [
  [/^worked\s+on\b/iu, 1],
  [/^part\s+of\s+the\s+team\b/iu, 1],
];

const HEADING_RE = /^#{1,6}\s+/u;
// First-person prose in article-digest.md opens with the subject, not the verb.
const SUBJECT_PRONOUN_RE = /^(?:i|we)\s+/iu;

// A clause, for scope purposes, is one work item and the verb that governs it.
// Splitting on coordinators is the point: a source sentence can pair a weak
// verb with one item and a strong verb with another, and the strong half must
// not vouch for the weak one.
//
// This deliberately differs from `clauseAround` above, which JOINS a
// coordinator-led clause to the one before it because a stated plan governs
// both halves. A verb does not: "Contributed to the billing migration and led
// the payments rewrite" makes exactly one tier-3 claim, about the rewrite.
const SCOPE_CLAUSE_SPLIT_RE = /\s*[,;:]\s*|\s+(?:and|then|plus|while|before|after)\s+/iu;

/** Split a statement into clauses, so a verb is weighed only against its own work item. */
function scopeClauses(statement) {
  return String(statement ?? '')
    .split(SCOPE_CLAUSE_SPLIT_RE)
    .map(clause => clause.trim())
    .filter(Boolean);
}

/**
 * The scope tier a source clause gives its work item.
 *
 * Read from the verb the clause OPENS with, the rule the target side already
 * uses. Reading the first tier word anywhere let a noun stand in for the verb:
 * "Developed the customer support dashboard" scored tier 1 on `support` and
 * blocked a truthful "Built the customer support dashboard".
 *
 * A clause that opens with a verb outside the table ("Developed", "Managed")
 * cannot be ranked, so it supports the claim (Infinity) instead of being
 * dropped. The gate blocks only on positive evidence that the source is weaker,
 * and an unranked verb is not that evidence.
 *
 * A markdown heading has no verb. It names a role or a work item, so it takes
 * its strongest tier word: "### Customer Support Lead" supports a tier-3 claim
 * and "### Billing migration" supports nothing. Read as an unranked verb, any
 * heading that names a work item would vouch for every claim about it,
 * including "Led the migration" over "Contributed to the migration".
 */
function sourceClauseTier(clause, heading) {
  const text = stripListMarker(clause).replace(HEADING_RE, '');
  if (heading) {
    let tier = 0;
    for (const match of text.matchAll(/[\p{L}]+/gu)) {
      tier = Math.max(tier, SCOPE_VERB_TIERS.get(match[0].toLowerCase()) ?? 0);
    }
    return tier;
  }
  const opening = text.replace(SUBJECT_PRONOUN_RE, '');
  for (const [pattern, tier] of SCOPE_PHRASE_TIERS) {
    if (pattern.test(opening)) return tier;
  }
  return openingScopeVerb(opening)?.tier ?? Infinity;
}

/** Content tokens of a statement, with scope verbs removed so a tier word cannot link two entries. */
function scopeObjectTokens(text) {
  return attributionTokens(text).filter(token => !SCOPE_VERB_TIERS.has(token));
}

/**
 * Detect scope-verb inflation: the generated document opens a bullet with a
 * stronger ownership verb than the source evidence for the same entry carries.
 *
 * Entries are linked by shared content tokens rather than by heading, the same
 * mechanism `delegatedAuthorshipClaims` uses. `stripMarkup` removes headings
 * before any check sees the text, so a heading-based match would need a second
 * segmentation path for each of md/html/tex.
 *
 * Deliberately one-directional. A claim is reported only on positive evidence
 * that the source is weaker: if any linked source statement carries an equal or
 * stronger verb, or if nothing links at all, the bullet is left alone. An
 * unsourced bullet is a different defect and belongs to the checks above.
 */
export function scopeInflationClaims(targetText, sourceText) {
  // Scoped per CLAUSE, not per statement. A statement-wide tier let the
  // strongest verb in a sentence vouch for every work item in it, so
  // "Contributed to the billing migration and led the payments rewrite"
  // cleared "Led the billing migration" on the strength of a verb that was
  // never about the migration.
  const sourceClauses = factStatements(sourceText)
    .map(stripListMarker)
    .flatMap((statement) => {
      const heading = HEADING_RE.test(statement);
      return scopeClauses(statement).map(clause => ({
        // The whole statement is what gets quoted back, since a clause on its own
        // reads as a fragment to whoever has to go and fix cv.md.
        statement,
        heading,
        tier: sourceClauseTier(clause, heading),
        tokens: new Set(scopeObjectTokens(clause)),
      }));
    })
    .filter(source => source.tokens.size);
  if (!sourceClauses.length) return [];

  const claims = [];
  for (const raw of factStatements(targetText)) {
    const statement = stripListMarker(raw);
    // Clause-scoped on BOTH sides. Reading only the statement-initial verb
    // skipped a compound bullet entirely: "Contributed to the billing
    // migration and led the payments rewrite" opens at tier 1, and the tier-3
    // half was never compared to anything. It also skipped any bullet opening
    // with a modifier, since factStatements does not split on commas, so
    // "As tech lead, drove the migration" was invisible.
    for (const clause of scopeClauses(statement)) {
      const opening = openingScopeVerb(clause);
      // Tier 1 is participation, so it cannot be an escalation of anything: the
      // check is for bullets that claim execution or ownership.
      if (!opening || opening.tier < 2) continue;
      // DISTINCT tokens. `overlap` below counts matches rather than distinct
      // matches, so a clause that repeats a word reached the two-token
      // threshold on the strength of one shared token: "Owned the payments
      // platform migration to payments v2" counted `payments` twice and linked
      // to a source saying only "Contributed to payments", blocking a truthful
      // bullet on an unrelated line. It also mis-sized `required`, since a
      // short clause repeating its only token looked like two.
      //
      // The source side has always wrapped in a Set, and
      // `delegatedAuthorshipClaims` dedupes its tokens the same way.
      const tokens = [...new Set(scopeObjectTokens(clause))];
      if (!tokens.length) continue;

      // Two shared tokens, the threshold `delegatedAuthorshipClaims` uses, except
      // where the bullet has only one token to share. On one token alone,
      // "Designed the onboarding automation" linked to "Supported the onboarding
      // revamp for new hires" and reported two unrelated work items as one
      // inflated claim. The single-token case is kept because a short bullet is
      // the issue's own example: "Led the migration" against "Contributed to the
      // migration" shares exactly `migration`, and it is 100% of what the bullet
      // says rather than a fragment of it.
      const required = Math.min(2, tokens.length);
      const overlaps = sourceClauses.map(source => ({
        source,
        overlap: tokens.filter(token => source.tokens.has(token)).length,
      }));

      // Two thresholds, because the two questions pull in opposite directions.
      // A link that ACCUSES has to be strict, since a wrong one invents an
      // inflation. A link that VOUCHES has to be loose, since a missed one
      // invents the same thing. Using the strict threshold for both made
      // "I led that payments effort end to end" fail to rescue "Led the payments
      // rewrite", because the restatement shared only `payments`.
      // A heading only vouches. It names the item without saying what the
      // candidate did, so it is no evidence that the source is weaker.
      const linked = overlaps.filter(({ overlap, source }) => overlap >= required && !source.heading);
      if (!linked.length) continue;
      const vouched = overlaps.some(({ overlap, source }) => overlap > 0 && source.tier >= opening.tier);
      if (vouched) continue;

      const closest = linked.reduce((best, next) => (next.overlap > best.overlap ? next : best));
      claims.push({
        kind: 'scope',
        // The clause is the claim; the whole bullet is what gets quoted back,
        // since a clause on its own reads as a fragment to whoever fixes cv.md.
        value: normalizeFact(clause),
        line: statement,
        sourceLine: closest.source.statement,
      });
    }
  }
  return claims.filter((claim, index, all) => (
    all.findIndex(other => other.value === claim.value) === index
  ));
}

// Adoption and reach assertions, which read as measured facts while naming no
// number the metric gate could check. The list is #3685's, kept short on
// purpose: every entry states that other people depend on the work, which is
// exactly the claim a reader would try to verify with a reference.
//
// `across the ... org` carries a small window because the real phrasing names
// the org ("across the engineering org"), and a literal `across the org` would
// have missed the case the issue was filed for.
// Each check pairs the wording to CATCH with the wording that COUNTS AS
// EVIDENCE for it, and the two are deliberately not the same regex.
//
// Requiring the source to repeat the CV's exact phrasing made the gate
// punish paraphrase, which is the one thing a tailored CV always does:
// "Adopted by 3 teams" blocked against a source saying "Three teams adopted
// the tool", and "company-wide" blocked against "across the whole company".
// The source side is therefore a lemma, loose on purpose. It can only ever
// silence a claim, never raise one, so the asymmetry costs a missed catch at
// worst and buys back every truthful restatement.
const ADOPTION_CHECKS = [
  {
    target: /\bused\s+daily\b/giu,
    source: /\bdaily\b/iu,
  },
  {
    target: /\bacross\s+the\s+(?:[\p{L}-]+\s+){0,2}org(?:ani[sz]ations?)?\b/giu,
    source: /\bacross\s+the\b[^.;!?]{0,40}\b(?:org|organi[sz]ations?|company|business)\b|\b(?:company|org(?:ani[sz]ation)?)[-\s]?wide\b/iu,
  },
  {
    // One check for both spellings. `org-wide` alone missed
    // `organization-wide` and `organisation-wide`, so an unsourced reach claim
    // walked straight through the gate.
    target: /\b(?:company|org(?:ani[sz]ation)?)[-\s]?wide\b/giu,
    source: /\b(?:company|org(?:ani[sz]ation)?)[-\s]?wide\b|\bacross\s+the\s+(?:whole\s+|entire\s+)?(?:company|org(?:ani[sz]ation)?)\b/iu,
  },
  {
    target: /\badopted\s+by\b/giu,
    source: /\badopt(?:ed|s|ing|ion)?\b/iu,
  },
  {
    target: /\bstandard\s+across\b/giu,
    // Inflection-tolerant like the other four. The bare word alone did not
    // match the wording a source most often uses for this claim, so
    // "Standardised the linter across every team" failed to evidence
    // "Became standard across the platform teams" and blocked a truthful line.
    source: /\bstandards?\b|\bstandardi[sz](?:e|es|ed|ing|ation)\b/iu,
  },
];

/**
 * Detect adoption or reach claims the sources never make.
 *
 * Matched per pattern rather than per exact phrase, so a source that states
 * adoption in its own words still supports the generated wording. Checked
 * against the whole source text rather than the linked entry: entry-level
 * scoping would need the heading segmentation noted above, and the looser test
 * only ever reports fewer claims, which is the safe direction for a gate that
 * blocks generation.
 */
export function adoptionClaims(targetText, sourceText) {
  const source = stripMarkup(sourceText);
  // Matched per STATEMENT, not across the whole flattened document. Collapsing
  // the target first let a phrase form across a line break that neither line
  // contains, so "...we used" followed by "Daily standups ran on it" reported
  // `used daily` and then had no CV line to quote back, blocking generation
  // with nothing for the user to go and fix.
  const statements = factStatements(targetText).map(stripListMarker);
  const claims = [];
  for (const { target, source: evidence } of ADOPTION_CHECKS) {
    if (evidence.test(source)) continue;
    for (const statement of statements) {
      target.lastIndex = 0;
      for (const match of statement.matchAll(target)) {
        claims.push({
          kind: 'adoption',
          value: normalizeFact(match[0]),
          line: statement,
          sourceLine: null,
        });
      }
    }
  }
  return claims.filter((claim, index, all) => (
    all.findIndex(other => other.value === claim.value) === index
  ));
}

/**
 * Fold a spelled-out magnitude onto the suffix the claim set compares.
 *
 * metricClaims() builds the claim key as `<number><magnitude> <noun>`, so
 * "50 million users" and "50M users" only compare equal when both sides reach the
 * same magnitude token. normalizeClaim() lowercases the adjacent-suffix branch on
 * its own; this covers the spelled one, and leaves a number with no magnitude —
 * and a number whose trailing word is not a magnitude at all — untouched.
 *
 * @param {string} raw
 * @returns {string}
 */
function compactMagnitude(raw) {
  return raw.replace(/\s+([A-Za-z]+)$/, (whole, word) => {
    const suffix = SPELLED_MAGNITUDES.get(word.toLowerCase());
    return suffix === undefined ? whole : suffix;
  });
}

/** Extract metric-like claims that require source evidence. */
export function metricClaims(text, { keepPlanHorizons = false } = {}) {
  const clean = spellNumbers(stripMarkup(text, { keepLineBreaks: true }));
  const claims = new Set();
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const match of clean.matchAll(pattern)) claims.add(canonicalMetric(match[0]));
  }
  for (const match of countMatches(clean, { keepPlanHorizons })) {
    const noun = match[2].toLowerCase();
    claims.add(normalizeClaim(`${compactMagnitude(match[1])} ${NOUN_SYNONYMS.get(noun) ?? noun}`));
  }
  return claims;
}

// A number counting a word, in ANY script — the language-agnostic SHAPE of the
// claims COUNT_CLAIM_RE recognises only when the noun happens to be English.
// Used solely to answer "were there count claims this gate could not read?",
// never to build a claim: it has no lexicon, so it cannot say what was counted.
const GENERIC_COUNT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d[\d,.]*)\s*\+?\s*(?:[\p{L}][\p{L}\p{M}-]*[\s]+){0,${MODIFIER_WINDOW}}([\p{L}][\p{L}\p{M}]{2,})`,
  'giu',
);
// A year is not a count. "Led the 2024 migration" is the shape above and none
// of its meaning, and every CV has several.
const YEAR_LIKE = /^(?:19|20)\d{2}$/;

/**
 * Count-shaped spans in `text`, whatever language it is written in.
 *
 * @param {string} text
 * @returns {string[]}
 */
function countShapedSpans(text) {
  const clean = stripMarkup(String(text ?? ''));

  // Ranges the language-neutral patterns already own. "$120k and closed a
  // $90,000 deal" is currency followed by prose, and reads as two counts to a
  // detector that only knows "digits, then a word" — but those amounts ARE
  // checked, in every language, so reporting them as unread is a false alarm.
  // Derived from SIMPLE_CLAIM_PATTERNS rather than re-guessed, so the two
  // cannot drift.
  const covered = [];
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const m of clean.matchAll(pattern)) covered.push([m.index, m.index + m[0].length]);
  }
  const alreadyChecked = (i) => covered.some(([from, to]) => i >= from && i < to);

  const out = [];
  for (const m of clean.matchAll(GENERIC_COUNT_RE)) {
    if (YEAR_LIKE.test(m[1].replace(/[,.]/g, ''))) continue;
    // The digits are what a simple pattern would have claimed, so test their
    // position, not the span's — the span starts at the number either way, but
    // a currency match starts one character earlier, at the symbol.
    if (alreadyChecked(m.index) || alreadyChecked(m.index + m[0].indexOf(m[1]))) continue;
    out.push(m[0].trim());
  }
  return out;
}

/**
 * Whether this document contains count claims the extractor could not read.
 *
 * METRIC_NOUNS is an English word list with German and French forms added.
 * Percentages, currency and multipliers are language-neutral and still checked
 * everywhere — but a COUNT is checked only in those three languages, and this
 * file's own METRIC_NOUNS comment names counts as the class that gets inflated:
 * "Managed 45 staff against a source saying 20 passed the gate silently, which
 * is the exact fabrication class this script exists to catch."
 *
 * For a CV written in one of the market languages the project ships modes for,
 * that sentence is true of EVERY count, not only the ones outside the list:
 *
 *   ES  "Gestioné 45 empleados en 3 instalaciones."  -> 0 count claims, pass
 *   DE  "Leitete 45 Mitarbeiter an 3 Standorten."    -> 0 count claims, pass
 *   JA  "3拠点で45名のスタッフを管理。"                   -> 0 count claims, pass
 *
 * AGENTS.md makes non-English output a first-class case (`language.output`
 * governs "reports, tracker notes, PDFs, cover letters ... any user-visible
 * prose"), so this is not an edge.
 *
 * Reporting it rather than blocking is the same choice jd-skill-gap.mjs's
 * diagnoseExtraction() and story-provenance-check.mjs's diagnose() make, and
 * for the reason story-provenance states outright: so "an empty/near-empty
 * result isn't misread as 'scanned and clean'". Blocking instead would fail
 * every non-English document, trading a silent gap for a wall.
 *
 * DELIBERATELY CONSERVATIVE. It fires only when the document has two or more
 * count-shaped spans and the extractor produced NO count claim at all — a
 * document where the lexicon reached something is assumed to be reaching it in
 * the language it was written in. Under-reporting is the right direction for a
 * signal added to a gate every generated document already runs.
 *
 * TWO KNOWN BLIND SPOTS, stated rather than implied:
 *
 *   - Coincidental coverage. One listed noun ("3 sites") silences the warning
 *     for a document whose other counts use nouns outside the lexicon.
 *   - CJK. This detector needs whitespace: it locates a count by a digit run
 *     that is not preceded by a letter and is followed by one. Japanese and
 *     Chinese put digits flush against the surrounding text ("3拠点で45名"),
 *     so the second number is preceded by a letter and is not seen at all.
 *     Relaxing the lookbehind to fix that would match digits inside Latin
 *     identifiers, so it needs script-aware segmentation rather than a looser
 *     regex — separate work, and the reason this is a partial answer.
 *
 * So this closes the silent pass for space-delimited languages (de, es, tr, pt,
 * it, pl, ru, ...). A ja/zh CV can still reach 'pass' unchecked, which is why
 * the real answer is a lexicon those languages are in, not a better detector.
 *
 * @param {string} targetText
 * @returns {{reason: string, message: string, spans: string[]}|null}
 */
export function diagnoseCoverage(targetText) {
  const spans = countShapedSpans(targetText);
  if (spans.length < 2) return null;
  // RAW matches on purpose. This asks "could the extractor read any count here?",
  // which is about the noun lexicon, not about whether a count was later judged a
  // proposal. Reading the filtered set made a letter whose only counts were plan
  // horizons report "none matched the metric extractor, whose noun list is
  // English-only" -- a false warn blaming the lexicon for counts it had read fine.
  COUNT_CLAIM_RE.lastIndex = 0;
  const recognized = [...stripMarkup(String(targetText ?? '')).matchAll(COUNT_CLAIM_RE)];
  if (recognized.length > 0) return null;
  return {
    reason: 'no-count-claims-recognized',
    message:
      `${spans.length} count-like claims are present but none matched the metric extractor, whose noun ` +
      'list covers English, German and French only — so no count in this document was checked against your sources. ' +
      'Percentages, currency and multipliers were still checked. Verify the counts by hand, or add ' +
      'them to allow_metrics in config/cv-facts.json once confirmed.',
    spans,
  };
}

/**
 * Build the allow-list a metric claim is checked against.
 *
 * Claims extracted from text are folded through NOUN_SYNONYMS; allow_metrics
 * entries used to be normalized only, so an exception written in the spelling
 * a human reaches for - `77 repos` - never matched the canonical `77
 * repositories` the extractor produces. The entry then did nothing at all and
 * the CV still failed the gate, with no diagnostic pointing at the allow-list
 * (CodeRabbit, reviewing #2175). A silently inert exception is the same failure
 * class this script exists to catch.
 *
 * Both spellings are added rather than the canonical one alone: metricClaims()
 * yields nothing for an entry no pattern recognizes (a bare `$900k`, a
 * percentage), so replacing normalizeClaim outright would drop those exceptions
 * instead of widening them. The union can only ever allow more, never less.
 */
function allowedMetricSet(sourceText, allowMetrics) {
  const allowed = new Set(metricClaims(sourceText));
  for (const entry of allowMetrics || []) {
    allowed.add(normalizeClaim(entry));
    for (const canonical of metricClaims(String(entry))) allowed.add(canonical);
  }
  return allowed;
}

/** Compare generated metric claims against source text without reading files. */
export function auditClaims(targetText, sourceText, config = {}) {
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const invented = [...metricClaims(targetText)].filter(claim => !allowed.has(claim));
  // Hoisted: stripMarkup re-ran the whole markup pass once per configured
  // phrase (CodeRabbit, reviewing #2175). Same result, one pass.
  const targetPlain = stripMarkup(targetText).toLowerCase();
  const forbidden = (config.forbidden_phrases || [])
    .filter(Boolean)
    .filter(phrase => targetPlain.includes(String(phrase).toLowerCase()));
  return { invented, forbidden };
}

/**
 * Load and validate the optional fact-gate configuration file.
 *
 * The empty config is a fine default and a terrible silent one: forbidden_phrases
 * and warn_phrases are the only phrase-level guard this module has, so with no
 * file loaded the phrase check cannot fail — and a gate that is DISABLED then
 * reads exactly like a gate that RAN AND FOUND NOTHING. `missing` is the one bit
 * that tells them apart; callers surface it (#3894).
 *
 * Nothing here turns a missing config into an error. A user who has never
 * written a cv-facts.json is in a normal state; they just should not be left
 * believing a gate is protecting them when none is loaded.
 *
 * @param {string} path absolute path to the configuration file
 * @returns {{missing: boolean, config: {allow_metrics: string[], allow_facts: string[], forbidden_phrases: string[], warn_phrases: string[]}}}
 * @throws when the file exists but is unparseable or has a non-array key
 */
export function loadFactConfig(path) {
  const keys = ['allow_metrics', 'allow_facts', 'forbidden_phrases', 'warn_phrases'];
  if (!existsSync(path)) return { missing: true, config: Object.fromEntries(keys.map(key => [key, []])) };
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  for (const key of keys) {
    if (config[key] == null) config[key] = [];
    else if (!Array.isArray(config[key])) throw new Error(`${key} must be an array in ${path}`);
  }
  return { missing: false, config };
}

// Function words that tell English apart from the other Latin-script market
// languages the project ships modes for (es, pt, fr, de, it, tr). A word that
// English shares with one of them, such as `a`, `in` or `as`, is in neither
// set, and `per`, `do` and `no` stay out because English CVs use them.
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'and', 'of', 'to', 'for', 'with', 'from', 'by', 'at', 'on', 'is', 'was',
  'were', 'are', 'that', 'this', 'which', 'into', 'over', 'our', 'my', 'their',
  'its', 'has', 'have', 'had', 'been', 'it', 'or', 'not', 'also',
]);
const OTHER_FUNCTION_WORDS = new Set([
  'el', 'la', 'los', 'las', 'del', 'y', 'en', 'para', 'con', 'por', 'una', 'que', 'se', 'al', 'su', 'sus', 'como', 'es', 'de',
  'le', 'les', 'des', 'du', 'et', 'pour', 'avec', 'par', 'une', 'dans', 'sur', 'au', 'aux', 'est', 'qui',
  'der', 'die', 'das', 'den', 'dem', 'und', 'für', 'mit', 'von', 'zu', 'ein', 'eine', 'auf', 'bei', 'im', 'ist', 'sich', 'nicht',
  'os', 'da', 'dos', 'em', 'com', 'um', 'na', 'ao', 'não',
  'il', 'gli', 'di', 'nel', 'della', 'che', 'è',
  've', 'bir', 'ile', 'için', 'bu', 'olarak', 'daha',
]);

/**
 * Whether a text reads as English, for the checks whose word lists are English.
 *
 * A text counts as not English when letters outside the Latin script make up
 * more than 30% of it, or when it holds at least two function words of another
 * market language and more of them than English ones. An empty or very short
 * text counts as English, so a document with no evidence either way is still
 * checked. All-caps tokens are skipped, so `MIT` is not the German `mit`.
 *
 * @param {string} text plain text, after stripMarkup
 * @returns {boolean}
 */
function looksEnglish(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  const nonLatin = text.match(/(?!\p{Script=Latin})\p{L}/gu) ?? [];
  if (letters.length && nonLatin.length / letters.length > 0.3) return false;
  let english = 0;
  let other = 0;
  // Addresses are not prose. "com" is Portuguese for "with", so the contact
  // line of a short CV (jane@example.com, github.com/jane) counted as two or
  // three Portuguese words and outvoted its English (#5348).
  // Start each address at a token boundary instead of retrying every suffix
  // of a long non-address token (quadratic time for pasted text/OCR).
  const prose = text.replace(/(?<!\S)(?:\S+@\S+|\S+:\/\/\S+)|(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\S*/gu, ' ');
  for (const [word] of prose.matchAll(/[\p{L}]+/gu)) {
    if (word.length > 1 && word === word.toUpperCase()) continue;
    const lower = word.toLowerCase();
    if (ENGLISH_FUNCTION_WORDS.has(lower)) english++;
    else if (OTHER_FUNCTION_WORDS.has(lower)) other++;
  }
  return !(other >= 2 && other > english);
}

/**
 * Explain why the scope and adoption checks did not run, or return null.
 *
 * Their verb table and phrase list are English, so on any other language they
 * would pass a document they could not read. Reporting the gap through
 * `coverage` keeps that from reading as "checked and clean".
 *
 * @returns {string|null}
 */
function scopeLanguageGap(targetText, sourceText) {
  const targetEnglish = looksEnglish(stripMarkup(targetText));
  const sourceEnglish = looksEnglish(stripMarkup(sourceText));
  if (targetEnglish && sourceEnglish) return null;
  const subject = !targetEnglish && !sourceEnglish
    ? 'The document and its sources are'
    : !targetEnglish ? 'The document is' : 'Its sources are';
  return `${subject} not in English, so the scope-verb and adoption checks did not run: their word lists ` +
    'are English-only. Check ownership verbs and adoption claims by hand.';
}

/** Resolve a CLI or configuration path relative to the selected working directory. */
function resolveInputPath(path, cwd = process.cwd()) {
  return isAbsolute(path) ? path : join(cwd, path);
}

// No name or title is this long. A tool claim has no word limit, so a capture
// that runs on for hundreds of capitalised words, or one enormous token, can
// reach the lookup below, and escaped into a pattern it is more than the
// regular expression engine can compile. Such a value reads as absent, which
// blocks, instead of throwing.
const MAX_SOURCE_LOOKUP_LENGTH = 500;

/** Check a normalized fact as a complete token or phrase, not a substring. */
function sourceContainsFact(sourceText, value) {
  if (value.length > MAX_SOURCE_LOOKUP_LENGTH) return false;
  const escaped = value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#/-])${escaped}(?=$|[^\\p{L}\\p{N}+#/-])`, 'iu').test(sourceText);
}

/**
 * @param {string} targetText generated candidate-facing HTML/Markdown/text
 * @param {{ sourcePaths?: string[], planTexts?: string[], configPath?: string, cwd?: string }} options
 *   planTexts: what the candidate wrote for one document, such as the answers
 *   for a cover letter. They support only a number the document states as a
 *   plan, never an employer, title, tool, or past experience. The rendered
 *   letter is not passed here, or every claim in it would support itself.
 * @returns {{ verdict: 'pass'|'warn'|'block', invented: string[], unsupportedFacts: object[], advisoryFacts: object[], forbidden: string[], warnings: string[] }}
 * @throws when the config is invalid
 */
export function verifyFacts(targetText, {
  sourcePaths = DEFAULT_SOURCES,
  planTexts = [],
  configPath = DEFAULT_CONFIG,
  cwd = process.cwd(),
} = {}) {
  // Per file, before the join: stripMarkup keeps only the body of a LaTeX
  // document, and run on the joined text it would discard every source read
  // ahead of a .tex one as if it were that document's preamble.
  const sourceText = sourcePaths.map(path => latexBody(readIfExists(resolveInputPath(path, cwd)))).join('\n');
  const { missing: configMissing, config } = loadFactConfig(resolveInputPath(configPath, cwd));
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const targetClaims = metricClaims(targetText);
  const planned = plannedClaims(targetText, planTexts);
  const invented = [...targetClaims].filter(claim => !allowed.has(claim) && !planned.has(claim));
  const sourceNormalized = normalizeFact(stripMarkup(sourceText));
  const allowedFacts = new Set(config.allow_facts.map(normalizeFact));
  const unsourced = ({ value }) => !sourceContainsFact(sourceNormalized, value) && !allowedFacts.has(value);
  const fieldClaims = structuredFieldClaims(targetText).filter(unsourced);
  const namedFacts = [
    ...factClaims(targetText, sourceNormalized),
    ...delegatedAuthorshipClaims(targetText, sourceText),
    ...fieldClaims.filter(claim => claim.blocking).map(({ kind, value }) => ({ kind, value })),
  ].filter(unsourced);
  // Scope and adoption claims resolve their own source evidence — a verb-tier
  // comparison and a phrase lookup — so they must not be re-filtered by
  // sourceContainsFact. That test asks whether the claim's own wording appears
  // in the sources, which is a different question: an inflated bullet whose
  // words happen to occur elsewhere in cv.md would be dropped, and the whole
  // finding is that the source says something WEAKER about the same entry.
  const languageGap = scopeLanguageGap(targetText, sourceText);
  const comparedFacts = (languageGap ? [] : scopeInflationClaims(targetText, sourceText))
    .filter(({ value }) => !allowedFacts.has(value));
  // Adoption claims warn instead of block. The phrase list cannot see every
  // way a source states reach, and a block makes the PDF step tell the agent to
  // stop and fix, so a missed paraphrase would get a true bullet rewritten.
  const advisoryFacts = [
    ...(languageGap ? [] : adoptionClaims(targetText, sourceText)),
    ...fieldClaims.filter(claim => !claim.blocking).map(({ kind, value, line }) => ({ kind, value, line })),
  ].filter(({ value }) => !allowedFacts.has(value));
  const unsupportedFacts = [...namedFacts, ...comparedFacts]
    .filter((claim, index, claims) => claims.findIndex(other => other.kind === claim.kind && other.value === claim.value) === index);
  const forbidden = config.forbidden_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  const warnings = config.warn_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  // Never downgrades a block and never creates one: a document that fails on
  // real evidence still fails on that, and a coverage gap only turns a would-be
  // 'pass' into 'warn' so the caller is told the gate could not read it.
  // One coverage object, so callers that read `coverage.reason` keep working.
  // A count gap keeps its reason and gains the scope sentence.
  const countGap = diagnoseCoverage(targetText);
  const coverage = !languageGap ? countGap
    : countGap ? { ...countGap, message: `${countGap.message} ${languageGap}` }
      : { reason: 'scope-not-checked', message: languageGap, spans: [] };
  const blocked = invented.length || unsupportedFacts.length || forbidden.length;
  return {
    verdict: blocked ? 'block' : (warnings.length || advisoryFacts.length || coverage) ? 'warn' : 'pass',
    invented,
    unsupportedFacts,
    advisoryFacts,
    forbidden,
    warnings,
    coverage,
    // Deliberately outside the verdict: no config is a normal state, not a
    // finding. It rides along so a caller can say the phrase lists were never
    // loaded instead of printing a clean result the reader takes for "checked".
    configMissing,
  };
}

/**
 * A past-experience framing of a time metric inside an assertion span, e.g.
 * "I have 6 months of experience". When a forward marker appears later in the
 * same clause ("…and will review incidents"), that marker must not pull the
 * past metric into the plan set.
 */
const PAST_TIME_CLAIM_RE = /\b(?:have|has|had|spent|worked)\s+(?:[\p{L}\p{M}-]+\s+){0,4}\d[\d,.]*\s*\+?\s*(?:months|years|weeks|days)\b/giu;
const PAST_PERCENT_CLAIM_RE = /\b(?:grew|increased|improved|reduced|generated|achieved|delivered|managed|led)\b[^.!?;\n]{0,80}?\d[\d,.]*\s*(?:%|(?:percent|per\s?cent|pct)\b)/giu;
const DURATION_INTRO_RE = /^\s*(?:over|in|within|for|during|across)\b[^,;:]*?\d[\d,.]*\s*\+?\s*(?:days|weeks|months|years)\s*$/i;

/**
 * Sentence bounds at `.`, `!`, `?`, or newline — used so a duration intro
 * ("Over 6 months, …") can inherit a forward marker from the next clause.
 */
function sentenceBounds(text, index) {
  const isSentenceEnd = (i) => {
    const c = text[i];
    if (c === '\n') return true;
    if (c !== '.' && c !== '!' && c !== '?') return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  };
  let start = 0;
  for (let i = index - 1; i >= 0; i--) if (isSentenceEnd(i)) { start = i + 1; break; }
  let end = text.length;
  for (let i = index; i < text.length; i++) if (isSentenceEnd(i)) { end = i; break; }
  return { start, end };
}

function pastClaimMetrics(span) {
  const claims = new Set();
  const add = (text) => {
    for (const claim of metricClaims(text, { keepPlanHorizons: true })) claims.add(claim);
  };
  for (const match of span.matchAll(PAST_TIME_CLAIM_RE)) add(match[0]);
  for (const match of span.matchAll(PAST_PERCENT_CLAIM_RE)) {
    const markerAfterVerb = match[0].search(FORWARD_MARKER_RE) > 0;
    if (markerAfterVerb) continue;
    add(match[0]);
  }
  return claims;
}

/** A span states a plan when it has a forward marker, or it is a duration introduction in a sentence that has one. */
function isPlanAssertion(span, sentence) {
  if (FORWARD_MARKER_RE.test(span)) return true;
  return DURATION_INTRO_RE.test(span) && FORWARD_MARKER_RE.test(sentence);
}

/**
 * Metric claims in `targetText` that `planTexts` support: the plan texts hold
 * the claim, and the target states that claim as a plan. "I will read the last
 * 6 months of incident reviews" qualifies. "I have 6 months of
 * incident-response experience" does not, even when a forward marker appears
 * later in the same clause. Plan answers keep forward-looking horizon numbers
 * so a letter can restate them ("Over 6 months, I will…").
 *
 * @param {string} targetText
 * @param {string[]} planTexts
 * @returns {Set<string>}
 */
function plannedClaims(targetText, planTexts) {
  const planText = planTexts.filter(text => typeof text === 'string').join('\n');
  if (!planText.trim()) return new Set();
  // keepPlanHorizons: answers often say "In my first 6 months I will…"; the
  // target-side horizon rule still drops those from invented claims, but the
  // plan evidence must retain the number so the letter can restate it.
  const inPlans = metricClaims(planText, { keepPlanHorizons: true });
  const clean = spellNumbers(stripMarkup(targetText, { keepLineBreaks: true }));
  const forward = new Set();
  const past = new Set();
  for (let i = 0; i < clean.length;) {
    const { start, end } = clauseBounds(clean, i);
    const span = clean.slice(start, end);
    const { start: s0, end: s1 } = sentenceBounds(clean, i);
    const sentence = clean.slice(s0, s1);
    const planAssertion = isPlanAssertion(span, sentence);
    const pastInSpan = pastClaimMetrics(span);
    for (const claim of metricClaims(clean.slice(i, end))) {
      if (pastInSpan.has(claim)) past.add(claim);
      else if (planAssertion) forward.add(claim);
      else past.add(claim);
    }
    i = end + 1;
  }
  return new Set([...forward].filter(claim => inPlans.has(claim) && !past.has(claim)));
}

/** Say which sources the gate read, so nobody looks for evidence it never checked. */
export function factSourceAdvice({ letterAnswers = false } = {}) {
  if (!letterAnswers) {
    return 'cv.md and article-digest.md do not contain these claims. Add career evidence to one of them. A verified exception belongs in config/cv-facts.json.';
  }
  return [
    'These claims are not in cv.md, article-digest.md, or the answers and inputs supplied for this letter.',
    'Those answers support only a number the letter states as a plan, never an employer, title, tool, or past experience.',
    'Add career evidence to cv.md or article-digest.md.',
    'A plan stays in those answers. Do not copy that plan into cv.md.',
    'A verified exception belongs in config/cv-facts.json.',
  ].join(' ');
}

/**
 * Tell the user why a scope claim blocked and how to allow it once verified.
 *
 * The value is the exact string `allow_facts` matches, so the user can copy it.
 */
export function scopeClaimAdvice({ value }) {
  return `the source gives this work a weaker verb than the CV. If the CV is right, add "${value}" to allow_facts in config/cv-facts.json`;
}

/** Verify a document and throw when it contains a blocking unsupported claim. */
export function assertFacts(targetText, options = {}) {
  const result = verifyFacts(targetText, options);
  if (result.verdict === 'block') {
    const details = [];
    if (result.invented.length) details.push(`metric-like claims absent from sources: ${result.invented.join(', ')}`);
    if (result.unsupportedFacts.length) details.push(`non-metric facts absent from sources: ${result.unsupportedFacts.map((claim) => {
      const { kind, value, sourceLine } = claim;
      if (kind === 'scope') return `${kind}=${value} (source says: ${sourceLine}; ${scopeClaimAdvice(claim)})`;
      return sourceLine ? `${kind}=${value} (source says: ${sourceLine})` : `${kind}=${value}`;
    }).join(', ')}`);
    if (result.forbidden.length) details.push(`forbidden phrases found: ${result.forbidden.join(', ')}`);
    throw new Error(`Fact check failed${options.label ? ` for ${options.label}` : ''}: ${details.join('; ')}. ${factSourceAdvice({ letterAnswers: Array.isArray(options.planTexts) })}`);
  }
  return result;
}

/** Parse the fact-validator command-line arguments. */
function parseCliArgs(args) {
  const sourcePaths = [];
  let targetArg = '';
  let configPath = DEFAULT_CONFIG;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' || arg === '--config') {
      if (!args[i + 1]) throw new Error(`${arg} requires a path`);
      if (arg === '--source') sourcePaths.push(args[++i]);
      else configPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!targetArg) {
      targetArg = arg;
    } else {
      throw new Error(`unexpected extra positional argument: ${arg}`);
    }
  }
  return { targetArg, sourcePaths, configPath, json, help: false };
}

/** Return the command-line usage text. */
function usage() {
  return `Usage: node verify-cv-facts.mjs <generated-document> [--source path] [--config path] [--json]
       node verify-cv-facts.mjs --self-test

Checks generated candidate-facing text for unsupported metrics and explicitly asserted
non-metric facts (employers, titles, tools, delegated-work authorship, scope-verb
inflation, and unsourced adoption claims) absent from source files.
Default sources: cv.md and article-digest.md.
A cover letter also reads the answers supplied for that letter, which support
only a number the letter states as a plan. The rendered letter is not a source.
Default config:  config/cv-facts.json (optional)`;
}

/** Exercise the metric extraction regressions that the shared gate depends on. */
function runSelfTest() {
  let passed = 0;
  let failed = 0;
  const equal = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      passed++;
      return;
    }
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  };
  const source = [
    'Reached 16,181 active users and 289,760 enrollments across 80 courses.',
    'Cut infrastructure cost 60%. Managed a $550K budget.',
    'Certified partners earned 2x more. Authored 80+ open-access technical guides.',
  ].join(' ');

  equal('truthful modifier restatement', auditClaims('Reached 16,181 users', source).invented, []);
  // The normalized claim now carries no thousands separator, since grouping no
  // longer decides whether two spellings of the same number match.
  equal('inflated modifier count', auditClaims('Reached 94,772 active users', source).invented, ['94772 users']);
  equal('new training noun', auditClaims('Drove 900,000 enrollments', source).invented, ['900000 enrollments']);
  equal('truthful currency', auditClaims('Managed a $550K budget', source).invented, []);
  equal('inflated currency', auditClaims('Managed a $900K budget', source).invented, ['$900k']);
  equal('truthful multiplier', auditClaims('Partners earned 2x more', source).invented, []);
  equal('noun synonym', auditClaims('Authored 80 articles', source).invented, []);
  equal('ordinary year is ignored', auditClaims('Joined the team in 2013', source).invented, []);

  // The number binds to the NEAREST noun in the window, not the farthest (#3414).
  // Greedy, each of these bound the wrong noun while the SAME fact worded plainly
  // bound the right one — so a truthful line copied verbatim out of cv.md read as
  // a different claim from its own source, and the gate flagged it as invented.
  const claimsOf = (text) => [...metricClaims(text)].sort().join(' | ');
  equal('nearest noun wins over a farther one', claimsOf('15+ years scaling teams and platforms'), '15 years');
  equal('nearest noun wins across three modifiers', claimsOf('20+ years leading engineering organizations'), '20 years');
  equal('the plain phrasing of the same fact agrees', claimsOf('I have 15+ years of experience.'), '15 years');
  // …and the whole point of a truthful restatement passing the gate:
  equal('a verbatim experience line is not invented',
    auditClaims('15+ years scaling teams and platforms', '15+ years of experience.').invented, []);
  // #2279 is why the window is wide: one noun, several modifiers. Lazy must not
  // shrink the reach, only decide which noun wins when there are two.
  equal('a 3-modifier single-noun phrase still resolves', claimsOf('~5 live Cloud Run deployments'), '5 deployments');
  equal('and its 2-modifier paraphrase agrees', claimsOf('~5 Cloud Run deployments'), '5 deployments');
  // A number is a hard barrier for the chain, so two counts stay separate.
  equal('two counts in one sentence stay distinct', claimsOf('8 years supporting 40 engineers'), '40 engineers | 8 years');

  // A proposed plan horizon is not a claim about the past (#3655). Time units
  // belong in METRIC_NOUNS, so the stock cover-letter closing was extracted as a
  // metric and reported as invented, and no source could ever evidence it.
  equal('a proposed plan horizon is not a claim',
    claimsOf("I'd welcome the chance to talk through how I'd approach the first 90 days."), '');
  equal('the same closing in the fuller phrasing',
    claimsOf('I would welcome a conversation about the first 90 days.'), '');
  equal('an end-to-end audit stops reporting it',
    auditClaims("I'd approach the first 90 days by listening.", 'No numbers here.').invented, []);
  // Both halves are required, and each alone would silence a real claim.
  equal('a past-tense window behind the same lead is still a claim',
    claimsOf('Revenue grew in the first 12 months.'), '12 months');
  equal('a forward-looking sentence keeps a claim with no horizon lead',
    claimsOf('I would bring 20 years of experience.'), '20 years');
  equal('an ordinary time metric is untouched',
    claimsOf('Cut deployment time to 2 days.'), '2 days');
  // The marker must be in the SAME sentence, or one conditional courtesy line
  // would silence every time-unit claim in the document.
  equal('a marker in a neighbouring sentence does not reach',
    claimsOf('I would be glad to help. Revenue grew in the first 12 months.'), '12 months');
  // Scoped to time units on purpose: a count of anything else is still a count.
  equal('a non-time noun behind the same construction is unaffected',
    claimsOf("I'd start with the first 3 teams."), '3 teams');
  // The marker need not be first person: a plan is still a plan when the letter
  // frames it around the reader, or drops the pronoun entirely.
  equal('a bare modal is a forward marker too',
    claimsOf('My first 90 days would centre on the pipeline.'), '');
  equal('a reader-facing plan question is one as well',
    claimsOf('How would you approach the first 90 days?'), '');
  equal('and a proposal framed with should',
    claimsOf('Glad to talk through how the first 90 days should go.'), '');
  // Ability is not a plan: "could" frames what is possible, not what is proposed.
  equal('an ability modal is not a forward marker',
    claimsOf('Revenue could be traced to the first 12 months.'), '12 months');
  // Review of #3656: the filter was wider than the description, and in the
  // direction the gate exists to prevent. A marker anywhere in the sentence let
  // a fabricated PAST number through, so the marker must share the number's
  // CLAUSE, and a line break ends one.
  equal('a marker in a later clause does not suppress',
    claimsOf('Revenue grew in the first 99 months, and I would be glad to repeat it.'), '99 months');
  equal('a soft-wrapped line does not join two clauses',
    claimsOf('I would be glad to help\nRevenue grew in the first 99 months'), '99 months');
  // "'d" is "had" as often as "would"; a past-perfect claim is not a plan.
  equal('a past-perfect contraction is not a forward marker',
    claimsOf("I'd completed the migration in the first 12 months."), '12 months');
  equal("but 'd before a base verb still is", claimsOf("I'd approach the first 90 days."), '');
  // A decimal is not a sentence boundary. Splitting inside "1.5" put the marker
  // outside the number's own clause, so a real plan horizon stayed a claim.
  equal('a decimal horizon is still a plan', claimsOf('My first 1.5 years would focus on the pipeline.'), '');
  // ...and the VERDICT, not just `invented`: routing diagnoseCoverage through the
  // filtered matches turned a false block into a false warn whose message blamed
  // the English-only noun list for counts that were English and recognized.
  const verdictOf = (t) => {
    const r = verifyFacts(t, { sourcePaths: [], configPath: '/nonexistent' });
    return `${r.verdict}${r.coverage ? ' +' + r.coverage.reason : ''}`;
  };
  equal('two plan horizons do not trigger a coverage warning',
    verdictOf("I'd approach the first 90 days by listening, and the first 30 days by shipping."), 'pass');
  equal(
    'allow_metrics override',
    auditClaims('Reached 94,772 users', source, { allow_metrics: ['94,772 users'] }).invented,
    []
  );
  // An exception is written in the spelling a human reaches for, which is not
  // always the canonical noun the extractor emits. Before the allow-list was
  // folded too, this entry matched nothing and the CV stayed red.
  equal('a synonym-spelled exception is honoured',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['77 repos'] }).invented, []);
  equal('the canonical spelling still works',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['77 repositories'] }).invented, []);
  // and folding the allow-list must not swallow an entry no claim pattern
  // recognizes, which is what routing it through metricClaims alone would do.
  equal('a currency exception survives the folding',
    auditClaims('Managed a $900K budget', source, { allow_metrics: ['$900K'] }).invented, []);
  equal('an unrelated exception still leaves the claim invented',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['12 repos'] }).invented, ['77 repositories']);
  equal(
    'forbidden phrase',
    auditClaims('A proven track record', source, { forbidden_phrases: ['proven track record'] }).forbidden,
    ['proven track record']
  );

  // Non-software domains. METRIC_NOUNS counted users, engineers and repos but
  // not staff, facilities or sites, so an operations/facilities/healthcare CV
  // yielded no claim at all for its headcount — the one number such a CV is
  // most likely to inflate. The gate reported a pass having checked nothing.
  const opsSource = [
    'Managed 20 staff across shift coverage: 8 scientists and 12 support personnel.',
    'Built out four facilities and ran a research program across 45 hectares.',
    'Held temperature setpoints across 3 production rooms.',
  ].join(' ');

  equal('truthful headcount', auditClaims('Managed 20 staff', opsSource).invented, []);
  equal('inflated headcount is caught', auditClaims('Managed 45 staff', opsSource).invented, ['45 staff']);
  equal('inflated specialist count is caught',
    auditClaims('Led 30 scientists', opsSource).invented, ['30 scientists']);
  equal('headcount paraphrase is not a fabrication',
    auditClaims('Managed 20 personnel', opsSource).invented, []);
  equal('inflated site count is caught',
    auditClaims('Built out 12 facilities', opsSource).invented, ['12 facilities']);
  equal('truthful area', auditClaims('Ran a program across 45 hectares', opsSource).invented, []);
  equal('inflated area is caught',
    auditClaims('Ran a program across 450 hectares', opsSource).invented, ['450 hectares']);
  equal('truthful room count', auditClaims('Setpoints across 3 rooms', opsSource).invented, []);
  equal('inflated room count is caught',
    auditClaims('Setpoints across 30 rooms', opsSource).invented, ['30 rooms']);

  // Non-ASCII digits: every claim pattern here is written with ASCII \d, so a
  // CV in ar/hi/ja/zh produced ZERO claims and the gate reported a pass having
  // checked nothing — in five markets this repo ships mode sets for.
  const foldSource = 'Reached 16,181 active users across 80 courses. Cut cost 60%.';
  equal('fabricated full-width metric is caught', auditClaims('Reached ９４，７７２ users', foldSource).invented, ['94772 users']);
  equal('fabricated Arabic-Indic metric is caught', auditClaims('Reached ٩٤٧٧٢ users', foldSource).invented, ['94772 users']);
  equal('fabricated Devanagari metric is caught', auditClaims('Reached ९४७७२ users', foldSource).invented, ['94772 users']);
  equal('fabricated Arabic percentage is caught', auditClaims('Cut cost ٩٩٪', foldSource).invented, ['99%']);
  // …and the folding must not turn a TRUTHFUL localized CV red.
  equal('truthful Arabic-Indic metric passes', auditClaims('Reached ١٦١٨١ users', foldSource).invented, []);
  equal('truthful full-width metric passes', auditClaims('Reached １６，１８１ users', foldSource).invented, []);

  // Thousands grouping must not decide whether a claim matches: the extraction
  // pattern stops at a space, so "16 181 users" used to yield "181 users" — a
  // claim no source contains.
  equal('space-grouped thousands compare equal', auditClaims('Reached 16 181 users', foldSource).invented, []);
  equal('ungrouped compares equal to a grouped source', auditClaims('Reached 16181 users', foldSource).invented, []);
  equal('a fabricated space-grouped number is still caught', auditClaims('Reached 94 772 users', foldSource).invented, ['94772 users']);
  // Multi-group values fold in full: `.replace(/…/g)` evaluates each separator
  // against the ORIGINAL string, where every group is preceded by a space, not
  // a digit, so the lookbehind passes at each one (CodeRabbit asked).
  equal('a multi-group number folds completely', auditClaims('Reached 1 234 567 users', 'Reached 1234567 active users.').invented, []);
  equal('an eight-digit multi-group number folds too', auditClaims('Reached 12 345 678 users', 'Reached 12345678 active users.').invented, []);
  // Period grouping is the convention in several of the markets this repo
  // ships mode sets for, so a period-grouped source and a comma-grouped CV
  // describe the same number and must compare equal in both directions.
  equal('a period-grouped CV matches a comma-grouped source',
    auditClaims('Reached 16.181 users', foldSource).invented, []);
  equal('a comma-grouped CV matches a period-grouped source',
    auditClaims('Reached 16,181 users', 'Reached 16.181 active users.').invented, []);
  equal('a fabricated period-grouped number is still caught',
    auditClaims('Reached 94.772 users', foldSource).invented, ['94772 users']);
  // Widening the class must not eat an ordinary decimal, which is what the
  // exactly-three-digit window is for.
  equal('a decimal is not read as grouping',
    auditClaims('Cut build time to 2.5 hours', 'Cut build time to 2.5 hours.').invented, []);
  // Assert the canonical form directly, not just that the two sides agree:
  // the case above puts '2.5 hours' on BOTH sides of auditClaims, so a
  // regression that stripped the period from every claim would keep them
  // equal and stay green while silently folding 2.5 into 25. Pinning the
  // output of normalizeClaim is what makes this case able to fail.
  equal('an ordinary decimal survives normalization',
    normalizeClaim('2.5 hours'), '2.5 hours');
  // A four-digit left part is a year, not a group: nothing is joined.
  equal('a year is not glued to the next number', auditClaims('Joined in 2026 100 users', foldSource).invented, ['100 users']);

  // The employer/title triggers used to be lowercase-only (plain /g), so the
  // phrasing a CV actually uses — a capitalised bullet — produced NO claim,
  // and a fabricated employer shipped unflagged. This is the half of the gate
  // that enforces "authorship claims are non-negotiable".
  const kinds = (text) => factClaims(text).map((f) => `${f.kind}:${f.value}`);
  equal('a capitalised CV bullet yields employer + title',
    kinds('- Worked at Initech as a Principal Engineer'),
    ['employer:initech', 'title:principal engineer']);
  equal('the lowercase phrasing still works',
    kinds('he worked at Initech as a Principal Engineer'),
    ['employer:initech', 'title:principal engineer']);
  equal('Joined, capitalised', kinds('Joined Globex in 2024'), ['employer:globex']);
  equal('Employer: label, capitalised', kinds('Employer: Initech'), ['employer:initech']);
  // A lowercase connector is part of the title: truncating at it made "Head of
  // Data" and "Head of Engineering" the same claim, so an inflated title
  // matched the real one and passed (CodeRabbit review).
  equal('a connector keeps the title whole', kinds('Served as Head of Data'), ['title:head of data']);
  equal('an inflated title is a different claim', kinds('Served as Head of Engineering'), ['title:head of engineering']);
  equal('a longer title survives too', kinds('Served as Vice President of Sales'), ['title:vice president of sales']);
  // The title expression is duplicated across the two alternatives, so the
  // connector must be covered on the "Worked at X as Y" branch as well — a fix
  // applied to one and not the other would pass every test above (CodeRabbit).
  equal('the connector works on the worked-at branch too',
    kinds('Worked at Initech as Head of Data'),
    ['employer:initech', 'title:head of data']);
  // The capture stays case-SENSITIVE: only the triggers are relaxed, so
  // ordinary prose is never read as an employer or title claim.
  equal('ordinary prose is not a claim', kinds('Worked at the office as a manager'), []);
  equal('ordinary prose, lowercase', kinds('joined the team as a contractor'), []);

  // A block boundary is a sentence break: gluing two list items let the title
  // capture chain across them ("Principal Engineer Built"), a string no source
  // contains — a truthful CV failing the gate.
  equal('a title does not chain across a list-item boundary',
    kinds('<ul><li>Worked at Initech as a Principal Engineer</li><li>Built pipelines</li></ul>'),
    ['employer:initech', 'title:principal engineer']);
  // #2279 — the modifier count must never decide whether a claim exists. The
  // source words the fact with three modifiers, the CV with two: at the old
  // {0,2} window the claim was extracted from the CV side only, and a true
  // statement failed the gate.
  const modifierSource = 'Consolidated 25+ services down to ~5 live Cloud Run deployments.';
  equal(
    'same number, fewer modifiers in the CV',
    auditClaims('25+ services consolidated to ~5 Cloud Run deployments', modifierSource).invented,
    []
  );
  equal(
    'same number, more modifiers in the CV',
    auditClaims('Consolidated to ~5 live production Cloud Run deployments', modifierSource).invented,
    []
  );
  // The direction that matters: a CHANGED number hid behind the 3-modifier
  // phrasing, because the CV side yielded no claim to compare at all.
  equal(
    'changed number behind three modifiers is caught',
    auditClaims('Consolidated to ~9 live Cloud Run deployments', modifierSource).invented,
    ['9 deployments']
  );
  equal(
    'changed number with the plain phrasing is still caught',
    auditClaims('Consolidated to ~9 Cloud Run deployments', modifierSource).invented,
    ['9 deployments']
  );
  // A wider window must not let the chain jump over an intervening figure to
  // bind a number to a noun it does not count. The source states the two facts
  // in SEPARATE sentences on purpose: with identical text on both sides, a
  // wrong "7 hours" extraction would appear on both and cancel itself out, so
  // the assertion would pass while proving nothing. Both nouns are metric
  // nouns, so each real claim is independently evidenced and the only thing
  // that can surface as invented is a cross-number binding.
  const numericBarrierSource = 'Ran 7 tests. Logged 40 hours.';
  equal(
    'a figure still blocks the chain',
    auditClaims('Ran 7 tests over 40 hours', numericBarrierSource).invented,
    []
  );
  equal(
    'no cross-number binding invents evidence',
    auditClaims('Shipped 3 integrations', 'Shipped 3 features across 12 integrations').invented,
    ['3 integrations']
  );

  // A magnitude suffix belongs to the number, not the modifier window. Without
  // that, "50k users" normalized to "50 users" and matched a CV saying 50 — the
  // gate passed a 1000x inflation while catching a smaller "900 users".
  equal(
    'an inflated magnitude suffix is caught',
    auditClaims('Grew the product to 50k users', 'Reached 50 users.').invented,
    ['50k users']
  );
  equal(
    'a magnitude claim the source supports still passes',
    auditClaims('Grew to 50k users', 'Reached 50k users.').invented,
    []
  );
  equal(
    'a lowercase m suffix is caught too',
    auditClaims('Drove 1.5M downloads', 'Drove 50 downloads.').invented,
    ['1.5m downloads']
  );
  equal(
    'an uppercase B suffix is caught too',
    auditClaims('Reached 2B users', 'Reached 1B users.').invented,
    ['2b users']
  );
  // A spelled-out magnitude belongs to the number for the same reason the suffix
  // does, and folds onto that suffix so the two spellings of one quantity are one
  // claim. Left in the modifier window it normalized away, and "Served 50 users"
  // then read as evidence for "Served 50 million users".
  //
  // Asserting on metricClaims directly (not auditClaims(...).invented) matters
  // here: target and source text are identical, so an empty `invented` list would
  // pass even if metricClaims extracted nothing at all — these assert the real
  // claim a truthful CV would produce.
  equal(
    'a spelled-out magnitude joins the number',
    [...metricClaims('Reached 50 million users')],
    ['50m users']
  );
  equal(
    'the two spellings of one quantity compare equal',
    auditClaims('Reached 50M users', 'Reached 50 million users.').invented,
    []
  );
  equal(
    'a spelled-out inflation is caught',
    auditClaims('Reached 50 million users', 'Reached 50 users.').invented,
    ['50m users']
  );
  equal(
    'a decimal spelled-out magnitude joins the number',
    [...metricClaims('Served 1.5 million customers')],
    ['1.5m customers']
  );
  equal(
    'a thousand spelled-out magnitude joins the number',
    [...metricClaims('Served 50 thousand users')],
    ['50k users']
  );
  equal(
    'an ordinary modifier is still not a magnitude',
    [...metricClaims('Served 50 active users')],
    ['50 users']
  );
  equal(
    'a word merely starting with a magnitude word is not one',
    [...metricClaims('Served 50 millionaire users')],
    ['50 users']
  );
  // The suffix must still END the token, so a unit that merely starts with k/m/b
  // keeps its previous normalization.
  equal(
    'a unit beginning with a suffix letter is unaffected',
    [...metricClaims('Shipped 50kg servers')],
    ['50 servers']
  );

  // Scope-verb inflation (#3685). Neither of the two cases below changes a
  // number, so every check above passes them: "led" where the source says
  // "contributed" is a fact to a reader and invisible to a metric gate.
  const scopeOf = (target, source) => scopeInflationClaims(target, source).map(claim => claim.value);
  const scopeSource = 'Contributed to the migration to a service architecture. Implemented the ingest pipeline.';

  equal('an upgraded scope verb is caught',
    scopeOf('Led the migration to a service architecture', scopeSource),
    ['led the migration to a service architecture']);
  equal('the bare phrasing of the same escalation is caught',
    scopeOf('Led the migration', 'Contributed to the migration'), ['led the migration']);
  equal('tier 3 over tier 2 is caught',
    scopeOf('Architected the ingest pipeline', scopeSource), ['architected the ingest pipeline']);
  // The gate must report the source line, not just the offending bullet: the
  // user fixes this in cv.md, and "which line" is the whole question.
  equal('the closest source line is reported',
    scopeInflationClaims('Led the migration to a service architecture', scopeSource)
      .map(claim => claim.sourceLine),
    ['Contributed to the migration to a service architecture']);

  // …and the four ways this must stay silent. A fact gate that blocks a
  // truthful CV is the failure mode this file's history is mostly about.
  equal('an equal verb is not an escalation',
    scopeOf('Implemented the ingest pipeline', scopeSource), []);
  equal('a stronger source is not an escalation',
    scopeOf('Implemented the ingest pipeline', 'Architected the ingest pipeline.'), []);
  equal('a bullet with no matching source entry is left alone',
    scopeOf('Led the quarterly hiring committee', scopeSource), []);
  equal('a source stating the mandate in another sentence is respected',
    scopeOf('Led the payments rewrite',
      'Contributed to the payments rewrite. I led that payments effort end to end.'), []);
  // A source bullet that asserts no scope at all cannot be the weaker side of
  // a comparison. Before source statements were required to carry a verb, this
  // reported every sourced bullet whose source simply worded it differently.
  equal('a source with no scope verb is not evidence of inflation',
    scopeOf('Built the billing migration', 'The billing migration shipped in March.'), []);
  // ...but "worked on" IS the participation wording #3685 names, and reading
  // it as no-evidence let every tier-2 and tier-3 rewrite of it through.
  equal('worked on is participation evidence',
    scopeOf('Built the billing migration', 'Worked on the billing migration.'),
    ['built the billing migration']);
  equal('and the issue\'s own pairing of it',
    scopeOf('Led the migration', 'Worked on the migration.'), ['led the migration']);
  // `worked at` is employment, not scope. Scoring it as tier 1 would turn
  // every employer line into evidence that the candidate merely participated
  // in whatever it happened to share a noun with.
  equal('worked at is not scope evidence',
    scopeOf('Led the migration', 'Worked at Acme Labs on the migration.'), []);

  // A verb governs its own work item, not every item in the sentence. The
  // statement-wide tier let the strong half vouch for the weak one.
  const compound = 'Contributed to the billing migration and led the payments rewrite.';
  equal('a compound source does not lend its strong verb to the weak half',
    scopeOf('Led the billing migration.', compound), ['led the billing migration']);
  equal('and the half that really is tier 3 still passes',
    scopeOf('Led the payments rewrite.', compound), []);
  // The target side is clause-scoped too. Reading only the statement-initial
  // verb skipped a compound bullet entirely, because it opens at tier 1 and
  // the tier-3 half was never compared to anything.
  equal('a compound TARGET bullet is checked clause by clause',
    scopeOf('Contributed to the billing migration and led the payments rewrite.',
      'Contributed to the payments rewrite.'),
    ['led the payments rewrite']);
  // factStatements does not split on commas, so a bullet opening with a
  // modifier had no recognisable opening verb at all.
  equal('a bullet opening with a modifier is still checked',
    scopeOf('As tech lead, drove the migration.', 'Contributed to the migration.'),
    ['drove the migration']);
  // The whole bullet is still what gets quoted back, even though the clause is
  // what gets claimed.
  equal('the quoted CV line is the whole bullet, not the clause',
    scopeInflationClaims('As tech lead, drove the migration.', 'Contributed to the migration.')
      .map(claim => claim.line),
    ['As tech lead, drove the migration']);
  // "Led to" is causation, not a mandate. Splitting the target into clauses is
  // what puts a mid-sentence "and led to ..." at the start of one, where it
  // would otherwise read as a tier-3 ownership claim.
  equal('led to is a result, not an ownership claim',
    scopeOf('Refactored the pipeline and led to a faster speedup.', 'Contributed to the speedup.'),
    []);
  // The bare form opening a line is a job title. Read as a verb it blocked a
  // truthful CV: a summary line naming the role, against a source bullet that
  // says the candidate contributed to the same work item.
  equal('a leading job title is not an ownership claim',
    scopeOf('Lead backend engineer for the billing migration.', 'Contributed to the billing migration.'),
    []);
  equal('a title followed straight by a preposition is not an ownership claim',
    scopeOf('Architect for the payments platform.', 'Contributed to the payments platform.'),
    []);
  // A determiner marks the verb: the present-tense bullet of a current role is
  // still an ownership claim, and still checked.
  equal('present-tense "Lead the ..." is still an ownership claim',
    scopeOf('Lead the billing migration.', 'Contributed to the billing migration.'),
    ['lead the billing migration']);
  equal('a plural object after "Lead" is still the verb',
    scopeOf('Lead engineers through the billing migration.', 'Contributed to the billing migration.'),
    ['lead engineers through the billing migration']);

  // Several tier words are also ordinary nouns, so scoring every token let a
  // product name stand in for the verb: `drive` in "Google Drive" scored the
  // clause tier 3 and vouched for any ownership claim linked to it.
  equal('a noun homograph does not set the clause tier',
    scopeOf('Led the Google Drive integration.', 'Built the Google Drive integration.'),
    ['led the google drive integration']);

  // One shared token is not enough to call two entries the same work item.
  equal('a single shared token does not link unrelated entries',
    scopeOf('Designed the onboarding automation.', 'Supported the onboarding revamp for new hires.'),
    []);
  // ...and it stays one token however many times the bullet repeats it.
  // Counting matches rather than distinct matches let a repeated word clear the
  // two-token threshold by itself.
  equal('a repeated word is still one shared token',
    scopeOf('Owned the payments platform migration to payments v2.', 'Contributed to payments.'),
    []);
  // The guard must not swing the other way: two genuinely distinct shared
  // tokens still link, repetition or not.
  equal('two distinct shared tokens still link',
    scopeOf('Owned the payments platform migration to payments v2.',
      'Contributed to the payments platform.'),
    ['owned the payments platform migration to payments v2']);
  // Tier 1 claims participation, so it can never be an escalation.
  equal('a participation verb is never flagged',
    scopeOf('Supported the billing migration', 'Worked on the billing migration.'), []);
  // A real CV is a bullet list, and the marker survives stripMarkup. Left on,
  // it prefixed the claim value ("- led the migration"), which no allow_facts
  // entry a user would write can match — the escape hatch was unusable on
  // exactly the input this check exists for.
  equal('a bulleted CV yields the same claim as a plain sentence',
    scopeOf('- Led the migration', '- Contributed to the migration'), ['led the migration']);
  equal('a bulleted source is still matched',
    scopeInflationClaims('* Led the migration', '• Contributed to the migration')
      .map(claim => claim.sourceLine),
    ['Contributed to the migration']);

  // Unsourced adoption and reach claims (#3685), the other class that reads as
  // a fact while naming no number.
  const adoptionOf = (target, source) => adoptionClaims(target, source).map(claim => claim.value).sort();

  equal('an unsourced adoption claim is caught',
    adoptionOf('Internal tooling used daily across the engineering org', scopeSource),
    ['across the engineering org', 'used daily']);
  equal('company-wide reach with no source is caught',
    adoptionOf('Rolled the linter out company-wide', scopeSource), ['company-wide']);
  equal('a sourced adoption claim passes',
    adoptionOf('Used daily by the team', 'The tool is used daily by the platform team.'), []);
  // Matched per pattern, not per exact phrase, so a source wording its own
  // adoption differently still supports the generated line.
  equal('a differently worded source adoption claim still supports it',
    adoptionOf('Used daily across the engineering org',
      'Used daily by six teams across the wider org.'), []);
  // Both spellings of the long form. `org-wide` alone let an unsourced reach
  // claim through whenever the CV spelled the word out.
  equal('organization-wide is caught',
    adoptionOf('Rolled the linter out organization-wide.', scopeSource), ['organization-wide']);
  equal('organisation-wide is caught too',
    adoptionOf('Rolled the linter out organisation-wide.', scopeSource), ['organisation-wide']);
  // The source side is a lemma on purpose. Requiring it to repeat the CV's
  // exact phrasing punished paraphrase, which is what a tailored CV always
  // does to a source line.
  equal('a source that states adoption in its own words supports the claim',
    adoptionOf('Adopted by 3 teams.', 'Three teams adopted the tool.'), []);
  equal('and a reach claim the source words as a phrase, not a compound',
    adoptionOf('Rolled out company-wide.', 'The tool went out across the whole company.'), []);
  // `standard` was the one check whose source side was still a bare word, so
  // the wording a source most often uses for this claim did not count.
  equal('a standardised source evidences a standard-across claim',
    adoptionOf('Became standard across the platform teams.',
      'Standardised the linter across every team.'), []);
  equal('and the plural noun does too',
    adoptionOf('Became standard across the platform teams.',
      'Set coding standards for every team.'), []);
  equal('but a source that claims no standard at all is still caught',
    adoptionOf('Became standard across the platform teams.', 'Implemented a linter.'),
    ['standard across']);
  // Matched per statement: collapsing the document first let a phrase form
  // across a line break that neither line contains, and the resulting claim
  // had no CV line to quote back.
  equal('a phrase spanning two statements is not a claim',
    adoptionOf('...we used\nDaily standups ran on it.', 'nothing relevant here'), []);
  equal('every adoption claim carries the line it came from',
    adoptionClaims('Built internal tooling, used daily across the engineering org.', scopeSource)
      .every(claim => typeof claim.line === 'string' && claim.line.length > 0),
    true);

  console.log(`verify-cv-facts self-test: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

/** Print adoption claims no source makes, for a human to confirm. */
export function printAdvisoryFacts(facts = [], print = console.warn) {
  for (const { kind, value, line } of facts) {
    print(`  - unsourced ${kind} claim: ${value}`);
    if (line && line !== value) print(`      CV: ${line}`);
  }
}

/**
 * Print everything that made a verdict 'warn': advisory phrases, advisory
 * facts, and what the gate could not read.
 *
 * One function for the CLI and every renderer that calls assertFacts. The
 * renderers used to print the phrases and facts themselves and leave out the
 * coverage note, so a document the gate could not read showed a warning header
 * with no reason under it (#5348).
 *
 * @param {{warnings?: string[], advisoryFacts?: object[], coverage?: {message: string, spans: string[]}|null}} result
 * @param {(line: string) => void} [print]
 */
export function printFactWarnings(result, print = console.warn) {
  for (const phrase of result.warnings ?? []) print(`  - advisory phrase: ${phrase}`);
  printAdvisoryFacts(result.advisoryFacts, print);
  if (result.coverage) {
    print(`  - not checked: ${result.coverage.message}`);
    for (const span of result.coverage.spans.slice(0, 8)) print(`      ${span}`);
  }
}

/** Run the fact validator CLI and return its process exit code. */
export function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return runSelfTest();
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 1;
  }
  if (parsed.help || !parsed.targetArg) {
    console.log(usage());
    return parsed.help ? 0 : 1;
  }
  const targetPath = resolveInputPath(parsed.targetArg);
  if (!existsSync(targetPath)) {
    console.error(`ERROR: target file not found: ${parsed.targetArg}`);
    return 1;
  }
  // An explicit --source that does not exist is a typo, not empty evidence.
  // Read as '' it blocked every claim in the CV and told the user to "Add
  // career evidence" to cv.md, for facts their real cv.md holds.
  // generate-latex.mjs refuses the same case ("--source file not found"). The
  // default sources are left alone: article-digest.md is optional.
  const missingSources = parsed.sourcePaths.filter((p) => !existsSync(resolveInputPath(p)));
  if (missingSources.length > 0) {
    console.error(`ERROR: --source file not found: ${missingSources.join(', ')}`);
    return 1;
  }
  try {
    const result = verifyFacts(readFileSync(targetPath, 'utf-8'), {
      sourcePaths: parsed.sourcePaths.length ? parsed.sourcePaths : DEFAULT_SOURCES,
      configPath: parsed.configPath,
    });
    // On stderr, before any verdict line and regardless of it: with no config
    // the phrase lists are empty, so "passed" below means the phrase check never
    // ran. stdout stays clean so --json remains parseable.
    if (result.configMissing) {
      console.error(`⚠️  fact-gate config not found: ${parsed.configPath} — forbidden/advisory phrase checks did not run.`);
    }
    if (parsed.json) {
      console.log(JSON.stringify(result));
      return result.verdict === 'block' ? 1 : 0;
    }
    if (result.verdict === 'pass') {
      console.log(`CV fact check passed: ${basename(targetPath)}`);
      return 0;
    }
    if (result.verdict === 'warn') {
      console.error(`CV fact check warning: ${basename(targetPath)}`);
      printFactWarnings(result, console.error);
      return 0;
    }
    console.error(`CV fact check failed: ${basename(targetPath)}`);
    if (result.invented.length) {
      console.error('\nMetric-like claims absent from sources:');
      for (const claim of result.invented) console.error(`  - ${claim}`);
    }
    if (result.unsupportedFacts.length) {
      console.error('\nNon-metric facts absent from sources:');
      for (const claim of result.unsupportedFacts) {
        const { kind, value, line, sourceLine } = claim;
        console.error(`  - ${kind}: ${value}`);
        if (line && line !== value) console.error(`      CV:     ${line}`);
        if (sourceLine) console.error(`      source: ${sourceLine}`);
        if (kind === 'scope') {
          const advice = scopeClaimAdvice(claim);
          console.error(`      ${advice[0].toUpperCase()}${advice.slice(1)}`);
        }
      }
    }
    if (result.forbidden.length) {
      console.error('\nForbidden phrases found:');
      for (const phrase of result.forbidden) console.error(`  - ${phrase}`);
    }
    console.error(`\n${factSourceAdvice()}`);
    return 1;
  } catch (err) {
    if (parsed.json) {
      console.log(JSON.stringify({ verdict: 'block', invented: [], unsupportedFacts: [], advisoryFacts: [], forbidden: [], warnings: [], coverage: null, errors: [err.message] }));
      return 1;
    }
    console.error(`ERROR: ${err.message}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
