import { cleanChips } from "./clean-chips.mjs";
import { priorityCompaniesFor } from "./priority-companies.mjs";

/** @typedef {"portugal" | "spain" | "united-kingdom" | "switzerland" | "luxembourg" | "netherlands" | "europe" | "remote"} MarketId */
/** @typedef {"employment" | "freelance"} OpportunityType */
/** @type {MarketId[]} */
export const MARKET_IDS = ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands", "europe", "remote"];

/** @param {unknown} value @returns {MarketId[]} */
export function cleanMarkets(value) {
  return cleanChips(value).map((v) => v.toLowerCase()).filter(
    /** @returns {value is MarketId} */ (value) => MARKET_IDS.includes(/** @type {MarketId} */ (value)),
  );
}

/** @param {unknown} markets */
export function encodeMarkets(markets) {
  return cleanMarkets(markets).join(",");
}

/** @param {unknown} value */
export function decodeMarkets(value) {
  return cleanMarkets(typeof value === "string" ? value.split(",") : []);
}

const EUROPE_CODES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"];
const COUNTRY_CODES = {
  portugal: ["PT"], spain: ["ES"], "united-kingdom": ["GB"],
  switzerland: ["CH"], luxembourg: ["LU"], netherlands: ["NL"],
};
const REMOTE_BOARDS = [
  ["RemoteOK", "remoteok"], ["Remotive", "remotive"], ["Himalayas", "himalayas"],
  ["Jobicy", "jobicy"], ["Jobspresso", "jobspresso"], ["Working Nomads", "workingnomads"],
  ["We Work Remotely", "weworkremotely"],
];

/** @typedef {{ name: string, provider: string, enabled: boolean, careers_url?: string, api?: string, lang?: string, wttj?: { queries: string[], filters: string } }} MarketBoard */

/** The caller supplies positive terms, or profile terms when positives are empty.
 *  This pure planner never invents a search query or reads the user's files.
 *  @param {unknown} selected @param {unknown} terms @param {unknown} opportunityType
 *  @param {{ occupationIds?: string[], locationResolution?: import('./location-concepts.mjs').LocationResolution }} [searchPlan] */
export function buildMarketPlan(selected, terms, opportunityType = "employment", searchPlan = {}) {
  const markets = cleanMarkets(selected);
  const queries = cleanChips(terms);
  const type = opportunityType === "freelance" ? "freelance" : "employment";
  if (type === "freelance") {
    const countries = new Set();
    let remote = false;
    for (const market of markets) {
      if (market === "europe") for (const code of EUROPE_CODES) countries.add(code);
      else if (market === "remote") remote = true;
      else for (const code of COUNTRY_CODES[market] ?? []) countries.add(code);
    }
    const geography = [...countries].map(code => `offices.country_code:${code}`);
    if (remote) geography.push("remote:fulltime");
    const geographicFilter = geography.length > 1 ? `(${geography.join(" OR ")})` : geography[0];
    const filters = ["contract_type:freelance", geographicFilter].filter(Boolean).join(" AND ");
    return {
      opportunityType: type,
      markets,
      jobBoards: [{ name: "Welcome to the Jungle", provider: "wttj", enabled: true, wttj: { queries, filters } }],
      locationPolicy: { markets, strict: markets.length > 0, locationResolution: searchPlan.locationResolution },
      skippedSources: [],
    };
  }
  /** @type {Map<string, MarketBoard>} */
  const boards = new Map();
  const wttjCountries = new Set();
  /** @type {{ source: string, reason: string }[]} */
  const skippedSources = [];
  /** @param {MarketBoard} board */
  const add = (board) => boards.set(`${board.provider}:${board.careers_url || board.api ? new URL(board.careers_url || board.api).hostname : board.lang ?? ""}`, board);
  for (const board of priorityCompaniesFor(markets, searchPlan.occupationIds)) add(board);
  for (const market of markets) {
    if (market === "portugal" || market === "europe") {
      add({ name: "Landing.jobs", provider: "landingjobs", enabled: true });
    }
    if (market === "portugal" || market === "spain" || COUNTRY_CODES[market]) {
      for (const code of COUNTRY_CODES[market] ?? []) wttjCountries.add(code);
    }
    if (market === "spain" || market === "europe") {
      for (const lang of ["ES", "EN"]) add({ name: `getManfred (${lang})`, provider: "manfred", lang, enabled: true });
    }
    if (market === "europe") {
      for (const code of EUROPE_CODES) wttjCountries.add(code);
    }
    if (market === "remote") {
      for (const [name, provider] of REMOTE_BOARDS) add({ name, provider, enabled: true });
    }
  }
  if (wttjCountries.size) {
    if (queries.length) add({ name: "Welcome to the Jungle", provider: "wttj", enabled: true, wttj: {
      queries, filters: [...wttjCountries].map((code) => `offices.country_code:${code}`).join(" OR "),
    } });
    else skippedSources.push({ source: "wttj", reason: "missing-search-terms" });
  }
  return { opportunityType: type, markets, jobBoards: [...boards.values()], locationPolicy: { markets, strict: markets.length > 0, locationResolution: searchPlan.locationResolution }, skippedSources };
}

