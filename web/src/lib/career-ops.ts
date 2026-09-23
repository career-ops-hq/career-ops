import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "@/lib/core/safe-write";
import { parseApplications } from "@/lib/tracker-table.mjs";
import { resolveTailoredCv } from "@/lib/apply/cv";
import { normalizeTextKey } from "@/lib/core/normalize-text-key.mjs";

/**
 * Resolve the career-ops "home" — the directory holding the user's sibling
 * files (cv.md, data/, reports/). In production the web/ app lives inside the
 * career-ops checkout, so the home is its parent (..). Dev overrides via
 * CAREER_OPS_ROOT to read the user's real (gitignored) data from a separate
 * checkout — see web/.env.local.
 */
export function careerOpsRoot(): string {
  const env = process.env.CAREER_OPS_ROOT?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "..");
}

/**
 * Absolute path to a core root script (e.g. doctor, verify-portals). The `.mjs`
 * is assembled here from the bare name so the literal never appears as a direct
 * `execFile`/`spawn` argument — Next's bundler statically traces such literals
 * as module imports and fails the production build otherwise.
 */
export function rootScript(nameNoExt: string): string {
  return path.join(careerOpsRoot(), `${nameNoExt}.mjs`);
}

/**
 * Live core normalizeTextKey for server routes. Returns the declared web mirror
 * (@/lib/core/normalize-text-key.mjs) — the same function tracker-parse.mjs
 * exports, vendored because Turbopack pins its module graph to web/ and cannot
 * resolve a runtime import() of a file outside it (a computed path 500s with
 * "Cannot find module as expression is too dynamic"). Parity with the core is
 * enforced by test-all.mjs §55.7 against tests/fixtures/company-key-corpus.json
 * (#2666) — the mirror IS the core's key, never a second opinion.
 */
export async function getNormalizeTextKey(): Promise<(value: unknown, separator?: string) => string> {
  // The mirror runs String(value ?? '') first, so it safely takes undefined/
  // unknown cells — callers (whats-new) feed possibly-empty strings. The cast
  // keeps the declared contract the wider truth instead of the module's inferred
  // (value: string) signature.
  return normalizeTextKey as (value: unknown, separator?: string) => string;
}

// Feature-detect the core's `tracker.mjs delete --num` row-delete (#1200) by probing
// the local script source — older checkouts lack it, so the delete UI hides itself.
export function trackerCanDelete(): boolean {
  try {
    const src = fs.readFileSync(rootScript("tracker"), "utf8");
    return src.includes("delete") && src.includes("--num");
  } catch {
    return false;
  }
}

function read(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8");
  } catch {
    return null;
  }
}

export type InboxJob = { url: string; company: string; role: string; location?: string; compensation?: string; done: boolean; postedAt?: string; source?: string };

/** Some ingest sources (career-ops-plugin-linkedin-alerts) can't always parse a
 *  company out of an alert email subject and fall back to the literal "(LinkedIn)"
 *  placeholder, folding the real company into the role instead — e.g. company:
 *  "(LinkedIn)", role: "Product Manager at Nykaa". Presentation-only fix (the
 *  underlying pipeline.md row is untouched): split it back into real company/role
 *  wherever the placeholder shows up, so the Inbox tab doesn't show a dead company. */
function splitLinkedinAlertPlaceholder(company: string, role: string): { company: string; role: string } {
  if (company !== "(LinkedIn)") return { company, role };
  const m = role.match(/^(.+?)\s+at\s+(.+)$/i);
  return m ? { role: m[1].trim(), company: m[2].trim() } : { company, role };
}

/** A pipeline-row segment like `posted: 2026-07-14`, `trust: 62 stale` or
 *  `note: …` — the core appends these LABELED segments after whatever
 *  positional shape a row has (3/4/5 columns), so a naive positional reader
 *  would misread them as location/compensation on short rows. Any
 *  `word:`-prefixed segment is treated as labeled (forward-compatible with
 *  labels the core hasn't invented yet). */
const LABELED_SEGMENT = /^([a-z][a-z_-]*):\s*(.*)$/i;

