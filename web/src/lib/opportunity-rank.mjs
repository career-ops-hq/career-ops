import { matchOccupationTitle, matchesOccupationTerms, resolveOccupations } from "./occupation-match.mjs";
import { resolveLocationInputs } from "./location-concepts.mjs";
import { normalizeTextKey } from "./core/normalize-text-key.mjs";
import { buildMarketPlan, classifyMarketLocation } from "./market-presets.mjs";

const text = value => normalizeTextKey(String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/([\p{L}]+)(?:\/a|\(a\))/giu, "$1"), " ").replace(/\s+/gu, " ");
const contains = (value, phrase) => Boolean(text(phrase)) && (` ${text(value)} `).includes(` ${text(phrase)} `);
const supplied = value => typeof value === "string" && value.trim().length > 0;

/** @typedef {import('./explore').DiscoveredOffer} DiscoveredOffer */
/** @typedef {import('./search-plan.mjs').SearchPlan} SearchPlan */
/** @typedef {{ total:number, components:{role:number, location:number, freshness:number, evidence:number}, reasons:string[], occupation?:import('./occupation-match.mjs').OccupationEvidence, geography?:{scope:string,input:string,matched:string} }} OpportunityMatch */

/** Eligible offers only. Observation time never substitutes for publication.
 * @param {DiscoveredOffer} offer @param {SearchPlan} plan @param {string} observedAt @returns {OpportunityMatch} */
export function rankOpportunity(offer, plan, observedAt) {
  const literals = [...plan.occupations.map(item => item.input), ...plan.effectiveFilters.positive.filter(term => !resolveOccupations([term]).resolved.length)];
  const literal = literals.find(term => matchesOccupationTerms(offer.title, [term]));
  const original = plan.occupations.find(item => item.input === literal);
  const occupation = original ? { occupationId: original.id, input: original.input, alias: original.input, language: original.language, kind: /** @type {'literal'} */ ("literal") } : literal ? undefined : matchOccupationTitle(offer.title, plan.occupations);
  const role = occupation?.kind === "literal" || literal ? 60 : occupation ? 50 : 0;
  const reasons = [role === 60 ? `Função pedida: «${literal ?? occupation?.input}».` : occupation ?
    `Função equivalente: «${occupation.alias}» corresponde a «${occupation.input}».` : "Sem correspondência profissional com a pesquisa."];

  let location = 0, geography;
  // Explicit city/metro evidence takes precedence over a selected country.
  const places = [...plan.locationResolution.locations, ...resolveLocationInputs(plan.effectiveFilters.markets, plan.phase).locations];
  for (const place of places) {
    const same = place.aliases.find(alias => contains(offer.location, alias));
    const metro = place.metroAliases.find(alias => contains(offer.location, alias));
    const score = same ? place.scope === "city" ? 25 : 10 : metro ? 20 : 0;
    if (score <= location) continue;
    location = score;
    geography = { scope: same ? place.scope : "metro", input: place.input, matched: same ?? metro };
  }
  for (const input of plan.locationResolution.unresolved) if (contains(offer.location, input) && location < 25) {
    location = 25;
    geography = { scope: "literal", input, matched: input };
  }
  if (location < 10) for (const market of plan.effectiveFilters.markets) {
    const policy = buildMarketPlan([market], [], plan.effectiveFilters.opportunityType, plan);
    if (!classifyMarketLocation(offer, policy).accepted) continue;
    location = 10;
    geography = { scope: market === "remote" ? "remote" : "country", input: market, matched: offer.location };
    break;
  }
  reasons.push(!geography ? "Localização sem correspondência com os critérios." : geography.scope === "city" ?
    `Localização: mesma cidade (${geography.input}).` : geography.scope === "metro" ?
    `Localização: Área Metropolitana de Lisboa (${geography.matched}).` : geography.scope === "remote" ?
    "Localização: trabalho remoto aceite." : geography.scope === "country" ?
    `Localização: país selecionado (${geography.input}).` : `Localização: termo pedido (${geography.input}).`);

  let published = supplied(offer.postedAt) && /^\d{4}-\d{2}-\d{2}$/.test(offer.postedAt) ? Date.parse(`${offer.postedAt}T00:00:00Z`) : NaN;
  if (Number.isFinite(published) && new Date(published).toISOString().slice(0, 10) !== offer.postedAt) published = NaN;
  const observed = Date.parse(observedAt);
  const age = Math.floor(observed / 86_400_000) - Math.floor(published / 86_400_000);
  const freshness = age >= 0 && age <= 7 ? 10 : age > 7 && age <= 30 ? 5 : 0;
  reasons.push(!Number.isFinite(age) ? "Data de publicação desconhecida." : age < 0 ?
    "Data de publicação futura; atualidade não pontuada." : age <= 7 ? "Publicada nos últimos 7 dias." :
    age <= 30 ? "Publicada há 8 a 30 dias." : "Publicada há mais de 30 dias.");
  const evidence = [offer.url, offer.company, offer.title, offer.location, offer.source].filter(supplied).length;
  reasons.push(`Evidência: ${evidence} de 5 campos de origem.`);
  return { total: role + location + freshness + evidence, components: { role, location, freshness, evidence }, reasons,
    ...(occupation ? { occupation } : {}), ...(geography ? { geography } : {}) };
}

const dateKey = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** @param {DiscoveredOffer[]} offers @param {SearchPlan} plan @param {string} observedAt @returns {DiscoveredOffer[]} */
export function rankOpportunities(offers, plan, observedAt) {
  return offers.map(offer => ({ ...offer, match: rankOpportunity(offer, plan, observedAt) }))
    .sort((a, b) => b.match.total - a.match.total || compare(dateKey(b.postedAt), dateKey(a.postedAt)) || compare(a.company, b.company) || compare(a.url, b.url));
}
