import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { atomicWrite } from "@/lib/core/safe-write";
import { parseApplications } from "@/lib/tracker-table.mjs";
// One definition of the `{n}-RESERVED.md` convention, shared with
// run-cli-support.mjs — see report-files.mjs for why it lives there.
import { isReservedReportFile } from "@/lib/report-files.mjs";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
// Pure parser, no I/O — shared with the apply flow's CV resolver so the two
// don't drift into two different definitions of "which report does this
// index row belong to" (#2599, #2008 review).
import { pdfIndexEntryForReport } from "@/lib/apply/cv-selection.mjs";

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
  // The core checkout is selected at runtime and must not be bundled into the
  // web server output when Turbopack sees this dynamic script path.
  return path.join(/* turbopackIgnore: true */ careerOpsRoot(), `${nameNoExt}.mjs`);
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

export type InboxJob = { url: string; company: string; role: string; location?: string; compensation?: string; done: boolean; postedAt?: string };

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
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: parts[0],
      company: parts[1],
      role: parts[2],
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

/** Resolve the report-number cell in data/pdf-index.tsv for a given report id.
 *  Digits-only, full-string match — parseInt alone would let "12abc" resolve to
 *  report 12, matching the wrong index row. Returns null for anything malformed,
 *  so callers never have to re-validate. */
