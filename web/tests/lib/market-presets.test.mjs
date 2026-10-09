import { test } from "node:test";
import assert from "node:assert/strict";
import * as marketPresets from "../../src/lib/market-presets.mjs";
import { mergeDiscoveredOffers } from "../../src/lib/core/market-merge.mjs";
import { resolveLocationInputs } from "../../src/lib/location-concepts.mjs";

const { cleanMarkets, encodeMarkets, decodeMarkets, buildMarketPlan, classifyMarketLocation } = marketPresets;

test("Portuguese retail and pharmacy concepts place Auchan before existing market boards", () => {
  for (const occupationId of ["retail-assistant", "sales-assistant", "pharmacy-assistant"]) {
    const plan = buildMarketPlan(["portugal"], ["Operador de Loja"], "employment", { occupationIds: [occupationId] });
    assert.deepEqual(plan.jobBoards, [
      { name: "Auchan Portugal", provider: "workday", enabled: true, careers_url: "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail" },
      { name: "Landing.jobs", provider: "landingjobs", enabled: true },
      { name: "Welcome to the Jungle", provider: "wttj", enabled: true, wttj: { queries: ["Operador de Loja"], filters: "offices.country_code:PT" } },
    ]);
  }
});

test("directed sources collapse repeated markets and concepts while retaining all generic feeds", () => {
  const plan = buildMarketPlan(["portugal", "portugal", "spain", "europe", "remote"], ["Sales Assistant"], "employment", {
    occupationIds: ["retail-assistant", "retail-assistant", "sales-assistant", "pharmacy-assistant"],
  });
  assert.deepEqual(plan.jobBoards.map(board => [board.provider, board.lang ?? ""]), [
    ["workday", ""], ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"],
    ["remoteok", ""], ["remotive", ""], ["himalayas", ""], ["jobicy", ""], ["jobspresso", ""], ["workingnomads", ""], ["weworkremotely", ""], ["wttj", ""],
  ]);
  assert.equal(plan.jobBoards.filter(board => board.careers_url?.includes("auchanportugal")).length, 1);
  assert.equal(plan.jobBoards.some(board => /primark/i.test(JSON.stringify(board))), false);
});

test("unrelated concepts, countries and freelance cannot select directed employers", () => {
  for (const markets of [[], ["spain"], ["united-kingdom"], ["switzerland"], ["luxembourg"], ["netherlands"], ["remote"], ["europe"]]) {
    assert.equal(buildMarketPlan(markets, ["Sales Assistant"], "employment", { occupationIds: ["retail-assistant"] }).jobBoards.some(board => board.provider === "workday"), false);
  }
  for (const occupationIds of [[], ["web-developer"], ["app-developer"], ["chatbot-developer"], ["ai-automation"], ["unknown"]]) {
    assert.equal(buildMarketPlan(["portugal"], ["Operador de Loja"], "employment", { occupationIds }).jobBoards.some(board => board.provider === "workday"), false);
  }
  assert.equal(buildMarketPlan(["portugal"], ["Sales Assistant"], "freelance", { occupationIds: ["retail-assistant"] }).jobBoards.some(board => board.provider === "workday"), false);
});

test("priority catalog accepts selectors only and returns independent reviewed boards", async () => {
  const catalog = await import("../../src/lib/priority-companies.mjs").catch(() => ({}));
  assert.equal(typeof catalog.priorityCompaniesFor, "function");
  const injectedUrl = "http://127.0.0.1/private";
  assert.deepEqual(catalog.priorityCompaniesFor([injectedUrl], ["retail-assistant"]), []);
  assert.deepEqual(catalog.priorityCompaniesFor(["portugal"], [injectedUrl, { careers_url: injectedUrl }]), []);
  const boards = catalog.priorityCompaniesFor(["portugal", "portugal"], ["retail-assistant", "pharmacy-assistant"]);
  assert.equal(boards.length, 1);
  boards[0].careers_url = injectedUrl;
  assert.equal(catalog.priorityCompaniesFor(["portugal"], ["retail-assistant"])[0].careers_url, "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail");
  const plan = buildMarketPlan(["portugal"], [injectedUrl], "employment", { occupationIds: ["retail-assistant"], priorityCompanies: [{ provider: "workday", careers_url: injectedUrl }] });
  assert.equal(plan.jobBoards[0].careers_url, "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail");
});