/** Parse data/pipeline.md — `- [ ] URL | Company | Role [| Location [| Compensation]] [| label: …]*`.
 *  Positional split for the first columns (the optional 4th `location` #1015
 *  and 5th `compensation` #1017 must NOT bleed into `role`); labeled segments
 *  (posted:/trust:/note:/…) are filtered out of positional assignment wherever
 *  they appear and surfaced when useful (posted: → postedAt). Unknown labels
 *  and further trailing columns are ignored gracefully. */
export function readInbox(): InboxJob[] {
  const md = read("data/pipeline.md");
  if (!md) return [];
  const jobs: InboxJob[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const all = m[2].split("|").map((s) => s.trim());
    const labels = new Map<string, string>();
    const parts: string[] = [];
    for (const [i, seg] of all.entries()) {
      // the URL cell can contain a colon-y value but is always position 0
      const lm = i >= 3 ? seg.match(LABELED_SEGMENT) : null;
      if (lm) labels.set(lm[1].toLowerCase(), lm[2].trim());
      else parts.push(seg);
    }
    if (parts.length < 3 || !parts[0]) continue; // need at least url | company | role
    const posted = labels.get("posted");
    const { company, role } = splitLinkedinAlertPlaceholder(parts[1], parts[2]);
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: parts[0],
      company,
      role,
      location: parts[3] || undefined, // optional 4th column (#1015)
      compensation: parts[4] || undefined, // optional 5th column (#1017); 6th+ ignored
      // the row's own posting date (scan.mjs `posted:` label) — a more direct
      // freshness signal than the scan-history join, which stays as fallback
      postedAt: posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : undefined,
    });
  }
  return jobs;
}

/**
 * Read data/scan-history.tsv → Map<url, first_seen(YYYY-MM-DD)>. The scanner
 * already stamps every discovered posting with the date it was first seen
 * (col 2), so we derive the inbox's freshness signal here WITHOUT touching the
 * core (see the inbox-triage build: freshness = option A, no scanner change).
 * Tolerant by construction: no file → empty map (freshness facet just hides);
 * a malformed row is skipped, never thrown (missing ≠ corrupt).
 */
export function readScanDates(): Map<string, string> {
  const tsv = read("data/scan-history.tsv");
  const dates = new Map<string, string>();
  if (!tsv) return dates;
  const lines = tsv.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || (i === 0 && line.startsWith("url\t"))) continue; // skip header
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const url = line.slice(0, tab);
    const firstSeen = line.slice(tab + 1).split("\t")[0]?.trim();
    // keep the EARLIEST first_seen if a url recurs (it's "first" seen, after all)
    if (/^\d{4}-\d{2}-\d{2}$/.test(firstSeen) && !dates.has(url)) dates.set(url, firstSeen);
  }
  return dates;
}

/**
 * Read data/scan-history.tsv → Map<url, portal> (col 3 — e.g. "greenhouse-api",
 * "apify-api", or a plugin id like "linkedin-alerts"). Same tolerant shape as
 * readScanDates(): lets the Inbox tab show/filter on a REAL recorded source
 * instead of guessing from the URL's hostname (sourceFromUrl only recognizes 4
 * ATS domains, so anything else — LinkedIn included — showed no badge at all).
 */
export function readScanSources(): Map<string, string> {
  const tsv = read("data/scan-history.tsv");
  const sources = new Map<string, string>();
  if (!tsv) return sources;
  const lines = tsv.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || (i === 0 && line.startsWith("url\t"))) continue; // skip header
    const cols = line.split("\t");
    const url = cols[0]?.trim();
    const portal = cols[2]?.trim();
    if (url && portal && !sources.has(url)) sources.set(url, portal);
  }
  return sources;
}

export type Application = {
  n: string;
  date: string;
  company: string;
  /** Intermediary channel (#1596): agency/recruiter firm, "—" for direct, "" when the tracker has no Via column. */
  via: string;
  role: string;
  score: string;
  status: string;
  pdf: string;
  report: string;
  notes: string;
  /** Durable viewable-CV signal (tracker ✅ OR resolvable output/cv-*.pdf). Set by pipelineSummary(). */
  cvReady?: boolean;
};

/**
 * Parse data/applications.md — the tracker table (source of truth).
 * The header-aware parsing lives in tracker-table.mjs, which resolves headers
 * through the SAME alias table the Node tooling uses (tracker-aliases.json,
 * exported by tracker-parse.mjs as HEADER_ALIASES) — one shared source, no
 * web-side mirror to drift (#954, PR #1598 review).
 */