function normalized(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

// Country abbreviations are tokens, never substrings (PT must not match Egypt).
function containsWord(location, words) {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${words.join("|")})(?=$|[^\\p{L}\\p{N}_])`, "u").test(location);
}

const PORTUGAL = ["portugal", "pt"];
const SPAIN = ["spain", "espana", "espanha", "es"];
const EUROPE = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia", "czech republic",
  "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
  "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal",
  "romania", "slovakia", "slovenia", "spain", "sweden", "iceland", "liechtenstein", "norway",
  "united kingdom", "uk", "switzerland", "europe", "europa", "eu", "eea", "eee",
  "england", "scotland", "wales", "northern ireland", ...SPAIN,
];
const PORTUGUESE_CITIES = ["lisbon", "lisboa", "porto", "oporto", "braga", "coimbra", "faro", "aveiro", "setubal", "funchal"];
const SPANISH_CITIES = ["madrid", "barcelona", "valencia", "sevilla", "seville", "malaga", "bilbao", "zaragoza"];
const MARKET_LOCATIONS = {
  portugal: { names: PORTUGAL, cities: PORTUGUESE_CITIES },
  spain: { names: SPAIN, cities: SPANISH_CITIES },
  "united-kingdom": { names: ["united kingdom", "great britain", "uk", "gb", "england", "scotland", "wales", "northern ireland"], cities: ["london", "edinburgh", "glasgow", "manchester", "birmingham", "bristol", "leeds", "liverpool", "cardiff", "belfast"] },
  switzerland: { names: ["switzerland", "ch"], cities: ["zurich", "geneva", "basel", "bern", "lausanne", "lucerne", "lugano"] },
  luxembourg: { names: ["luxembourg", "lu"], cities: ["luxembourg city", "esch-sur-alzette", "differdange"] },
  netherlands: { names: ["netherlands", "the netherlands", "holland", "nl"], cities: ["amsterdam", "rotterdam", "the hague", "utrecht", "eindhoven", "groningen", "maastricht"] },
};
const OTHER_COUNTRIES = [...new Set([
  ...EUROPE.filter(name => !["europe", "europa", "eu", "eea", "eee"].includes(name)),
  ...Object.values(MARKET_LOCATIONS).flatMap(({ names }) => names),
  ...Object.values(COUNTRY_CODES).flat(),
  "united states", "usa", "us", "canada", "brazil", "australia", "india", "singapore",
  "wisconsin", "south carolina", "new york", "texas",
])];
const ISO_COUNTRY_CODES = new Set(EUROPE_CODES.map(code => code.toLowerCase()));

function locationGroups(location) {
  return location.split(/[;|/]+/u).map(part => part.trim()).filter(Boolean);
}

function locationParts(location) {
  return location.split(/[,()[\]]/u).map(normalized).map(part => part
    .replace(/^(remote|hybrid|on-site|onsite)\s*[-:]?\s*/u, "")
    .replace(/\s*[-:]?\s*(remote|hybrid|on-site|onsite)$/u, "")
    .trim()).filter(Boolean);
}

function countryLocation(location, market, resolution) {
  const target = MARKET_LOCATIONS[market];
  if (!target) return false;
  const resolved = resolution?.locations.filter(item => item.market === market) ?? [];
  const names = [...target.names, ...resolved.filter(item => item.scope === "country").flatMap(item => item.aliases).map(normalized)];
  const resolvedCities = resolved.filter(item => item.scope === "city").flatMap(item => [...item.aliases, ...item.metroAliases]).map(normalized);
  const cities = [...target.cities, ...resolvedCities];
  const targetCodes = new Set((COUNTRY_CODES[market] ?? []).map(code => code.toLowerCase()));
  return locationGroups(location).some(group => {
    const normalizedGroup = normalized(group);
    const parts = locationParts(group);
    // ponytail: unknown qualifiers fail closed; add observed neighborhood/postcode forms to the catalog when needed.
    if (parts.some(part => resolvedCities.includes(part)) &&
        parts.some(part => !cities.includes(part) && !names.includes(part))) return false;
    const matchedTargets = names.filter(name => containsWord(normalizedGroup, [name]));
    const targetCountry = matchedTargets.length > 0;
    const foreignCountry = OTHER_COUNTRIES
      .map(normalized)
      .filter(name => !names.includes(name) && !ISO_COUNTRY_CODES.has(name))
      .some(name => {
        if (matchedTargets.some(targetName => targetName.includes(name))) return false;
        return parts.includes(name) || containsWord(normalizedGroup, [name]);
      }) || parts.some(part => ISO_COUNTRY_CODES.has(part) && !targetCodes.has(part));
    if (foreignCountry) return false;
    return targetCountry || parts.some(part => cities.includes(part));
  });
}

/** Infer only the one local market whose city/country signals are unambiguous.
 *  Explicit selections always win; mixed or remote locations stay uninferred.
 *  @param {unknown} selected @param {unknown} locations @returns {MarketId[]} */
export function inferMarketsFromLocations(selected, locations) {
  const markets = cleanMarkets(selected);
  if (markets.length) return markets;
  const requested = cleanChips(locations);
  if (!requested.length) return [];
  const groups = requested.flatMap(locationGroups);
  const unambiguousPortugal = (group) => {
    if (!countryLocation(group, "portugal")) return false;
    const parts = locationParts(group);
    return parts.length <= 1 || parts.every(part => PORTUGAL.includes(part) || PORTUGUESE_CITIES.includes(part));
  };
  return groups.length && groups.every(unambiguousPortugal) ? ["portugal"] : [];
}

/** Geographic policies are alternatives. A remote source proves remote work,
 *  never worldwide eligibility. Missing location fails closed on every market.
 *  @param {{ location?: unknown, source?: string, sources?: string[], ats?: string, provider?: string }} offer
 *  @param {ReturnType<typeof buildMarketPlan>} plan
 *  @returns {{ accepted: boolean, reason?: "missing-location" | "outside-market", remote?: true, eligibility?: "unknown" }} */
export function classifyMarketLocation(offer, plan) {
  const rawLocation = typeof offer.location === "string" ? offer.location.trim() : "";
  const location = normalized(rawLocation);
  if (!location || /^(n\/?a|unknown|not specified|not indicated|unspecified|[-—])$/.test(location)) {
    return plan.locationPolicy.strict ? { accepted: false, reason: "missing-location" } : { accepted: true };
  }
  // A bare normalized city is usable; a city in an unrelated country is not.
  const resolution = plan.locationPolicy.locationResolution;
  // Reject conflicts before any selected country, Europe or remote can admit
  // a resolved city through its foreign qualifier.
  for (const group of locationGroups(location)) {
    const parts = locationParts(group);
    if (resolution?.locations.some(item => item.scope === "city" &&
        parts.some(part => [...item.aliases, ...item.metroAliases].some(alias => normalized(alias) === part)) &&
        !countryLocation(group, item.market, resolution))) {
      return { accepted: false, reason: "outside-market" };
    }
  }
  if (!plan.locationPolicy.strict) return { accepted: true };
  const portugal = countryLocation(location, "portugal", resolution);
  const spain = countryLocation(location, "spain", resolution);
  const unitedKingdom = countryLocation(location, "united-kingdom", resolution);
  const switzerland = countryLocation(location, "switzerland", resolution);
  const luxembourg = countryLocation(location, "luxembourg", resolution);
  const netherlands = countryLocation(location, "netherlands", resolution);
  // ISO codes retain case: English "at" is not the country code AT.
  const europe = portugal || spain || containsWord(location, EUROPE) || containsWord(rawLocation, EUROPE_CODES);
  for (const market of plan.markets) {
    if ((market === "portugal" && portugal) || (market === "spain" && spain) ||
        (market === "united-kingdom" && unitedKingdom) || (market === "switzerland" && switzerland) ||
        (market === "luxembourg" && luxembourg) || (market === "netherlands" && netherlands) ||
        (market === "europe" && europe)) {
      return { accepted: true };
    }
    if (market === "remote") {
      const origins = [offer.source, offer.ats, offer.provider, ...(offer.sources ?? [])].filter((v) => typeof v === "string").map(v => normalized(v).replace(/-(api|full)$/, ""));
      const remoteSource = REMOTE_BOARDS.some(([name, id]) => origins.includes(normalized(name)) || origins.includes(id));
      if (remoteSource || containsWord(location, ["remote", "remoto", "remota"])) {
        return { accepted: true, remote: true, eligibility: "unknown" };
      }
    }
  }
  return { accepted: false, reason: "outside-market" };
}