test("resolved city aliases and explicit metro terms reject even unknown foreign qualifiers", () => {
  for (const phase of ["precise", "broad"]) {
    const plan = buildMarketPlan(["portugal"], [], "employment", { locationResolution: resolveLocationInputs("Lisboa", phase), occupationIds: ["retail-assistant"] });
    for (const city of ["Lisbonne", "Lissabon"]) assert.equal(classifyMarketLocation({ location: city }, plan).accepted, true);
    for (const city of ["Amadora", "Oeiras", "Sintra", "Cascais"]) assert.equal(classifyMarketLocation({ location: city }, plan).accepted, phase === "broad");
    for (const location of ["Lisbonne, Angola", "Lissabon, ZA", "Amadora, Argentina", "Sintra, XX"]) assert.equal(classifyMarketLocation({ location }, plan).accepted, false, location);
  }
});

test("alternative markets cannot override a resolved city or metro country conflict", () => {
  for (const markets of [["europe"], ["portugal", "spain"], ["united-kingdom", "remote"]]) {
    for (const phase of ["precise", "broad"]) {
      const plan = buildMarketPlan(markets, [], "employment", { locationResolution: resolveLocationInputs("Lisboa", phase) });
      for (const location of ["Lisbonne, France", "Lisbon, UK", "Lisboa, Spain", "Lisbon, UK; Madrid, Spain"]) {
        assert.deepEqual(classifyMarketLocation({ location, source: "remotive-api" }, plan), { accepted: false, reason: "outside-market" }, `${markets} ${phase} ${location}`);
      }
      if (phase === "broad") {
        for (const location of ["Amadora, Spain", "Sintra, France", "Oeiras, UK", "Cascais, ES"]) {
          assert.equal(classifyMarketLocation({ location }, plan).accepted, false, `${markets} ${location}`);
        }
      }
    }
  }
  for (const markets of [["europe"], ["portugal", "spain"]]) {
    const plan = buildMarketPlan(markets, [], "employment", { locationResolution: resolveLocationInputs("Lisboa", "broad") });
    for (const location of ["Lisbonne, Portugal", "Lisbon, PT", "Amadora, Portugal", "Sintra, PT", "Lisbon Hybrid, Portugal", "Lisboa, Portugal; Madrid, Spain"]) {
      assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
    }
    // A city-resolution guard must not change literal market-only selection.
    const literal = buildMarketPlan(markets, []);
    assert.equal(classifyMarketLocation({ location: "Amadora, Spain" }, literal).accepted, true);
    assert.equal(classifyMarketLocation({ location: "Madrid, Spain" }, plan).accepted, true);
  }
  assert.equal(classifyMarketLocation({ location: "Lisbonne, France" }, buildMarketPlan(["europe"], [])).accepted, true);
});

test("market codec defaults empty and drops unknown and duplicate selections", () => {
  assert.deepEqual(cleanMarkets(undefined), []);
  assert.deepEqual(decodeMarkets(null), []);
  assert.equal(encodeMarkets([]), "");
  assert.deepEqual(cleanMarkets([" PORTUGAL ", "spain", "Portugal", "greenhouse", 3]), ["portugal", "spain"]);
  assert.deepEqual(decodeMarkets("europe,remote,europe,invalid"), ["europe", "remote"]);
  assert.equal(encodeMarkets(["spain", "spain", "remote"]), "spain,remote");
  assert.deepEqual(cleanMarkets(["united-kingdom", "switzerland", "luxembourg", "netherlands"]), [
    "united-kingdom", "switzerland", "luxembourg", "netherlands",
  ]);
});

test("empty markets select no boards or strict geography", () => {
  const plan = buildMarketPlan([], ["designer"]);
  assert.deepEqual(plan.jobBoards, []);
  assert.equal(plan.locationPolicy.strict, false);
  assert.deepEqual(classifyMarketLocation({ location: "" }, plan), { accepted: true });
});