export function readApplications(): Application[] {
  const md = read("data/applications.md");
  if (!md) return [];
  return parseApplications(md, careerOpsRoot());
}

/**
 * Server-side lifecycle of the user's setup — mirrors the prerequisite list that
 * doctor.mjs uses (cv.md, config/profile.yml, modes/_profile.md, portals.yml), by
 * plain file-stat (no subprocess). Drives the home branch: first-run (no CV) →
 * the CV takeover; in-between (CV but no profile) → gentle nudges; established.
 */
export type LifecyclePhase = "first-run" | "in-between" | "established";
/**
 * Server-side lifecycle, mirroring the core doctor.mjs prerequisite list with the
 * SAME existsSync semantics (the SSOT the OnboardingBanner already reads via
 * /api/doctor). The 4 user-layer prereqs: cv.md, config/profile.yml,
 * modes/_profile.md, portals.yml.
 *   - first-run  → a TRULY empty install (no cv AND no data): the CV takeover.
 *     CRITICAL back-compat (maintainer): NEVER force onboarding on a user who
 *     already has data (a full pipeline/tracker with no cv.md is valid).
 *   - in-between → has cv/data but setup incomplete: dashboard + the nudge banner.
 *   - established → all 4 prereqs present.
 * onboardingNeeded mirrors doctor.mjs: true if ANY prereq is missing → show banner.
 */
export function doctorState(): {
  phase: LifecyclePhase;
  onboardingNeeded: boolean;
  missing: string[];
  hasCv: boolean;
  hasData: boolean;
} {
  const has = (rel: string) => {
    try {
      return fs.existsSync(path.join(careerOpsRoot(), rel));
    } catch {
      return false;
    }
  };
  const prereqs: [string, string][] = [
    ["cv.md", "cv.md"],
    ["config/profile.yml", "config/profile.yml"],
    ["modes/_profile.md", "modes/_profile.md"],
    ["portals.yml", "portals.yml"],
  ];
  const missing = prereqs.filter(([rel]) => !has(rel)).map(([, label]) => label);
  const hasCv = has("cv.md");
  const hasData = readApplications().length > 0 || readInbox().some((j) => !j.done);
  const onboardingNeeded = missing.length > 0;
  const phase: LifecyclePhase = !hasCv && !hasData ? "first-run" : onboardingNeeded ? "in-between" : "established";
  return { phase, onboardingNeeded, missing, hasCv, hasData };
}

export type PipelineSummary = {
  root: string;
  rootExists: boolean;
  inbox: InboxJob[];
  applications: Application[];
};

export function pipelineSummary(): PipelineSummary {
  const root = careerOpsRoot();
  const scanDates = readScanDates();
  const scanSources = readScanSources();
  return {
    root,
    rootExists: fs.existsSync(root),
    // join the freshness date (first_seen) and the real recorded source (portal)
    // onto each raw posting — the inbox's triage view orders/facets on both
    // entirely client-side.
    inbox: readInbox().map((j) => ({ ...j, postedAt: j.postedAt ?? scanDates.get(j.url), source: scanSources.get(j.url) })),
    // cvReady is durable file truth (tracker ✅ OR a resolvable output/cv-*.pdf),
    // so a wiped PDF flag or a cleared localStorage job cannot flip View → Generate.
    applications: readApplications().map((a) => ({ ...a, cvReady: applicationCvReady(a) })),
  };
}

export type ReportData = { content: string; file: string };

/** Locate the evaluation report for an application number
 *  (reports/{n}-{slug}-{date}.md; the leading number may be zero-padded). */
function reportNumFromFilename(filename: string): number {
  const m = filename.match(/^(\d+)-/);
  return m ? parseInt(m[1], 10) : NaN;
}

export function findReportFile(n: string): string | null {
  const target = parseInt(n, 10);
  if (Number.isNaN(target)) return null;
  let files: string[];
  try {
    files = fs.readdirSync(path.join(careerOpsRoot(), "reports"));
  } catch {
    return null;
  }
  const candidates = files
    .filter((f) => f.endsWith(".md") && !/-RESERVED\.md$/i.test(f))
    .filter((f) => reportNumFromFilename(f) === target);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.localeCompare(a));
  return path.join(careerOpsRoot(), "reports", candidates[0]);
}

