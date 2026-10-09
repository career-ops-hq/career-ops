import { resolveOccupations, expandOccupationTerms } from "./occupation-match.mjs";
import { resolveLocationInputs } from "./location-concepts.mjs";

const MARKET_LANGUAGES = {
  portugal: ["pt", "en"], spain: ["es", "en"], "united-kingdom": ["en"],
  switzerland: ["de", "fr", "en"], luxembourg: ["fr", "de", "en"], netherlands: ["nl", "en"],
  europe: ["pt", "es", "en", "fr", "de", "nl"], remote: ["en"],
};
const fold = value => value.normalize("NFD").replace(/\p{M}/gu, "");
const genderKey = value => fold(value).toLowerCase().replace(/\/a|\(a\)/gu, "").replace(/a\b/gu, "");

/** @typedef {import('./explore').ExploreFilters} ExploreFilters */
/** @typedef {{ phase: "broad", changes: string[], originalSinceDays: number, effectiveSinceDays: number, termsAdded: string[], locationsAdded: string[] }} SearchExpansion */
/** @typedef {{ phase: "precise" | "broad", effectiveFilters: ExploreFilters, occupations: ReturnType<typeof resolveOccupations>["resolved"], occupationIds: string[], locationResolution: ReturnType<typeof resolveLocationInputs>, expansion: SearchExpansion }} SearchPlan */

/** Build an ephemeral search variant; the original UI filters never change.
 * @param {ExploreFilters} filters @param {"precise" | "broad"} phase @returns {SearchPlan} */
export function buildSearchPlan(filters, phase) {
  const { resolved: occupations } = resolveOccupations(filters.positive);
  const spellings = [...filters.positive];
  for (const input of filters.positive) {
    const occupation = occupations.find(item => item.input === input);
    const aliases = occupation?.concept.aliases[occupation.language] ?? [];
    const equivalent = aliases.filter(alias => genderKey(alias) === genderKey(input));
    spellings.push(...equivalent);
    for (const alias of equivalent) {
      const counterpart = equivalent.find(other => other !== alias && other.toLowerCase() === alias.toLowerCase().replace(/r\b/gu, "ra"));
      if (counterpart) spellings.push(alias.replace(/r\b/gu, "r/a"), alias.replace(/r\b/gu, "r(a)"));
    }
    if (/\/a|\(a\)/u.test(input)) spellings.push(input.replace(/\/a|\(a\)/gu, ""), input.replace(/\/a|\(a\)/gu, "a"));
  }
  spellings.push(...spellings.map(fold));
  const preciseTerms = [...new Set(spellings)].slice(0, 12);
  const sameCity = resolveLocationInputs(filters.allow, "precise");
  const locationResolution = phase === "precise" ? sameCity : resolveLocationInputs(filters.allow, "broad");
  const languages = [...new Set([...occupations.map(item => item.language), ...filters.markets.flatMap(market => MARKET_LANGUAGES[market] ?? []), "en"])];
  // Keep literal spelling variants for the substring-based scanner, then add
  // concept aliases from Task 1 within the same bounded positive-term budget.
  const positive = phase === "precise" ? preciseTerms : [...new Set([...preciseTerms, ...expandOccupationTerms(filters.positive, languages).terms])].slice(0, 12);
  const sinceDays = phase === "broad" ? Math.max(filters.sinceDays, 30) : filters.sinceDays;
  const termsAdded = phase === "broad" ? positive.filter(term => !preciseTerms.includes(term)) : [];
  const locationsAdded = phase === "broad" ? locationResolution.terms.filter(term => !sameCity.terms.includes(term)) : [];
  const changes = [];
  if (termsAdded.length) changes.push(`Funções equivalentes: ${termsAdded.join(", ")}.`);
  if (locationsAdded.length) changes.push(`Área metropolitana: ${locationsAdded.join(", ")}.`);
  if (sinceDays !== filters.sinceDays) changes.push(`Janela de pesquisa: ${filters.sinceDays} → ${sinceDays} dias.`);
  return {
    phase, effectiveFilters: { ...structuredClone(filters), positive, allow: locationResolution.terms, sinceDays },
    occupations, occupationIds: [...new Set(occupations.map(item => item.id))], locationResolution,
    expansion: { phase: "broad", changes, originalSinceDays: filters.sinceDays, effectiveSinceDays: sinceDays, termsAdded, locationsAdded },
  };
}