test("freelance uses one WTTJ plan with contract filters and no invented geography", () => {
  const plan = buildMarketPlan([], ["web designer"], "freelance");
  assert.equal(plan.opportunityType, "freelance");
  assert.equal(plan.locationPolicy.strict, false);
  assert.deepEqual(plan.jobBoards, [{
    name: "Welcome to the Jungle",
    provider: "wttj",
    enabled: true,
    wttj: { queries: ["web designer"], filters: "contract_type:freelance" },
  }]);
});

test("freelance combines countries and full remote in one deduplicated WTTJ filter", () => {
  const plan = buildMarketPlan(["portugal", "spain", "europe", "remote"], ["automation"], "freelance");
  assert.equal(plan.jobBoards.length, 1);
  assert.equal(plan.jobBoards[0].provider, "wttj");
  assert.equal(plan.jobBoards[0].wttj.queries[0], "automation");
  assert.match(plan.jobBoards[0].wttj.filters, /^contract_type:freelance AND \(.+\)$/);
  for (const facet of ["offices.country_code:PT", "offices.country_code:ES", "offices.country_code:FR", "offices.country_code:GB", "remote:fulltime"]) {
    assert.equal(plan.jobBoards[0].wttj.filters.split(/\(|\)| OR /).includes(facet), true, facet);
  }
  assert.equal((plan.jobBoards[0].wttj.filters.match(/offices\.country_code:PT/g) ?? []).length, 1);
});

test("freelance remote-only plans do not add country geography", () => {
  const plan = buildMarketPlan(["remote"], [], "freelance");
  assert.equal(plan.jobBoards[0].wttj.filters, "contract_type:freelance AND remote:fulltime");
  assert.deepEqual(plan.jobBoards[0].wttj.queries, []);
});

test("Portugal uses Landing.jobs and Spain scans both Manfred languages", () => {
  assert.deepEqual(buildMarketPlan(["portugal"], []).jobBoards, [
    { name: "Landing.jobs", provider: "landingjobs", enabled: true },
  ]);
  assert.deepEqual(buildMarketPlan(["spain"], []).jobBoards, [
    { name: "getManfred (ES)", provider: "manfred", lang: "ES", enabled: true },
    { name: "getManfred (EN)", provider: "manfred", lang: "EN", enabled: true },
  ]);
});

test("Europe selects its four entries and narrows WTTJ to the supported countries", () => {
  const boards = buildMarketPlan(["europe"], ["designer"]).jobBoards;
  assert.deepEqual(boards.map((b) => [b.provider, b.lang ?? ""]), [
    ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"], ["wttj", ""],
  ]);
  const filters = boards[3].wttj.filters;
  assert.deepEqual(filters.split(" OR "), [
    "offices.country_code:AT", "offices.country_code:BE", "offices.country_code:BG", "offices.country_code:HR",
    "offices.country_code:CY", "offices.country_code:CZ", "offices.country_code:DK", "offices.country_code:EE",
    "offices.country_code:FI", "offices.country_code:FR", "offices.country_code:DE", "offices.country_code:GR",
    "offices.country_code:HU", "offices.country_code:IE", "offices.country_code:IT", "offices.country_code:LV",
    "offices.country_code:LT", "offices.country_code:LU", "offices.country_code:MT", "offices.country_code:NL",
    "offices.country_code:PL", "offices.country_code:PT", "offices.country_code:RO", "offices.country_code:SK",
    "offices.country_code:SI", "offices.country_code:ES", "offices.country_code:SE", "offices.country_code:IS",
    "offices.country_code:LI", "offices.country_code:NO", "offices.country_code:GB", "offices.country_code:CH",
  ]);
  for (const country of ["FR", "NO", "IS", "LI", "GB", "CH"]) assert.ok(filters.split(" OR ").includes(`offices.country_code:${country}`));
  assert.equal(filters.includes("offices.country_code:US"), false);
  assert.ok(filters.length <= 1000, "provider rejects expressions longer than 1000 characters");
});

test("combined markets share boards without scanning the same board twice", () => {
  const plan = buildMarketPlan(["portugal", "spain", "europe"], [" Product Designer ", "product designer"]);
  assert.deepEqual(plan.jobBoards.map((b) => [b.provider, b.lang ?? ""]), [
    ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"], ["wttj", ""],
  ]);
  assert.deepEqual(plan.jobBoards[3].wttj.queries, ["Product Designer"]);
  assert.equal(plan.locationPolicy.strict, true);
});