export function readReport(n: string): ReportData | null {
  const file = findReportFile(n);
  if (!file) return null;
  try {
    return { content: fs.readFileSync(file, "utf8"), file: path.basename(file) };
  } catch {
    return null;
  }
}

export function findApplication(n: string): Application | null {
  return readApplications().find((a) => a.n === n) ?? null;
}

/**
 * Primary report number linked by a tracker row's Report cell (NNN in
 * reports/NNN-*.md). Falls back to the row # — web job inputs are tracker row
 * ids, which equal the report number until a re-eval renumbers the report link
 * (row 135 ↔ report 144).
 */
export function primaryReportNum(app: Application | null | undefined, fallback: string): string {
  const cell = app?.report?.trim() ?? "";
  if (!cell) return fallback;
  const pathMatch = cell.match(/reports\/0*(\d+)-/i);
  if (pathMatch) return pathMatch[1];
  const labelMatch = cell.match(/\[(\d+)\]/);
  if (labelMatch) return labelMatch[1];
  const bare = cell.match(/^0*(\d+)$/);
  if (bare) return bare[1];
  return fallback;
}

/**
 * Durable "a viewable tailored CV exists for this row" — the invariant the CV
 * column's Generate/View gate must use. Tracker ✅ is only a cached claim (an
 * LLM hand-edit or a re-eval merge can wipe it); an ephemeral localStorage
 * "done" job vanishes on clear/cap/reload. Ground truth is the same resolution
 * /api/cv-pdf uses: pdf-index by report/row key, else newest output/cv-*.pdf
 * for the company. Never true when serve would 404.
 */
export function applicationCvReady(app: Pick<Application, "n" | "company" | "pdf"> | null | undefined): boolean {
  if (!app) return false;
  if ((app.pdf ?? "").includes("✅")) return true;
  const company = (app.company ?? "").trim();
  if (!company) return false;
  return resolveTailoredCv(company, app.n) !== null;
}

/** The CANONICAL user-customization file the CLI/TUI reads. Durable facts the
 *  web assistant learns go HERE (single source of truth) inside a managed marker
 *  block — so the CLI sees them too. No web-only memory store (that would drift). */
export function profilePath(): string {
  return path.join(careerOpsRoot(), "modes", "_profile.md");
}

const NOTES_START = "<!-- co-web-notes:start -->";
const NOTES_END = "<!-- co-web-notes:end -->";

/** Read back ONLY the web-assistant managed notes from modes/_profile.md (small,
 *  focused — the agent reads the rest of the canonical files itself). Falls back
 *  to the legacy web-only memory file for back-compat. */
export function readMemory(): string {
  try {
    const md = fs.readFileSync(profilePath(), "utf8");
    const i = md.indexOf(NOTES_START);
    const j = md.indexOf(NOTES_END);
    if (i !== -1 && j !== -1 && j > i) return md.slice(i + NOTES_START.length, j).trim();
  } catch {
    /* no _profile.md yet */
  }
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), ".career-ops-web", "memory.md"), "utf8").trim();
  } catch {
    return "";
  }
}

/** Append a durable fact to the canonical modes/_profile.md (creating the file +
 *  managed block if needed), PRESERVING existing user content. */
export function rememberFact(fact: string): "ok" | "deduped" | "error" {
  const f = fact.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!f) return "deduped";
  const p = profilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let md = "";
    try {
      md = fs.readFileSync(p, "utf8");
    } catch {
      md = "";
    }
    const i = md.indexOf(NOTES_START);
    const j = md.indexOf(NOTES_END);
    if (i !== -1 && j !== -1 && j > i) {
      if (md.slice(i, j).includes(f)) return "deduped";
      atomicWrite(p, md.slice(0, j) + `- ${f}\n` + md.slice(j));
      return "ok";
    }
    if (md.includes(f)) return "deduped";
    const section = `\n\n## Notes from the web assistant\n${NOTES_START}\n- ${f}\n${NOTES_END}\n`;
    const base = md.trim() ? md.replace(/\n*$/, "\n") : "# Profile customization\n";
    atomicWrite(p, base + section);
    return "ok";
  } catch {
    return "error";
  }
}
