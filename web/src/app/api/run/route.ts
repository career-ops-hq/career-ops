import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { killCliTree, spawnCli } from "@/lib/cli-spawn";
import { findExistingEvaluation, markInboxDone } from "@/lib/core/eval-dedupe";
import { buildCliArgs, buildCliEnv, detectCliPlaintextError, processStreamJsonLines, usesStreamJson } from "@/lib/cli-stream";
import { careerOpsRoot, findApplication, primaryReportNum, readMemory } from "@/lib/career-ops";
import { acquireEvalGate, acquirePdfGate, isTrackerWriting } from "@/lib/core/run-registry";
import { runCoreScript } from "@/lib/core/run-core-script";
import { buildPrompt } from "@/lib/run-prompts.mjs";
import { jevPreScreen } from "@/lib/jev-pre-screen.mjs";
import { livenessPreScreen, isCheckableUrl } from "@/lib/liveness-pre-screen.mjs";
import { playwrightAvailable } from "@/lib/cli-capabilities.mjs";
import { claudeCliArgs, toolScopeFor } from "@/lib/claude-invocation.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

const STREAM_HEADERS: Record<string, string> = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

// The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
// kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
// artifacts (A–F report + tracker row) via the SAME scripts the CLI uses.
// Prompts live in run-prompts.mjs; Claude tool/sandbox argv is built ONLY by
// claudeCliArgs (route may not spell tool flags — #2185). Streams NDJSON.

/**
 * Gate 3 telemetry — the post-tailoring compliance audit, reported alongside
 * `done` so the card can show it without polling.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT
 *   `jev-post-linter.mjs` is a root-level asset and web/src/ is the dashboard's
 *   import boundary: Turbopack pins its module graph to web/ and statically
 *   traces path literals, so importing across it fails the production build
 *   (see the rootScript() note in @/lib/career-ops and modes/_custom.md §Jev).
 *   `runCoreScript` is the sanctioned way to reach a root .mjs: a bounded
 *   subprocess over an assembled path. The linter's own decision logic is pure,
 *   but the CLI is its supported entry point, so that is what we call.
 *
 * FAIL-OPEN, WITHOUT EXCEPTIONS
 *   Gate 3 is an audit. If it cannot answer, the run still produced a PDF, and
 *   silently withholding it would be worse than no audit — it would look like a
 *   working safety net while removing the user's output. So every failure mode
 *   (no artifact, no local JD, spawn error, timeout, unparseable stdout, thrown
 *   exception) returns `unavailable` and the run completes normally. `halt` is
 *   reserved for a real finding reported by the linter itself, and even then it
 *   is telemetry only: it never blocks the stream.
 */
type Gate3Decision = "pass" | "halt" | "unavailable";
type Gate3Telemetry = {
  decision: Gate3Decision;
  reason?: string;
  reasons?: string[];
  /** What was actually audited — surfaces the payload-vs-markdown caveat. */
  source?: string;
};

/** The single fail-open default, per the Gate 3 contract. */
const GATE3_FALLBACK: Gate3Telemetry = {
  decision: "unavailable",
  reason: "LINTER_SUBPROCESS_FALLBACK",
};

const GATE3_TIMEOUT_MS = 45_000;

/**
 * URL-input JD capture. Deliberately short: browser-extract.mjs short-circuits
 * to the ATS JSON API (Greenhouse/Lever/Ashby/Workday — the large majority) and
 * never launches a browser there; only a cold headless Chromium launch on some
 * other board can hit this, and that is the case worth abandoning rather than
 * holding a finished request open for.
 */
const GATE3_EXTRACT_TIMEOUT_MS = 20_000;

/** The ledger append is advisory — never let it hold a finished run open long. */
const GATE3_LEDGER_TIMEOUT_MS = 15_000;