test("WTTJ uses supplied profile terms and skips when no real terms exist", () => {
  const suppliedProfileTerms = ["creative director"];
  assert.deepEqual(buildMarketPlan(["europe"], suppliedProfileTerms).jobBoards.find((b) => b.provider === "wttj").wttj.queries, ["creative director"]);
  const plan = buildMarketPlan(["europe"], []);
  assert.equal(plan.jobBoards.some((b) => b.provider === "wttj"), false);
  assert.deepEqual(plan.skippedSources, [{ source: "wttj", reason: "missing-search-terms" }]);
});

test("remote selects the seven existing remote feeds", () => {
  assert.deepEqual(buildMarketPlan(["remote"], []).jobBoards.map((b) => b.provider), [
    "remoteok", "remotive", "himalayas", "jobicy", "jobspresso", "workingnomads", "weworkremotely",
  ]);
});

test("PT and ES location matching uses whole words and recognized local cities", () => {
  for (const [market, accepted, rejected] of [
    ["portugal", ["Lisbon, PT", "Portugal", "Lisboa", "Porto"], ["Egypt", "Egyptian", "Portugality", "Porto Alegre, Brazil", "Remote"]],
    ["spain", ["Madrid, ES", "España", "Espanha", "Spain", "Barcelona"], ["United States", "Estonia", "Spanishville", "Remote"]],
  ]) {
    const plan = buildMarketPlan([market], []);
    for (const location of accepted) assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
    for (const location of rejected) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, location);
  }
});

test("WTTJ is added once for every selected country and combines country filters", () => {
  const countries = ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"];
  const plan = buildMarketPlan(countries, ["designer"]);
  const wttj = plan.jobBoards.filter((board) => board.provider === "wttj");
  assert.equal(wttj.length, 1);
  assert.deepEqual(wttj[0].wttj.queries, ["designer"]);
  for (const code of ["PT", "ES", "GB", "CH", "LU", "NL"]) {
    assert.ok(wttj[0].wttj.filters.split(" OR ").includes(`offices.country_code:${code}`));
  }
  assert.deepEqual(plan.jobBoards.map((board) => board.provider), ["landingjobs", "manfred", "manfred", "wttj"]);
});

test("each added market accepts country names, codes and local cities but rejects collisions", () => {
  const cases = [
    ["united-kingdom", ["United Kingdom", "UK", "GB", "London", "Edinburgh", "Belfast, Northern Ireland"], ["London, Canada", "Manchester, United States", "London, Italy", "London, FR", "London, DE", "United Kingdom, Wisconsin"]],
    ["switzerland", ["Switzerland", "CH", "Zürich", "Geneva"], ["Geneva, Belgium", "Basel, Germany", "Zurich, Austria", "Switzerland, South Carolina"]],
    ["luxembourg", ["Luxembourg", "LU", "Luxembourg City", "Esch-sur-Alzette"], ["Luxembourg, Wisconsin", "Esch-sur-Alzette, Belgium", "LUXembourgish"]],
    ["netherlands", ["Netherlands", "NL", "Amsterdam", "Rotterdam", "The Hague"], ["Amsterdam, New York", "Rotterdam, Texas", "Netherlandish"]],
  ];
  for (const [market, accepted, rejected] of cases) {
    const plan = buildMarketPlan([market], []);
    for (const location of accepted) assert.equal(classifyMarketLocation({ location }, plan).accepted, true, `${market}: ${location}`);
    for (const location of rejected) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, `${market}: ${location}`);
  }
});

