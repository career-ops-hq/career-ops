import { cleanChips } from "./clean-chips.mjs";
import { normalizeTextKey } from "./core/normalize-text-key.mjs";

// Local geography catalog v1. Only Lisbon has an explicitly enumerated metro
// scope (the 18 AML municipalities including Lisbon itself); no radius inference.
const LISBON_METRO = ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"];
const COUNTRIES = [
  ["portugal", ["Portugal", "PT"]],
  ["spain", ["Espanha", "España", "Spain", "Espagne", "Spanien", "Spanje", "ES"]],
  ["united-kingdom", ["Reino Unido", "United Kingdom", "Royaume-Uni", "Vereinigtes Königreich", "Verenigd Koninkrijk", "UK", "GB"]],
  ["switzerland", ["Suíça", "Suiza", "Switzerland", "Suisse", "Schweiz", "Zwitserland", "CH"]],
  ["luxembourg", ["Luxemburgo", "Luxembourg", "Luxemburg", "LU"]],
  ["netherlands", ["Países Baixos", "Países Bajos", "Netherlands", "The Netherlands", "Pays-Bas", "Niederlande", "Nederland", "NL"]],
];
const CITIES = [
  ["lisbon", "portugal", ["Lisboa", "Lisbon", "Lisbonne", "Lissabon"], LISBON_METRO],
  ["porto", "portugal", ["Porto", "Oporto"]],
  ["madrid", "spain", ["Madrid", "Madri"]],
  ["barcelona", "spain", ["Barcelona", "Barcelone"]],
  ["valencia", "spain", ["Valencia", "València", "Valência", "Valence"]],
  ["seville", "spain", ["Sevilla", "Seville", "Sevilha"]],
  ["london", "united-kingdom", ["London", "Londres", "Londen"]],
  ["edinburgh", "united-kingdom", ["Edinburgh", "Edimburgo", "Édimbourg"]],
  ["geneva", "switzerland", ["Genebra", "Geneva", "Genève", "Genf", "Ginebra"]],
  ["zurich", "switzerland", ["Zurique", "Zurich", "Zürich", "Zúrich"]],
  ["basel", "switzerland", ["Basileia", "Basel", "Bâle"]],
  ["luxembourg-city", "luxembourg", ["Luxembourg City", "Cidade do Luxemburgo", "Ville de Luxembourg", "Luxemburg Stadt"]],
  ["amsterdam", "netherlands", ["Amesterdão", "Amsterdam", "Ámsterdam"]],
  ["the-hague", "netherlands", ["Haia", "The Hague", "Den Haag", "La Haye", "La Haya"]],
  ["rotterdam", "netherlands", ["Roterdão", "Rotterdam"]],
];
const LOCATIONS = [
  ...COUNTRIES.map(([market, aliases]) => ({ id: market, market, aliases, scope: "country" })),
  ...CITIES.map(([id, market, aliases, metroAliases = []]) => ({ id, market, aliases, metroAliases, scope: "city" })),
  { id: "remote", market: "remote", scope: "remote", aliases: ["Remoto", "Remota", "Remote", "Télétravail", "Homeoffice", "Op afstand"] },
];

function normalized(value) {
  return normalizeTextKey(value.normalize("NFD").replace(/\p{M}/gu, ""), " ").replace(/\s+/gu, " ");
}

function unique(terms) {
  const seen = new Set();
  return terms.filter(term => {
    const key = normalized(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @typedef {{ id: string, input: string, scope: "city" | "country" | "remote", market: string, aliases: string[], metroAliases: string[] }} ResolvedLocation */
/** @typedef {{ phase: "precise" | "broad", terms: string[], locations: ResolvedLocation[], markets: string[], unresolved: string[], expansions: { input: string, added: string[], reason: string }[] }} LocationResolution */

/** Exact input resolution: unknown/qualified names retain only their literal.
 * Precise contains same-place aliases; broad additionally contains enumerated
 * metro municipalities. Country and remote scopes never gain a metro area.
 * @param {unknown} inputs @param {"precise" | "broad"} phase @returns {LocationResolution} */
export function resolveLocationInputs(inputs, phase) {
  const originals = unique(cleanChips(inputs));
  const terms = [...originals], locations = [], markets = [], unresolved = [], expansions = [];
  for (const input of originals) {
    const concept = LOCATIONS.find(location => location.aliases.some(alias => normalized(alias) === normalized(input)));
    if (!concept) { unresolved.push(input); continue; }
    const aliases = [...concept.aliases];
    const metroAliases = phase === "broad" ? [...(concept.metroAliases ?? [])] : [];
    locations.push({ id: concept.id, input, scope: concept.scope, market: concept.market, aliases, metroAliases });
    if (!markets.includes(concept.market)) markets.push(concept.market);
    terms.push(...aliases, ...metroAliases);
    if (metroAliases.length) expansions.push({
      input, added: metroAliases,
      reason: "Área Metropolitana de Lisboa: inclui apenas os municípios enumerados no catálogo local.",
    });
  }
  return { phase, terms: unique(terms), locations, markets, unresolved, expansions };
}
