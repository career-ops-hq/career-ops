import { parseReport } from "@/lib/format";
import { readReport, type Application } from "@/lib/career-ops";

export type AnalyticsApplication = Application & {
  archetype: string;
  location: string;
  workMode: string;
  payMax: number;
  paySource: "POSTED" | "est" | "";
};

// Keep suffixes token-bound so a requisition such as `340741BR` cannot be
// misread as `340741B` (the same false-positive guard as the TUI parser).
const MONEY = /(?:[$€£¥₹₺₩]|USD|EUR|GBP|PLN|CHF|SGD|AUD|CAD)?\s*(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb])?(?![A-Za-z])(?:\s*[-–]\s*(?:[$€£¥₹₺₩]|USD|EUR|GBP|PLN|CHF|SGD|AUD|CAD)?\s*(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb])?(?![A-Za-z]))?/g;
const NON_USD_CURRENCY = /(?:€|£|¥|₹|₺|₩|\b(?:EUR|GBP|PLN|CHF|SGD|AUD|CAD)\b)/i;

function scalar(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
  if (!match) return "";
  return match[1].trim().replace(/^['"]|['"]$/g, "").replace(/^null$/i, "");
}

function moneyNumber(value: string, suffix = ""): number {
  const numeric = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  if (suffix.toLowerCase() === "k") return numeric * 1_000;
  if (suffix.toLowerCase() === "m") return numeric * 1_000_000;
  if (suffix.toLowerCase() === "b") return numeric * 1_000_000_000;
  return numeric;
}

function highestMoney(text: string): { value: number; source: "POSTED" | "est" | "" } {
  let highest = 0;
  let source: "POSTED" | "est" | "" = "";
  for (const match of text.matchAll(MONEY)) {
    const hasCurrency = Boolean(match[0].match(/\$|\bUSD\b/));
    if (!hasCurrency) continue;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 8);
    if (NON_USD_CURRENCY.test(before) || NON_USD_CURRENCY.test(after)) continue;
    const value = Math.max(moneyNumber(match[1], match[2]), moneyNumber(match[3] ?? "0", match[4] ?? ""));
    const trailingText = text.slice((match.index ?? 0) + match[0].length);
    if (/^\s*(?:valuation|(?:total\s+)?raised|series\s|round\b)/i.test(trailingText)) continue;
    // Bare M/B values in prose are usually company scale or valuation, not
    // compensation (for example, "1,079.2M devices"). Keep currency-backed
    // values, but do not let those metrics become a salary datapoint.
    if (!hasCurrency && /[MmBb]/.test(`${match[2] ?? ""}${match[4] ?? ""}`)) continue;
    if (!hasCurrency && value > 500_000) continue;
    if (value > highest) {
      highest = value;
      const context = text.slice(Math.max(0, (match.index ?? 0) - 24), Math.min(text.length, (match.index ?? 0) + match[0].length + 40)).toLowerCase();
      source = /posted/.test(context) ? "POSTED" : /\best\b|estimate|market/.test(context) ? "est" : "";
    }
  }
  return { value: highest, source };
}

function normalizeWorkMode(raw: string, text: string): string {
  const explicit = String(raw ?? "").toLowerCase().trim();
  if (explicit) {
    if (explicit.includes("hybrid")) return "Hybrid";
    if (explicit.includes("remote") && explicit.includes("flex")) return "RemoteFlex";
    if (explicit.includes("remote")) return "Remote";
    if (explicit.includes("onsite") || explicit.includes("on-site") || explicit.includes("in-office")) return "Full";
  }
  const value = text.toLowerCase();
  if (value.includes("hybrid")) return "Hybrid";
  if (value.includes("remote") && (value.includes("flex") || value.includes("remote-first") || value.includes("remote first"))) return "RemoteFlex";
  if (value.includes("remote")) return "Remote";
  if (value.includes("onsite") || value.includes("on-site") || value.includes("in-office")) return "Full";
  return "";
}

function fallbackLocation(text: string): string {
  // Require the comma for US city/state pairs. Free-form notes often contain
  // uppercase prose such as "BEST TECHNICAL FIT IN THE PIPELINE"; accepting
  // a bare `City ST` shape turns "Best Technical Fit IN" into Indiana.
  const cityState = text.match(/\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2}),\s*(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/);
  if (cityState?.[1] && !(cityState[1].length <= 3 && cityState[1] === cityState[1].toUpperCase())) return cityState[1];
  const cities = text.match(/\b(Porto|Lisbon|London|Berlin|Munich|München|Hamburg|Frankfurt|Cologne|Düsseldorf|Dusseldorf|Stuttgart|Zurich|Zürich|Geneva|Lausanne|Basel|Dublin|Cork|Amsterdam|Rotterdam|Eindhoven|Utrecht|Paris|Lyon|Madrid|Barcelona|Valencia|Stockholm|Gothenburg|Malmö|Malmo|Copenhagen|Oslo|Helsinki|Milan|Rome|Turin|Vienna|Brussels|Ghent|Antwerp|Luxembourg|Warsaw|Kraków|Krakow|Wrocław|Wroclaw|Tallinn|Riga|Vilnius|Prague|Brno|Budapest|Bucharest|Sofia|Athens|Bengaluru|Bangalore|Singapore|Sydney|Toronto|Vancouver|Tel Aviv|São Paulo|Sao Paulo|Kuala Lumpur|Petaling Jaya|Cyberjaya)\b/i);
  return cities?.[1] ?? "";
}

function reportArchetype(content: string, fallbackArchetype: string): string {
  const meta = parseReport(content);
  const machine = content.match(/##\s+Machine Summary[\s\S]*?```(?:yaml)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const archetypeTable = content.match(/\*\*(?:Archetype detected|Archetype)\*\*\s*\|\s*([^|\n]+)/i)?.[1]?.replace(/\*+/g, "").trim() ?? "";
  return scalar(machine, "archetype_primary") || scalar(machine, "archetype") || archetypeTable || meta.fields.find((field) => field.label === "Archetype")?.value || fallbackArchetype;
}

/** Pure counterpart to the Go dashboard's report + tracker-note enrichment. */
export function enrichAnalyticsApplication(app: Application, reportContent = ""): AnalyticsApplication {
  const notes = app.notes ?? "";
  const notePay = highestMoney(notes);
  const combinedText = `${app.role} ${notes}`;
  const noteLocation = fallbackLocation(notes);
  return {
    ...app,
    archetype: reportArchetype(reportContent, ""),
    location: noteLocation,
    workMode: normalizeWorkMode("", combinedText),
    payMax: notePay.value,
    paySource: notePay.source,
  };
}

function fromApplication(app: Application): AnalyticsApplication {
  return enrichAnalyticsApplication(app, readReport(app.n)?.content ?? "");
}

/** Read-only enrichment of tracker rows for Analytics. */
export function analyticsApplications(applications: Application[]): AnalyticsApplication[] {
  return applications.map(fromApplication);
}