test("Europe accepts EU, EEA, UK and Switzerland, not unrestricted EMEA", () => {
  const plan = buildMarketPlan(["europe"], ["designer"]);
  for (const location of ["Berlin, DE", "France", "Malta", "Cyprus", "Norway", "Iceland", "Liechtenstein", "United Kingdom", "UK", "Switzerland", "CH", "EU", "EEA", "Europe", "Remote - Europe"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
  }
  for (const location of ["USA", "Russia", "Turkey", "Morocco", "EMEA", "Remote", "United States", "Europeanized", "Working at home in USA"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, false, location);
  }
});

test("remote feed provenance proves remote work but leaves country eligibility unknown", () => {
  const plan = buildMarketPlan(["remote"], []);
  for (const offer of [
    { location: "United States", source: "Remotive" },
    { location: "Worldwide", ats: "remoteok" },
    { location: "Remote - US only", source: "greenhouse" },
  ]) {
    assert.deepEqual(classifyMarketLocation(offer, plan), { accepted: true, remote: true, eligibility: "unknown" });
  }
  assert.equal(classifyMarketLocation({ location: "Office in London", source: "greenhouse" }, plan).accepted, false);
  assert.equal(classifyMarketLocation({ location: "Remoteville", source: "wttj" }, plan).accepted, false);
});

test("missing or sentinel location fails closed even for remote sources", () => {
  for (const location of [undefined, "", "  ", "n/a", "Unknown", "—", "Not specified"]) {
    assert.deepEqual(classifyMarketLocation({ location, source: "Remotive" }, buildMarketPlan(["remote"], [])), { accepted: false, reason: "missing-location" });
  }
});

test("combined markets accept a match to any selected geographic policy", () => {
  const plan = buildMarketPlan(["portugal", "spain"], []);
  assert.equal(classifyMarketLocation({ location: "Madrid, Spain" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Lisbon, Portugal" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Lisbon, Portugal; Madrid, Spain" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Paris, France" }, plan).accepted, false);
});

test("Portuguese cities keep trailing work-mode qualifiers", () => {
  const plan = buildMarketPlan(["portugal"], []);
  for (const location of ["Lisbon Remote", "Lisbon Hybrid"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
  }
});

test("market inference chooses Portugal only when every requested location is unambiguously Portuguese", () => {
  assert.equal(typeof marketPresets.inferMarketsFromLocations, "function");
  for (const locations of [["Portugal"], ["Lisboa"], ["Porto"], ["Lisbon Remote"], ["Lisboa", "Porto"]]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], locations), ["portugal"], locations.join(" | "));
  }
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisboa", "Madrid"]), []);
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisbon, Portugal; Madrid, Spain"]), []);
  assert.deepEqual(marketPresets.inferMarketsFromLocations(["spain"], ["Lisboa"]), ["spain"]);
});

test("market inference rejects Portuguese cities followed by foreign or unknown country qualifiers", () => {
  for (const location of ["Lisboa, ZA", "Lisboa, Angola", "Lisboa, XX"]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], [location]), [], location);
  }
  for (const location of ["Lisboa", "Lisbon Remote", "Lisboa Portugal", "Lisbon PT"]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], [location]), ["portugal"], location);
  }
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisboa", "Porto"]), ["portugal"]);
});

test("remote provider suffixes remain evidence of remote work in every origin field", () => {
  const plan = buildMarketPlan(["remote"], []);
  for (const field of ["source", "ats", "provider"]) {
    for (const origin of ["remotive-api", "remotive-full"]) {
      assert.deepEqual(classifyMarketLocation({ location: "Worldwide", [field]: origin }, plan),
        { accepted: true, remote: true, eligibility: "unknown" });
    }
  }
});

test("merged origins preserve remote evidence when the preferred URL belongs to ATS", () => {
  const ats = { url: "https://acme.com/42", company: "Acme", title: "Engineer", location: "Worldwide", postedAt: "", ats: "greenhouse", source: "greenhouse-full" };
  const [offer] = mergeDiscoveredOffers([ats], [{ ...ats, ats: "remotive-api", source: "remotive-api" }]);
  assert.equal(offer.source, "greenhouse-full");
  assert.deepEqual(offer.sources, ["greenhouse-full", "remotive-api"]);
  assert.deepEqual(classifyMarketLocation(offer, buildMarketPlan(["remote"], [])),
    { accepted: true, remote: true, eligibility: "unknown" });
});

test("non-remote origins with suffixes cannot admit a worldwide posting", () => {
  assert.deepEqual(classifyMarketLocation({ location: "Worldwide", source: "greenhouse-full", ats: "greenhouse-full", provider: "landingjobs-api", sources: ["wttj-api", "notremotive-api"] }, buildMarketPlan(["remote"], [])),
    { accepted: false, reason: "outside-market" });
});
