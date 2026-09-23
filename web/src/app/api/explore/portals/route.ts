import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { assembleDedupContext } from "@/lib/core/discover";
import { streamAgentCli } from "@/lib/core/agent-cli-stream";
import { loadYaml } from "@/lib/core/portals";
import type { ExploreFilters } from "@/lib/explore";

// "Portals" search orchestrates modes/scan.md's Level 3 (WebSearch Queries) via the
// user's own configured search_queries + scan_method:websearch tracked_companies —
// the sources with no public ATS API (job boards, LinkedIn, recruitment agencies,
// life-sciences employers, etc.). This is DISTINCT from:
//   - the free Scan tab (scan-ats-full.mjs, zero-token, ignores portals.yml's own
//     company/query lists — a keyword-first sweep over ATS-wide directories)
//   - AI search (modes/hunt.md, a freeform open-web hunt, also not tied to
//     portals.yml's search_queries)
// Same headless-CLI mechanism as AI search (see agent-cli-stream.ts): the agent is
// a PROPOSER, Write/Edit/Bash disabled, results are UNVERIFIED until evaluated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type SearchQueryEntry = { name?: unknown; query?: unknown; enabled?: unknown };
type CompanyEntry = { name?: unknown; scan_method?: unknown; scan_query?: unknown; search_query?: unknown; careers_url?: unknown; enabled?: unknown };
type JobBoardEntry = { name?: unknown; provider?: unknown; enabled?: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The two Level-3 source lists from the user's REAL portals.yml — never the
 *  ephemeral filter file the free Scan uses (that one only carries title/location
 *  filters, by design; Level 3 needs the actual queries and company list). */
function level3Sources(): { queries: { name: string; query: string }[]; companies: { name: string; query: string }[] } {
  const portals = loadYaml("portals.yml") ?? {};
  const rawQueries = Array.isArray(portals.search_queries) ? (portals.search_queries as SearchQueryEntry[]) : [];
  const queries = rawQueries
    .filter((e) => e && e.enabled !== false && str(e.query))
    .map((e) => ({ name: str(e.name) || "(unnamed query)", query: str(e.query) }));

  const rawCompanies = Array.isArray(portals.tracked_companies) ? (portals.tracked_companies as CompanyEntry[]) : [];
  const companies = rawCompanies
    .filter((e) => e && e.enabled !== false && str(e.scan_method) === "websearch")
    .map((e) => ({ name: str(e.name) || "(unnamed company)", query: str(e.scan_query) || str(e.search_query) || str(e.careers_url) }));

  return { queries, companies };
}

/** Direct-scan job boards from portals.yml job_boards (board-browser, RSS, APIs).
 *  These run via `npm run scan` / the Pipeline "Portal scan" button — NOT the
 *  token-spending Portals WebSearch hunt on this tab. */
function directScanBoards(): { name: string; provider: string }[] {
  const portals = loadYaml("portals.yml") ?? {};
  const raw = Array.isArray(portals.job_boards) ? (portals.job_boards as JobBoardEntry[]) : [];
  return raw
    .filter((e) => e && e.enabled !== false && str(e.name))
    .map((e) => ({ name: str(e.name), provider: str(e.provider) || "auto" }));
}

/** Title/location filter context handed to the agent alongside the Level 3
 *  targets. Prefers the UI's live filter state (the same FilterBuilder Scan
 *  uses, now also editable on the Portals tab) over the real portals.yml
 *  defaults — so a one-off narrowing in the UI doesn't require an edit to the
 *  file. Falls back to portals.yml's own title_filter/location_filter when the
 *  client sends nothing (e.g. an older UI build, or the user never touched it). */
function filterBlock(override?: Partial<ExploreFilters>): string {
  const asList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  let positive = asList(override?.positive);
  let negative = asList(override?.negative);
  let allow = asList(override?.allow);
  let block = asList(override?.block);
  let alwaysAllow = asList(override?.alwaysAllow);

  if (!positive.length && !negative.length && !allow.length && !block.length && !alwaysAllow.length) {
    const portals = loadYaml("portals.yml") ?? {};
    const tf = (portals.title_filter ?? {}) as Record<string, unknown>;
    const lf = (portals.location_filter ?? {}) as Record<string, unknown>;
    positive = asList(tf.positive);
    negative = asList(tf.negative);
    allow = asList(lf.allow);
    block = asList(lf.block);
    alwaysAllow = asList(lf.always_allow);
  }

  const lines: string[] = [];
  if (positive.length) lines.push(`title_filter.positive: ${positive.join(", ")}`);
  if (negative.length) lines.push(`title_filter.negative: ${negative.join(", ")}`);
  if (alwaysAllow.length) lines.push(`location_filter.always_allow: ${alwaysAllow.join(", ")}`);
  if (allow.length) lines.push(`location_filter.allow: ${allow.join(", ")}`);
  if (block.length) lines.push(`location_filter.block: ${block.join(", ")}`);
  return lines.join("\n");
}

// GET — a cheap preview (no CLI spawn) so the UI can show what will actually run
// before the user spends a token on it.
export async function GET() {
  const { queries, companies } = level3Sources();
  const boards = directScanBoards();
  const names = [...queries.map((q) => q.name), ...companies.map((c) => c.name)];
  return Response.json({
    queries: queries.length,
    companies: companies.length,
    jobBoards: boards.length,
    jobBoardSample: boards.map((b) => b.name).slice(0, 8),
    sample: names.slice(0, 6),
  });
}

const OUTPUT_CONTRACT = `

--- OUTPUT CONTRACT (the career-ops WEB is parsing your stream) ---
You are running ONLY "Level 3 — WebSearch Queries" from the Workflow above, headless, for the web:
- SKIP Levels 0, 1, and 2 entirely (local parsers, Playwright, direct ATS APIs) — the free Scan tab
  already covers those. Your job here is WebSearch only, against the EXACT targets listed below.
- Do not invent new queries or companies — run only what's listed under "YOUR LEVEL 3 TARGETS".
- Extract {title, url, company} per "Extraction of Title and Company from WebSearch Results" above.
- Apply title_filter / location_filter (given below) exactly as Workflow steps 6/6b describe.
- DEDUP: skip anything in "ALREADY KNOWN" below.
- You are a PROPOSER — never write a file (Write/Edit/Bash are disabled). Never touch pipeline.md,
  scan-history.tsv, or portals.yml yourself — the user reviews and adds candidates manually.
- Every result is UNVERIFIED: you have no Playwright here to confirm liveness (Level-3 hits can be
  weeks stale per the caution above) — that check happens later when the user evaluates it.
- Emit each candidate as ONE line, never inside a code fence:
  <<offer:{"url":"…","title":"…","company":"…","location":"…","source":"portals-search","why":"…","postedHint":"…","ats":"…","verification":"unconfirmed"}>>
  Valid JSON, one per line, the moment you're confident — stream them as you go.
- Between envelopes, narrate briefly (plain text) which query/company you're running — shown live.
- Be a GENEROUS FINDER, not a judge: include uncertain matches and flag the uncertainty in "why".
  NEVER score or judge fit; the A–F evaluation does that later, with the full JD.
`;

const ALLOWED_TOOLS = ["Read", "WebFetch", "WebSearch", "Glob", "Grep"];
const DISALLOWED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit", "Task"];

export async function POST(req: Request) {
  let body: { cliId?: string; filters?: Partial<ExploreFilters> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const cliId = body.cliId;
  if (!cliId) return Response.json({ error: "cliId required" }, { status: 400 });

  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' not found on this machine` }, { status: 404 });
  const { spec, binPath } = resolved;

  // Read the CANONICAL mode at request time — same "single source of truth" rule
  // AI search follows for hunt.md. Missing (older core) → graceful 400.
  let mode: string;
  try {
    mode = fs.readFileSync(path.join(careerOpsRoot(), "modes", "scan.md"), "utf8");
  } catch {
    return Response.json({ code: "MODE_MISSING", error: "Portals search needs a newer career-ops — update to enable it." }, { status: 400 });
  }

  const { queries, companies } = level3Sources();
  if (queries.length === 0 && companies.length === 0) {
    return Response.json(
      { error: "No Level 3 sources configured — add search_queries or a scan_method: websearch company to portals.yml." },
      { status: 400 },
    );
  }
  const targetLines = [
    ...queries.map((q, i) => `${i + 1}. [query] ${q.name}: ${q.query}`),
    ...companies.map((c, i) => `${queries.length + i + 1}. [company] ${c.name}: ${c.query}`),
  ];
  const filters = filterBlock(body.filters);
  const targetsBlock = `\n\n--- YOUR LEVEL 3 TARGETS ---\n${filters ? `${filters}\n\n` : ""}${targetLines.join("\n")}\n`;

  const { lines } = assembleDedupContext();
  const memory = readMemory();
  const memoryLine = memory.trim() ? `\n\nWHAT YOU KNOW ABOUT THE USER (persistent memory):\n${memory.trim()}` : "";
  const knownBlock = lines.length ? `\n\n--- ALREADY KNOWN (dedup — do NOT propose these) ---\n${lines.join("\n")}` : "";
  const prompt = `${mode}${OUTPUT_CONTRACT}${targetsBlock}${memoryLine}${knownBlock}\n`;

  const stream = streamAgentCli({ cliId, binPath, spec, prompt, allowedTools: ALLOWED_TOOLS, disallowedTools: DISALLOWED_TOOLS });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
