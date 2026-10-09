import { cleanChips } from "./clean-chips.mjs";

// Reviewed public Workday source, 2026-10-08; see recall-ranking design evidence.
// Primark is excluded: its robots.txt disallows Radancy's /search-jobs/ path.
const PORTUGAL_RETAIL_CONCEPTS = ["retail-assistant", "sales-assistant", "pharmacy-assistant"];
const AUCHAN_PORTUGAL = Object.freeze({
  name: "Auchan Portugal", provider: "workday", enabled: true,
  careers_url: "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail",
});

/** Select reviewed boards only; inputs never supply a URL or provider config.
 * @param {unknown} markets @param {unknown} occupationIds
 * @returns {import('./market-presets.mjs').MarketBoard[]} */
export function priorityCompaniesFor(markets, occupationIds) {
  return cleanChips(markets).includes("portugal") &&
    cleanChips(occupationIds).some(id => PORTUGAL_RETAIL_CONCEPTS.includes(id))
    ? [{ ...AUCHAN_PORTUGAL }] : [];
}