function pdfIndexTarget(n: string): number | null {
  const trimmed = n.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

export async function pdfReadyForReport(n: string): Promise<boolean> {
  return (await pdfPathForReport(n)) !== null;
}

export type PdfPathForReportResult =
  | { status: "found"; path: string }
  | { status: "not-found" }
  | { status: "invalid" }
  | { status: "rejected" };

/** The exact PDF path indexed for this report number, or null if none exists
 *  (malformed id, no index row, the indexed file is missing on disk, or the
 *  index resolved outside the workspace). Lets the viewer route serve the
 *  SPECIFIC report's PDF instead of guessing the newest file for the company —
 *  two applications at the same company have two different tailored CVs.
 *
 *  The manifest path comes from the core's resolvePdfIndexPath (ACL, honors
 *  CAREER_OPS_PDF_INDEX) rather than a hardcoded "data/pdf-index.tsv" literal
 *  — the exact class of bug that #2471 fixed in the core, once, for every
 *  reader. The parsing itself is pdfIndexEntryForReport, a pure function
 *  shared with the apply flow's own CV resolver (cv-selection.mjs) so there
 *  is one definition of "which row matches this report", not two. */
export async function pdfPathStatusForReport(n: string): Promise<PdfPathForReportResult> {
  const target = pdfIndexTarget(n);
  if (target === null) return { status: "invalid" };
  const indexPath = await resolvePdfIndexPath();
  if (!indexPath) return { status: "not-found" };
  let tsv: string;
  try {
    tsv = fs.readFileSync(indexPath, "utf8");
  } catch {
    return { status: "not-found" };
  }
  const root = careerOpsRoot();
  const entry = pdfIndexEntryForReport(tsv, target);
  if (!entry.found) return { status: "not-found" };
  if (!entry.path) return { status: "rejected" };
  // The manifest is a user-layer file (generate-pdf.mjs writes it, but nothing
  // stops a hand edit) turned into a filesystem read that this route then
  // serves — the path must be contained BY CONSTRUCTION, not by trusting the
  // writer. Rows are written relative to the WORKSPACE root (careerOpsRoot()),
  // not to the manifest's own data/ directory — same base the pre-ACL version
  // of this function used — and must stay under the project's output/ tree.
  const abs = path.resolve(root, entry.path);
  const outputDir = path.resolve(root, "output");
  if (!abs.startsWith(outputDir + path.sep)) return { status: "rejected" };
  // Scoped to outputDir, not the broader root: the lexical startsWith check
  // above only rejects an unresolved path outside output/, but a symlink
  // PLACED under output/ can still resolve to somewhere else inside root
  // (e.g. reports/) and pass a root-scoped realpath check — serving a file
  // this route was never meant to expose.
  if (!isRegularContainedFile(abs, outputDir)) return { status: "rejected" };
  return { status: "found", path: abs };
}

export async function pdfPathForReport(n: string): Promise<string | null> {
  const result = await pdfPathStatusForReport(n);
  return result.status === "found" ? result.path : null;
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
  return {
    root,
    rootExists: fs.existsSync(root),
    // join the freshness date (first_seen) onto each raw posting — the inbox's
    // triage view orders/faceted-filters on it entirely client-side.
    inbox: readInbox().map((j) => ({ ...j, postedAt: j.postedAt ?? scanDates.get(j.url) })),
    applications: readApplications(),
  };
}

export type ReportData = { content: string; file: string };

/** Locate the evaluation report for an application number.
 *  The tracker row's own report link is authoritative: report FILE numbers can
 *  differ from application numbers (e.g. app #309 → reports/308-…), so
 *  resolving only by leading filename number misses those. Links are
 *  normalized relative to the tracker file's directory (see #760). Falls back
 *  to the filename scan (reports/{n}-{slug}-{date}.md, possibly zero-padded)
 *  for rows without a parseable link.
 *
 *  Both the linked lookup and the fallback scan skip `{n}-RESERVED.md`
 *  placeholder files.
 *  `reserve-report-num.mjs` writes an empty `NNN-RESERVED.md` sentinel to
 *  claim a report number before a worker has actually written the report;
 *  it's normally deleted once the real report lands (or GC'd after 4h if
 *  abandoned). But "RESERVED" sorts alphabetically before nearly every real
 *  slug (company names start with lowercase/uppercase letters after the
 *  number-dash, "R" often lands mid-alphabet or earlier), so if a sentinel
 *  outlives its report — e.g. a worker was driven directly instead of
 *  through the orchestrator that owns cleanup — `.find()` could return the
 *  empty sentinel instead of the real report, making the report body and the
 *  Apply/PDF-ready checks disappear. */
export function findReportFile(n: string): string | null {
  const target = parseInt(n, 10);
  if (Number.isNaN(target)) return null;
  const root = careerOpsRoot();
  const app = readApplications().find((a) => parseInt(a.n, 10) === target);
  const linked = app?.report.match(/\]\(([^)]+)\)/)?.[1];
  if (linked) {
    const p = path.resolve(root, "data", linked);
    // Containment: a hand-edited link must not resolve outside the project.
    if (p.endsWith(".md") && !isReservedReportFile(p) && containedRealpath(p, root)) return p;
  }
  let files: string[];
  try {
    files = fs.readdirSync(path.join(root, "reports"));
  } catch {
    return null;
  }
  const match = files.find(
    (f) => f.endsWith(".md") && !isReservedReportFile(f) && parseInt(f, 10) === target,
  );
  if (!match) return null;
  const p = path.join(root, "reports", match);
  return containedRealpath(p, root) ? p : null;
}

/** True containment check: resolves symlinks before comparing, so a link
 *  planted under data/ or reports/ can't leak files outside the project. */
function containedRealpath(p: string, root: string): boolean {
  try {
    return fs.realpathSync(p).startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false; // missing file or unresolvable link — treat as not found
  }
}

export function isRegularContainedFile(p: string, root: string): boolean {
  try {
    return fs.statSync(p).isFile() && containedRealpath(p, root);
  } catch {
    return false;
  }
}

export function readReport(n: string): ReportData | null {
  const file = findReportFile(n);
  if (!file) return null;
  try {
    // Reports live in the user's runtime checkout, outside the web build graph.
    return {
      content: fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"),
      file: path.basename(file),
    };
  } catch {
    return null;
  }
}