/** Trim to a bounded string; a subprocess can emit anything. */
function gate3Text(value: unknown, max = 300): string {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Turn jev-post-linter's stdout into telemetry. Its CLI prints exactly one line:
 *   "Gate 3 pass: clean" | "Gate 3 halt: <reasons>" | "Gate 3 unavailable: <reason>"
 *
 * Anything else means we could not read a verdict, which is `unavailable` —
 * never `halt`, because a garbled stream is a transport failure and not a
 * finding about the CV.
 */
function parseGate3Output(output: string): Gate3Telemetry {
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Gate 3 "));
  if (!line) return { ...GATE3_FALLBACK, reason: "UNPARSEABLE_LINTER_OUTPUT" };

  const match = /^Gate 3 (pass|halt|unavailable)\s*:?\s*([\s\S]*)$/.exec(line);
  if (!match) return { ...GATE3_FALLBACK, reason: "UNPARSEABLE_LINTER_OUTPUT" };

  const [, decision, detail] = match;
  const body = gate3Text(detail);
  // The body is NOT split on ";": the linter's own reason prose contains
  // semicolons ("weak experience lines; insert structured metrics"), so
  // splitting corrupts it. Keep it verbatim as a single reason and let the card
  // render it as written.
  if (decision === "halt") return { decision: "halt", reasons: body ? [body] : ["linter reported a finding"] };
  if (decision === "unavailable") return { decision: "unavailable", reason: body || "LINTER_REPORTED_UNAVAILABLE" };
  return { decision: "pass", reasons: [] };
}

/** The local JD path for a `local:jds/...` input, else null (URL/remote inputs). */
function gate3JobPath(input: string): string | null {
  if (!input.startsWith("local:")) return null;
  const rel = input.slice("local:".length);
  const abs = path.join(careerOpsRoot(), rel);
  return fs.existsSync(abs) ? abs : null;
}

/** Most recent `cv-*.payload.json` in output/ — the tailored CV this run wrote. */
function gate3TailoredPayloadPath(): string | null {
  try {
    const outDir = path.join(careerOpsRoot(), "output");
    const candidates = fs
      .readdirSync(outDir)
      .filter((f) => f.startsWith("cv-") && f.endsWith(".payload.json"))
      .map((f) => ({ f, mtime: fs.statSync(path.join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return candidates.length ? path.join(outDir, candidates[0].f) : null;
  } catch {
    return null;
  }
}

/**
 * Isolate the JSON payload from a mixed stdout+stderr stream.
 *
 * `runCoreScript` concatenates both channels into `.output`
 * (run-core-script.ts:28), and browser-extract.mjs writes its JSON to stdout
 * while every error path writes to stderr. On a clean success stderr is empty,
 * but a stray warning line ahead of the JSON would make a bare JSON.parse()
 * throw and lose a perfectly good capture — so slice from the first `{` to the
 * last `}` and parse only that.
 *
 * Exported for web/tests/lib/gate3-telemetry-parser.test.mjs.
 */
export function extractJsonPayload(output: string): { text: string } | null {
  const raw = String(output ?? "").trim();
  if (!raw) return null;
  // A `--mode listing` response is a JSON ARRAY ({ url, jobs }). Slicing the first
  // `{`…last `}` out of an array would carve its first job entry loose and hand
  // back a plausible-looking { text } that was never a JD. So the slice is only
  // allowed when the FIRST JSON VALUE in the stream is an object: find the first
  // '{' or '[' outside of any already-consumed JSON, and require '{'. Keyed on
  // the first structural character rather than raw.startsWith, so a stderr line
  // ahead of the JSON does not smuggle an array through.
  const firstStructural = raw.search(/[[{]/);
  if (firstStructural === -1 || raw[firstStructural] !== "{") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const text = (parsed as { text?: unknown }).text;
  // A non-string or blank .text is not a usable JD: the linter would be handed
  // nothing to audit and could only report `unavailable` anyway.
  return typeof text === "string" && text.trim() !== "" ? { text } : null;
}

/**
 * Capture the JD text for a URL input via browser-extract.mjs and stage it in a
 * private temp dir. Returns a cleanup thunk the caller MUST run in a finally.
 *
 * Throws on every failure path — collectGate3Telemetry() owns the fail-open
 * translation, so there is exactly one place that decides what an extraction
 * failure means.
 */
/**
 * Ledger row id. A `local:jds/…` run is tied to a report number, and the best
 * available tracker key for it is that number — but a URL paste has no tracker
 * row yet, so the posting URL is used and the TUI sees "" for the numeric join.
 * Reported rather than guessed: a wrong number would attach a Gate 3 verdict to
 * a DIFFERENT application, which is worse than a blank the consumer can filter.
 */
function gate3LedgerId(input: string): string {
  if (input.startsWith("local:")) {
    const m = input.match(/(\d{3})-/);
    if (m) return m[1];
    return path.basename(input).replace(/\.[^.]+$/, "").slice(0, 40);
  }
  return input.slice(0, 40);
}

/** Best-effort company/role for the ledger's human-readable columns. */
function gate3LedgerRoleHints(input: string): [string, string] {
  if (input.startsWith("local:")) {
    const base = path.basename(input).replace(/\.[^.]+$/, "");
    const m = base.match(/^\d+-([a-z0-9-]+)-/);
    return m ? [m[1].replace(/-/g, " "), base] : ["", base];
  }
  return ["", input];
}

function captureUrlJdText(url: string): { jobPath: string; cleanup: () => void } {
  const { output, error } = runCoreScript(
    "browser-extract",
    [url, "--mode", "jd", "--max-chars", "30000"],
    GATE3_EXTRACT_TIMEOUT_MS,
  );
  if (error) throw new Error(gate3Text(error, 120) || "browser-extract could not run");

  const payload = extractJsonPayload(output);
  if (!payload) {
    const err = new Error("EMPTY_OR_BLOCKED_JD_CAPTURE");
    err.name = "EMPTY_OR_BLOCKED_JD_CAPTURE";
    throw err;
  }

  // 0700: this holds third-party web content on disk, readable only by this
  // process for the lifetime of the audit.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate3-jd-"));
  fs.chmodSync(dir, 0o700);
  const jobPath = path.join(dir, "job.txt");
  fs.writeFileSync(jobPath, payload.text, "utf-8");
  return { jobPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Run Gate 3 for a finished pdf run. Never throws — every path returns
 * telemetry, and every failure is `unavailable`.
 *
 * SINGLE-SINK FUNNEL: every checkpoint assigns `telemetry` and returns it; the
 * ledger append happens exactly once, in `finally`. The earlier shape put the
 * append inline on the success path only, so five of six exits — every
 * fail-open branch — wrote nothing to data/gate3-log.tsv. That made the ledger
 * structurally incapable of reporting the one thing worth measuring: how often
 * the gate declines to answer. A funnel makes it impossible to add a seventh
 * path that forgets to log.
 */
function collectGate3Telemetry(input: string): Gate3Telemetry {
  let cleanup: (() => void) | null = null;
  // NO_TAILORED_PAYLOAD is excluded from the ledger (see finally): it means the
  // pdf lane produced no tailored artifact, so there is no CV to have audited
  // and logging it would pollute the metric with non-attempts.
  let telemetry: Gate3Telemetry = GATE3_FALLBACK;
  try {
    const resumePath = gate3TailoredPayloadPath();
    if (!resumePath) return { ...GATE3_FALLBACK, reason: "NO_TAILORED_PAYLOAD" };
    const source = path.basename(resumePath);

    let jobPath = gate3JobPath(input);
    if (!jobPath) {
      // URL input: no local capture, so scrape one. This is the whole point of
      // the bridge — without it, every URL-pasted application (the most common
      // way to use the dashboard) reported NO_LOCAL_JD and was never audited.
      if (!isCheckableUrl(input)) {
        telemetry = { decision: "unavailable", reason: "NO_LOCAL_JD", source };
        return telemetry;
      }
      try {
        const captured = captureUrlJdText(input);
        jobPath = captured.jobPath;
        cleanup = captured.cleanup;
      } catch (err) {
        const reason = err instanceof Error && err.name === "EMPTY_OR_BLOCKED_JD_CAPTURE"
          ? "EMPTY_OR_BLOCKED_JD_CAPTURE"
          : "BROWSER_EXTRACT_SUBPROCESS_FAILURE";
        telemetry = { decision: "unavailable", reason, source };
        return telemetry;
      }
    }

    const { output, error } = runCoreScript("jev-post-linter", [resumePath, jobPath], GATE3_TIMEOUT_MS);
    if (error) {
      telemetry = { ...GATE3_FALLBACK, reason: gate3Text(error, 120) || "LINTER_SUBPROCESS_FALLBACK", source };
      return telemetry;
    }

    telemetry = { ...parseGate3Output(output), source };
    return telemetry;
  } catch (err) {
    // Belt-and-braces: the helpers above already guard their own I/O, but a
    // telemetry failure must never be able to take down a finished run.
    telemetry = { ...GATE3_FALLBACK, reason: gate3Text(err instanceof Error ? err.message : err, 120) || "LINTER_SUBPROCESS_FALLBACK" };
    return telemetry;
  } finally {
    // Persist the outcome (pass, halt, or unavailable) to the on-disk ledger so
    // the metric survives the session for the Go TUI, which has no access to
    // this stream. Advisory by construction: the CV is already written and the
    // run has already reported done, so a failed append must never change what
    // the card shows.
    if (telemetry.reason !== "NO_TAILORED_PAYLOAD") {
      try {
        const [company, role] = gate3LedgerRoleHints(input);
        runCoreScript(
          "append-gate3-log",
          [
            gate3LedgerId(input),
            company,
            role,
            telemetry.decision,
            gate3Text(telemetry.reason ?? telemetry.reasons?.join("; ") ?? "", 200),
          ],
          GATE3_LEDGER_TIMEOUT_MS,
        );
      } catch {
        /* advisory ledger — never fatal */
      }
    }
    // Always reclaim the staged JD text — it is third-party content and must not
    // outlive the audit, including when the linter throws.
    try { cleanup?.(); } catch { /* nothing left to do */ }
  }
}

export async function POST(req: Request) {
  let body: { kind?: string; input?: string; cliId?: string; force?: boolean | string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId, force } = body;
  if (!input || !cliId) {
    return new Response(JSON.stringify({ error: "input and cliId required" }), { status: 400 });
  }
  const forceRun =
    force === true ||
    force === "1" ||
    force === "true" ||
    new URL(req.url).searchParams.get("force") === "1";
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  const needsScript: Record<string, string> = {
    evaluate: "modes/oferta.md",
    "fix-portal": "verify-portals.mjs",
    pdf: "generate-pdf.mjs",
    cover: "generate-cover-letter.mjs",
  };
  const required = needsScript[kind];
  if (required && !fs.existsSync(path.join(careerOpsRoot(), required))) {
    return new Response(
      JSON.stringify({
        error: `This needs a complete career-ops checkout (${required}). CAREER_OPS_ROOT has data only — point it at a full checkout.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if ((kind === "evaluate" || kind === "pdf" || kind === "cover") && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return new Response(
      JSON.stringify({ error: "Add your CV first so I can score this against you — drop it on the home page." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Duplicate-evaluate guard: if this input already produced a report, resolving
  // the card to that report costs ZERO tokens and stops the "posting never
  // leaves the pipeline" loop — the same URL/jds file re-fired a second worker
  // for Airtel (report 164 next to 160) and Nians (2026-09-28). The report is
  // the binding evidence (not scanner history — seen ≠ evaluated). force=1 is
  // the deliberate re-run escape hatch.
  if (kind === "evaluate" && !forceRun) {
    const existing = findExistingEvaluation(careerOpsRoot(), input);
    if (existing != null) {
      try {
        markInboxDone(careerOpsRoot(), input);
      } catch {
        /* a row flip failing must not fail the response */
      }
      const encDup = new TextEncoder();
      const dupStream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encDup.encode(JSON.stringify({ type: "status", label: `Already evaluated — report #${existing}; no new run. (re-run: force=1)` }) + "\n"));
          c.enqueue(encDup.encode(JSON.stringify({ type: "done", tokens: 0 }) + "\n"));
          c.close();
        },
      });
      return new Response(dupStream, { headers: STREAM_HEADERS });
    }
  }

  // Is this posting still open? Checked before an expensive worker launches,
  // because a closed posting is the one signal that is both certain and worth
  // acting on: 33% of this user's real report URLs were dead, and a full
  // evaluation of one can only describe a page nobody can apply to.
  //
  // Deliberately narrow, matching the batch pre-pass: only a CONFIRMED "expired"
  // stops the run, and forceRun overrides it. "uncertain" (DNS failure, timeout,
  // bot-blocked) proceeds — wrongly blocking a live role is far more expensive
  // than evaluating a dead one, especially when the user is watching one run.
  // The preflight is API-only (--no-fallback), so it costs no tokens and no
  // browser, and it cannot block a JS-rendered page into a false "expired".
  if (kind === "evaluate" && isCheckableUrl(input) && !forceRun) {
    const live = livenessPreScreen({ url: input, root: careerOpsRoot() });
    if (live.decision === "expired") {
      const encDead = new TextEncoder();
      const why = live.reason ? ` (${live.reason})` : "";
      const deadStream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encDead.encode(JSON.stringify({ type: "status", label: `Posting confirmed closed${why} — no run started, no tokens spent. (re-run anyway: force=1)` }) + "\n"));
          c.enqueue(encDead.encode(JSON.stringify({ type: "done", tokens: 0 }) + "\n"));
          c.close();
        },
      });
      return new Response(deadStream, { headers: STREAM_HEADERS });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  // Web job inputs are tracker ROW ids; report filenames / pdf-index keys are
  // REPORT numbers, which diverge after a re-eval renumbers the Report cell
  // (row 135 ↔ report 144). Resolve the real report # for pdf/cover prompts.
  const reportNum =
    kind === "pdf" || kind === "cover" ? primaryReportNum(findApplication(input), input) : input;

  // Playwright is per-CLI (doctor.mjs owns the truth). The prompt used to claim it
  // was unavailable for every CLI, which told the one CLI that HAS it — opencode —
  // to skip verification; 42 reports carry the unconfirmed header because of it.
  const hasPlaywright = playwrightAvailable(cliId, careerOpsRoot());

  // Cheap deterministic ATS prior, advisory only. It can never discard: measured
  // over 69 real postings it never scored >= 4.0 (0/69), and at a 2.6 cut-off it
  // would have dropped 6 roles the user actually applied to. Fail-open by design
  // — a provider outage must not stop someone's job search, so every failure path
  // returns decision "unavailable" and the full evaluation proceeds unchanged.
  // Only runs on a local text capture; a URL would need the JD fetched first, and
  // duplicating that fetch here would race the worker's own read of the same page.
  let jevPrior: ReturnType<typeof jevPreScreen> | null = null;
  if (kind === "evaluate" && input.startsWith("local:") && !forceRun) {
    try {
      jevPrior = jevPreScreen({
        jobPath: path.join(careerOpsRoot(), input.slice("local:".length)),
        root: careerOpsRoot(),
      });
    } catch {
      jevPrior = null;
    }
  }

  const prompt = buildPrompt({ kind, input, memory: readMemory(), today, reportNum, cliId, hasPlaywright, jevPrior });

  // "worker" surface: opencode opts into NDJSON here only. The assistant and
  // cv/ingest routes call usesStreamJson() with the default and are unaffected.
  const streamJson = usesStreamJson(cliId, "worker");
  // Tool/sandbox scope comes from claude-invocation (values asserted at #2185).
  // research is read-only; evaluate/fix-portal/pdf/cover may shell out to core
  // scripts. NEVER auto-submits — that is a prompt-level guarantee.
  const scope = toolScopeFor(kind);
  const args =
    cliId === "claude"
      ? claudeCliArgs({ kind, prompt, permissionMode: "acceptEdits" })
      : buildCliArgs(cliId, spec, {
          prompt,
          allowedTools: scope.allowed,
          disallowedTools: scope.disallowed,
          needsShell: scope.needsShell,
        });

  // For evaluations, snapshot report FILENAMES so we can verify THIS run
  // persisted. Runs are serialized (the write gate in start), so no concurrent
  // eval can satisfy the check for us. Ignore reservation sentinels
  // (*-RESERVED.md) — they are not reports.
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const listReportFiles = (): Set<string> => {
    try {
      return new Set(
        fs
          .readdirSync(reportsDir)
          .filter((f) => f.endsWith(".md") && !f.endsWith("-RESERVED.md")),
      );
    } catch {
      return new Set();
    }
  };
  const persists = kind === "evaluate";
  const reportsBefore = persists ? listReportFiles() : null;

  // pdf/cover artifact gate: "done" must mean a viewable file landed, not just
  // that the CLI printed text and exited 0 (30 Sundays: job done, no PDF →
  // View 404 → Generate reappeared once localStorage dropped the job).
  // Same-day regenerations overwrite one filename — track mtime, not just names.
  const outputDir = path.join(careerOpsRoot(), "output");
  const isArtifactName = (f: string): boolean =>
    kind === "pdf"
      ? f.startsWith("cv-") && f.endsWith(".pdf") && !f.endsWith("-cover.pdf")
      : f.endsWith("-cover.pdf");
  const listArtifacts = (): Map<string, number> => {
    const m = new Map<string, number>();
    try {
      for (const f of fs.readdirSync(outputDir)) {
        if (isArtifactName(f)) m.set(f, fs.statSync(path.join(outputDir, f)).mtimeMs);
      }
    } catch {
      /* missing output/ → empty snapshot */
    }
    return m;
  };
  const needsArtifact = kind === "pdf" || kind === "cover";
  const artifactsBefore = needsArtifact ? listArtifacts() : null;
  const wroteArtifact = (): boolean => {
    if (!artifactsBefore) return true;
    try {
      for (const f of fs.readdirSync(outputDir)) {
        if (!isArtifactName(f)) continue;
        const prev = artifactsBefore.get(f);
        if (prev === undefined || fs.statSync(path.join(outputDir, f)).mtimeMs > prev) return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  // Tracker-mutating kinds (evaluate/pdf) hold a per-lane serialization gate for
  // the WHOLE run: reports/ and applications.md are single-writer resources.
  // Evaluates serialize against evaluates and pdfs against pdfs (run-registry
  // acquireEvalGate/acquirePdfGate), so the two kinds run side by side — the
  // CLI writers already lock applications.md themselves (tracker-utils.mjs), and
  // only another EVALUATE can falsify the "any new report?" check below. Both
  // lanes still feed `writing`, so a row delete stays guarded exactly as
  // before; other kinds keep full parallelism. The child is spawned inside the
  // stream so a queued run can report "waiting" and an abort while queued can
  // skip the slot cleanly.
  let child: ReturnType<typeof spawnCli> | undefined;
  let releaseWrite: (() => void) | null = null;
  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      let sawError = false; // heuristic noise (stderr / non-zero exit) — not a verdict by itself
      let warnedStderr = false; // at most one ⚠ step for the whole run
      let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
      let lastCostUsd: number | null = null;

      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          if (releaseWrite) { releaseWrite(); releaseWrite = null; }
          try { controller.close(); } catch { /* */ }
        }
      };

      // Per-lane serialization gate: one EVALUATE at a time and one PDF at a
      // time, but the two kinds run concurrently — only a concurrent evaluate
      // can break the "any new report" check below, and the CLI writers lock the
      // tracker themselves, so a pdf never has to wait for an evaluate (or vice
      // versa). Runs queue on their own lane; the frontend card wears the
      // "Waiting…" status step.
      if (kind === "evaluate" || kind === "pdf") {
        if (isTrackerWriting()) {
          send({
            type: "status",
            label:
              kind === "evaluate"
                ? "Waiting for the running evaluation to finish…"
                : "Waiting for the running CV generation to finish…",
          });
        }
        releaseWrite = kind === "evaluate" ? await acquireEvalGate() : await acquirePdfGate();
        // The client aborted while queued — cede the slot to the next run.
        if (closed) {
          releaseWrite(); releaseWrite = null;
          close();
          return;
        }
      }

      // Surface the cheap pre-pass on the card so the number is never invisible —
      // it is advisory, and a silent advisory prior reads like a verdict.
      if (jevPrior && jevPrior.decision === "available") {
        send({
          type: "status",
          label: `Jev ATS pre-pass: ${jevPrior.score.toFixed(2)}/5 (${jevPrior.band}) · ${jevPrior.wallMs}ms · advisory, not a score`,
        });
        // Persist the triage decision to data/jev-runs.tsv. Until now the score
        // existed only in this request (the run prompt + this status event) and
        // was gone with the response, so the calibrated bands could never be
        // reviewed after the fact. `band` is whatever bandFor() already
        // computed — deliberately NOT re-derived here, so the ledger records
        // exactly what the run was told.
        try {
          runCoreScript(
            "append-jev-log",
            [gate3LedgerId(input), jevPrior.score.toFixed(2), jevPrior.band, String(jevPrior.wallMs ?? "")],
            GATE3_LEDGER_TIMEOUT_MS,
          );
        } catch {
          /* advisory ledger — never fatal, never delays the CLI spawn */
        }
      }

      // opencode's headless scope rides in OPENCODE_CONFIG_CONTENT (no per-tool
      // argv); everything else gets an empty env and stays CLI-agnostic. The env
      // only DELETES or re-scopes tool permissions — the no-auto-submit guarantee
      // is prompt-level and untouched by this.
      const cliEnv = buildCliEnv(cliId, { allowedTools: scope.allowed, disallowedTools: scope.disallowed });
      let childProc: ReturnType<typeof spawnCli>;
      try {
        // detached: true makes the CLI the leader of its own process group, so a
        // budget/cancel kill can SIGTERM the WHOLE tree (killCliTree) — otherwise
        // a `npm exec @playwright/mcp` grandchild survives the parent and orphans.
        childProc = spawnCli(binPath, args, { cwd: careerOpsRoot(), env: { ...process.env, ...cliEnv }, detached: true });
        child = childProc; // exposed to cancel() so an abort can kill it too
      } catch (e) {
        send({ type: "error", msg: e instanceof Error ? e.message : "failed to start CLI" });
        if (releaseWrite) { releaseWrite(); releaseWrite = null; }
        close();
        return;
      }

      // SIGTERM budget per kind. `evaluate` is NOT the cheap kind: a full A–F
      // oferta reads the ~1k-line mode, researches the company, then emits a
      // ~40 KB report in a SINGLE write call, then a TSV and a merge. 285 s
      // SIGTERM'd three Airtel runs mid-report (2026-09-28, sentinels 158/159
      // leaked) and 600 s still killed a research-heavy PolicyBazaar run the
      // same day (job-12, sentinel 164) — 720 s is the working budget, the same
      // as pdf. Every value must stay under `maxDuration` (800 s).
      // The timer arms on the child's FIRST output so boot/idle before any
      // stream-json event is not billed against the budget; a baseline timer
      // backstops a CLI that never produces output at all.
      const KILL_MS_BY_KIND: Record<string, number> = {
        evaluate: 720_000,
        pdf: 720_000,
      };
      const killMs = KILL_MS_BY_KIND[kind] ?? 600_000;
      let killArmed = false;
      const killTree = () => {
        if (child) killCliTree(child, true);
      };
      const armKill = () => {
        if (killArmed) return;
        killArmed = true;
        if (killer) clearTimeout(killer);
        killer = setTimeout(killTree, killMs);
      };
      killer = setTimeout(killTree, killMs + 120_000);

      childProc.stdout.on("data", (d: Buffer) => {
        armKill();
        if (closed) return;
        if (!streamJson) {
          emittedText = true;
          send({ type: "text", text: d.toString() });
          return;
        }
        buf = processStreamJsonLines(cliId, buf + d.toString(), (text) => {
          emittedText = true;
          send({ type: "text", text });
        }, (meta) => {
          // Stream-json auth failures are terminal — the CLI cannot continue.
          if (meta.authError) {
            sawError = true;
            send({ type: "error", msg: meta.authError });
          }
          if (meta.toolName) send({ type: "tool", name: meta.toolName });
          if (meta.status) send({ type: "status", label: meta.status });
          // "delta" (opencode) reports PER-STEP tokens that must be summed; the
          // last step alone is not the run total. "replace" (claude/cursor) is a
          // single final result event carrying the whole run.
          if (meta.tokens != null) {
            lastTokens = meta.tokensMode === "delta" ? lastTokens + meta.tokens : meta.tokens;
          }
          if (meta.costUsd != null) lastCostUsd = meta.costUsd;
        });
      });
      childProc.stderr.on("data", (d: Buffer) => {
        const raw = d.toString();
        // Heuristic ONLY — never finish the job mid-run on stderr text. OpenCode
        // (and other CLIs) echo `$ cmd` / UI noise to stderr; a chunk can start
        // with `$ node company-history.mjs` and still contain "error"/"auth"
        // from a coalesced write. Record the hit; the close gate decides.
        const hit = /error|denied|fatal|not found|unauthorized|forbidden|auth|login|credential|api[ -]?key|quota|rate limit|not authenticated/i.test(raw);
        if (!hit) return;
        sawError = true;
        // Quiet: one warning max, and skip pure shell-echo lines (`$ cmd…`).
        if (warnedStderr) return;
        const clean = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
        const lines = clean
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        // Prefer a line that looks like a message, not a prompt/echo of a command.
        const msgLine = lines.find(
          (l) =>
            /error|denied|fatal|not found|unauthorized|forbidden|not authenticated|quota|rate limit/i.test(l) &&
            !/^\$\s/.test(l) &&
            !/\brtk\b|\bnode\s+\S+\.mjs\b|\becho\b|\bhead\b|\btail\b/.test(l),
        );
        if (!msgLine) return; // command-echo noise only — sawError stays, no ⚠ step
        warnedStderr = true;
        send({ type: "warning", msg: msgLine.replace(/\s+/g, " ").slice(0, 200) });
      });
      childProc.on("error", (e) => { send({ type: "error", msg: e.message }); close(); });
      childProc.on("close", (code) => {
        // Spawn-level / proxy plaintext failures are terminal.
        const tailErr = detectCliPlaintextError(buf);
        if (tailErr) {
          sawError = true;
          send({ type: "error", msg: tailErr });
          close();
          return;
        }
        // THIS run must have added a report file — not merely a higher global
        // count (a concurrent eval could have written someone else's report).
        let wroteReport = true;
        if (persists && reportsBefore) {
          wroteReport = false;
          try {
            for (const f of fs.readdirSync(reportsDir)) {
              if (f.endsWith(".md") && !f.endsWith("-RESERVED.md") && !reportsBefore.has(f)) {
                wroteReport = true;
                break;
              }
            }
          } catch {
            wroteReport = false;
          }
        }
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        const artifactOk = !needsArtifact || wroteArtifact();
        // Honesty gate (#9): a green "done" with a parsed score requires real
        // output AND (for evaluations) a report THIS run wrote. Stderr keyword
        // hits and a dirty exit are warnings when artifacts landed — evidence
        // outranks heuristics. Hard-fail only when the run produced nothing
        // useful (no output, evaluate with no new report, or pdf/cover with no
        // file — a "done" job whose View would 404 is worse than a red card).
        if (!emittedText) {
          if (!cleanExit) {
            send({ type: "error", msg: "The CLI exited with an error — is it installed and authenticated?" });
          } else {
            send({ type: "error", msg: "The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)" });
          }
        } else if (persists && !wroteReport) {
          send({
            type: "error",
            msg: hasPlaywright
              ? "This evaluation didn't save a report, so it's not in your tracker — check the worker log above for where it stopped."
              : "This evaluation didn't save a report, so it's not in your tracker. This CLI has no Playwright headless, so posting verification is weaker here.",
          });
        } else if (needsArtifact && !artifactOk) {
          send({
            type: "error",
            msg:
              kind === "cover"
                ? "This run finished without writing a cover-letter PDF under output/ — nothing to view. Re-run Generate."
                : "This run finished without writing a CV PDF under output/ — nothing to view. Re-run Generate CV.",
          });
        } else if (cleanExit && !sawError) {
          // Gate 3 rides on the same payload as the tokens. Advisory telemetry:
          // `unavailable` and `halt` both complete normally, and only a real pdf
          // lane has a tailored artifact to audit.
          const gate3Telemetry = kind === "pdf" ? collectGate3Telemetry(input) : GATE3_FALLBACK;
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd, gate3: gate3Telemetry });
        } else if ((persists && wroteReport) || (needsArtifact && artifactOk)) {
          // Report/PDF landed despite stderr noise / non-zero exit — bank it as
          // done with a visible warning so the card is honest without lying red.
          send({
            type: "status",
            label: cleanExit
              ? `Finished with stderr warnings (${persists ? "report" : "PDF"} saved)`
              : `Exit ${code ?? "signal"} after ${persists ? "report" : "PDF"} saved`,
          });
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else if (cleanExit) {
          // Non-persist kind: output + clean exit is enough even if stderr tripped.
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else {
          send({ type: "error", msg: "This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify." });
        }
        close();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      if (releaseWrite) { releaseWrite(); releaseWrite = null; }
      if (child) killCliTree(child, true);
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
