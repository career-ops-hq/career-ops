import { cleanChips } from "./clean-chips.mjs";
import { normalizeTextKey } from "./core/normalize-text-key.mjs";
import { OCCUPATION_CONCEPTS } from "./occupation-concepts.mjs";
import { AND_SEPARATOR, STEM_PREFIX, WORD_PREFIX, buildTitleFilter } from "../../title-keywords.mjs";

// Same accent folding and Unicode word semantics as market-presets.mjs.
function normalized(value) {
  return normalizeTextKey(String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/([\p{L}]+)(?:\/a|\(a\))/giu, "$1"), " ").replace(/\s+/gu, " ");
}

function containsPhrase(text, phrase) {
  return (` ${text} `).includes(` ${normalized(phrase)} `);
}

/** @typedef {{ id: string, input: string, alias: string, language: string, concept: typeof OCCUPATION_CONCEPTS[number] }} ResolvedOccupation */
/** @typedef {{ occupationId: string, input: string, alias: string, language: string, kind: "literal" | "alias" }} OccupationEvidence */

/** @param {unknown} inputs @returns {{ resolved: ResolvedOccupation[], unresolved: string[], ambiguous: string[] }} */
export function resolveOccupations(inputs) {
  const resolved = [], unresolved = [], ambiguous = [];
  for (const input of cleanChips(inputs)) {
    const key = normalized(input);
    const candidates = [];
    for (const concept of OCCUPATION_CONCEPTS) {
      for (const [language, aliases] of Object.entries(concept.aliases)) {
        const alias = [...aliases, ...(concept.inputs?.[language] ?? [])].find(term => normalized(term) === key);
        if (alias) { candidates.push({ id: concept.id, input, alias, language, concept }); break; }
      }
    }
    if (candidates.length === 1) resolved.push(candidates[0]);
    else if (candidates.length > 1) ambiguous.push(input);
    else unresolved.push(input);
  }
  return { resolved, unresolved, ambiguous };
}

/** Original literals always precede translations; omitted includes capped literals.
 * @param {unknown} inputs @param {string[]} languages @param {number} [limit=12] */
export function expandOccupationTerms(inputs, languages, limit = 12) {
  const originals = cleanChips(inputs);
  const { resolved: occupations } = resolveOccupations(originals);
  const candidates = [...originals];
  for (const occupation of occupations) {
    for (const language of cleanChips(languages).map(language => language.toLowerCase().split("-")[0])) {
      candidates.push(...(occupation.concept.queryTerms[language] ?? []));
    }
  }
  const seen = new Set();
  const unique = candidates.filter(term => {
    const key = normalized(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cap = Number.isFinite(limit) ? Math.min(12, Math.max(0, Math.floor(limit))) : 12;
  return { terms: unique.slice(0, cap), occupations, omitted: unique.slice(cap) };
}

/** @param {string} title @param {ResolvedOccupation[]} occupations @returns {OccupationEvidence | null} */
export function matchOccupationTitle(title, occupations) {
  const text = normalized(title);
  // Literal matches win even when an earlier input would match via translation.
  for (const kind of ["literal", "alias"]) {
    for (const occupation of occupations) {
      const { concept, input } = occupation;
      if (!concept.requiredTokens.some(group => group.every(token => containsPhrase(text, token)))) continue;
      for (const [language, aliases] of Object.entries(concept.aliases)) {
        for (const alias of aliases) {
          if (kind === "literal" && normalized(alias) !== normalized(input)) continue;
          if (containsPhrase(text, alias)) return { occupationId: occupation.id, input, alias: kind === "literal" ? input : alias, language, kind };
        }
      }
    }
  }
  return null;
}

/** Effective terms already encode precise/broad intent; explicit operators use
 * the scanner's canonical semantics, while literals keep word boundaries.
 * @param {string} title @param {string[]} terms */
export function matchesOccupationTerms(title, terms) {
  if (!terms.length) return true;
  const evidence = matchOccupationTitle(title, resolveOccupations(terms).resolved);
  if (evidence && terms.some(term => normalized(term) === normalized(evidence.alias))) return true;
  return terms.some(term => {
    const keyword = term.trim().toLowerCase();
    if (keyword.startsWith(WORD_PREFIX) || keyword.startsWith(STEM_PREFIX) || AND_SEPARATOR.test(keyword)) {
      return buildTitleFilter({ positive: [term] })(title);
    }
    return containsPhrase(normalized(title), term);
  });
}