export function findApplication(n: string): Application | null {
  return readApplications().find((a) => a.n === n) ?? null;
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


/**
 * AGENTS.md's two language axes, resolved from config/profile.yml.
 *
 * `language.output` governs human-facing prose; `language.modes_dir` selects the
 * market vocabulary and local evaluation rules. They compose freely — English
 * output with DACH vocabulary is a valid configuration — so they are returned
 * as separate fields rather than collapsed into one "locale".
 */
export type LanguageConfig = {
  /** language.output — prose language for user-facing text. Default "en". */
  output: string;
  /** language.modes_dir, normalized without a trailing slash. Default "modes". */
  modesDir: string;
  /** The market's evaluation-mode file, repo-root-relative. Default "modes/oferta.md". */
  evalModeFile: string;
};

/**
 * A `modes_dir` value we are willing to turn into a filesystem path.
 *
 * profile.yml is user-editable and this value is used to read a directory and
 * to build a path handed to an agent, so it is validated rather than trusted:
 * a crafted `modes/../../etc` must not escape the checkout. Rejecting falls
 * back to the default, which is always correct, never dangerous.
 */
const MODES_DIR_RE = /^modes(?:\/[A-Za-z0-9_-]+)?$/;

/**
 * Every localized evaluation mode's title line states the block range it
 * produces — "Valutazione completa A-F", "完整的 A-G 维度评估", "전체 평가 A-G".
 * Older translations say A-F and newer ones A-G (Block G, posting legitimacy),
 * so both count; the dash may be ASCII or typographic.
 *
 * This is what identifies the evaluation mode inside a market directory, in
 * preference to a hardcoded {dir → filename} map. A map would have to list all
 * 18 market directories that exist today and would silently go stale the next
 * time a translation lands — the exact class of bug this function is fixing.
 * Verified against every market directory in the repo: each contains exactly
 * one file whose title line matches, and no apply-mode collides.
 */
const EVAL_MODE_TITLE_RE = /A[-\u2010-\u2015][FG]/;

const DEFAULT_EVAL_MODE = "modes/oferta.md";

/**
 * Find the evaluation mode inside a market directory. Returns the default when
 * the directory is unreadable or nothing in it looks like an evaluation mode —
 * a wrong-but-working English evaluation beats a run that cannot start.
 */
function resolveEvalModeFile(root: string, modesDir: string): string {
  if (modesDir === "modes") return DEFAULT_EVAL_MODE;
  let names: string[];
  try {
    names = fs.readdirSync(path.join(root, modesDir));
  } catch {
    return DEFAULT_EVAL_MODE;
  }
  for (const name of names.sort()) {
    // `_shared.md`, `_profile.md` and friends are includes, never entry points.
    if (!name.endsWith(".md") || name.startsWith("_") || name === "README.md") continue;
    try {
      const first = fs.readFileSync(path.join(root, modesDir, name), "utf8").split("\n", 1)[0] ?? "";
      if (EVAL_MODE_TITLE_RE.test(first)) return `${modesDir}/${name}`;
    } catch {
      /* unreadable file — keep looking */
    }
  }
  return DEFAULT_EVAL_MODE;
}

/**
 * Read the language configuration. Never throws: a missing or malformed
 * profile.yml yields the English/global default, because a broken config
 * should degrade the market vocabulary, not block every evaluation.
 */
export function readLanguageConfig(): LanguageConfig {
  const root = careerOpsRoot();
  let modesDir = "modes";
  let output = "en";
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const language = (parsed as Record<string, unknown>).language;
      if (language && typeof language === "object" && !Array.isArray(language)) {
        const l = language as Record<string, unknown>;
        if (typeof l.output === "string" && l.output.trim()) output = l.output.trim();
        if (typeof l.modes_dir === "string" && l.modes_dir.trim()) {
          const candidate = l.modes_dir.trim().replace(/\/+$/, "");
          if (MODES_DIR_RE.test(candidate)) modesDir = candidate;
        }
      }
    }
  } catch {
    /* no profile yet, or malformed — defaults are correct */
  }
  return { output, modesDir, evalModeFile: resolveEvalModeFile(root, modesDir) };
}
