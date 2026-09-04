// Both spawners are needed here, and the distinction matters: the agent CLI goes
// through spawnHeadlessCli (which closes stdin so `codex exec` can't hang waiting
// on it, #2085), while the PDF render is a plain Node child process with no CLI
// sandbox in the way (#2172) and so passes `spawn` itself to renderAndMarkPdf.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { accumulateTokens, hasNewCompletedReport, isFatalGenericStderr, killMsForKind, timeoutMessage } from "@/lib/run-cli-support.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { careerOpsRoot, readMemory, findReportFile, readInbox, readScanDates, readLanguageConfig } from "@/lib/career-ops";
import { resolvePdfPaths, type PdfPaths } from "@/lib/pdf-paths.mjs";
import { renderAndMarkPdf, writeCvHtml, pdfRunOutcome } from "@/lib/pdf-render.mjs";
import { evaluateRunOutcome } from "@/lib/run-outcome.mjs";
import { createCvEnvelopeFilter, type CvEnvelope } from "@/lib/cv-envelope.mjs";
import { buildPrompt, isShellSafeCompanyName } from "@/lib/run-prompts.mjs";
import { normalizeJobUrl } from "@/lib/job-url.mjs";
import { isJdRef, jdRefPath } from "@/lib/jd-source.mjs";
import { claudeCliArgs } from "@/lib/claude-invocation.mjs";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

/**
 * What a kind's prepare() hands back to the request when it succeeds.
 *
 * Every field is optional and only the kind that produces one sets it: evaluate
 * returns the normalized posting URL (plus the mirror to actually fetch from),
 * pdf returns its resolved paths, and the rest return neither. The optionality
 * is real rather than defaulted — this replaced `let evalUrl = input; let
 * fetchUrl: string | undefined;`, two mutable bindings whose value for three of
 * the four kinds was a silent fallback nobody read.
 */
type PrepareResult =
  | { ok: true; input?: string; fetchUrl?: string; pdfPaths?: PdfPaths }
  | { ok: false; error: string };

/** What the prepare steps need from the request, injected so they stay small. */
type PrepareContext = { root: string; today: string };

/**
 * Everything /api/run needs to know about a worker kind, in one row per kind.
 *
 * This table is the whole of the route's kind-awareness. It grew out of what
 * used to be nine scattered `kind === "..."` conditionals, three of which spelled
 * the same `evaluate || pdf` pair for three unrelated reasons — a shape where the
 * only way to answer "what does pdf actually do differently?" was to read the
 * whole file. `kind` itself still reaches buildPrompt and claudeCliArgs verbatim;
 * the tool scope is theirs to decide, never this table's (#2185).
 */
type KindSpec = {
  /** Core file this kind actually runs — absent from a data-only CAREER_OPS_ROOT. */
  script?: string;
  /** Needs cv.md: an A-F score or a tailored CV is meaningless without one. */
  needsCv?: boolean;
  /** Mutates the tracker, so it holds a write token for the whole run. */
  holdsTrackerWrite?: boolean;
  /** Writes a report file, so the route can verify one actually landed. */
  persistsReport?: boolean;
  /** Agent emits its CV inline in a `<<cv-html>>` envelope the backend renders (#2185). */
  emitsCvEnvelope?: boolean;
  /** Per-kind input validation/normalization; a failure becomes the route's 400. */
  prepare?: (input: string, ctx: PrepareContext) => PrepareResult;
};

/**
 * "evaluate" is the only kind whose input is a posting URL — pdf takes a report
 * number and fix-portal a company name, so neither is normalized. LinkedIn's
 * /jobs/view page is an authwall for a headless agent, so the agent reads a
 * public mirror while the report and tracker record the canonical link.
 */
function prepareEvaluate(input: string, ctx: PrepareContext): PrepareResult {
  // A `local:jds/…` reference is the other thing an evaluation can run on: a JD
  // the user pasted or uploaded, archived under jds/ by /api/jd (see
  // jd-source.mjs). There is nothing to normalize — the reference is already
  // canonical and isJdRef has already rejected anything that could escape the
  // directory — but the file has to still be there. It can be gone: jds/ is a
  // user-layer directory the user is free to prune, and an inbox row written
  // weeks ago outlives the file it points at. Caught here, that is a 400 naming
  // the file; uncaught, the agent reads nothing, scores nothing, and writes a
  // confident report about it.
  if (isJdRef(input)) {
    if (!fs.existsSync(path.join(ctx.root, jdRefPath(input)))) {
      return { ok: false, error: `That job description is gone from ${jdRefPath(input)}. Paste or upload it again.` };
    }
    return { ok: true, input };
  }
  const normalized = normalizeJobUrl(input);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  return { ok: true, input: normalized.url, fetchUrl: normalized.fetchUrl };
}

/**
 * Precompute deterministic scratch + final paths so the agent never chooses its
 * own filenames — the backend owns naming, writing (#2185) and rendering (#2172).
 * Nothing is cleared first: writeCvHtml rewrites the HTML from this run's freshly
 * parsed envelope before any render, and the agent is no longer told these paths,
 * so a stale file cannot survive into a render.
 */
function preparePdf(input: string, ctx: PrepareContext): PrepareResult {
  const pathsResult = resolvePdfPaths(input, ctx.today, ctx.root, findReportFile);
  if (!pathsResult.ok) return { ok: false, error: pathsResult.error };
  return { ok: true, pdfPaths: pathsResult.paths };
}

/**
 * fix-portal's prompt puts the company name straight into a shell command the
 * agent runs, and a company name can arrive from a public ATS listing rather than
 * the user's own typing. Refuse rather than sanitize: a silently rewritten name
 * would repair the wrong portal.
 */
function prepareFixPortal(input: string): PrepareResult {
  if (isShellSafeCompanyName(input)) return { ok: true };
  return {
    ok: false,
    error: "That company name has characters I can't safely pass to the portal checker. Rename it in portals.yml first.",
  };
}

// The agent-child timer is deliberately NOT a column here: killMsForKind() in
// run-cli-support.mjs owns it, states each kind's reason, and is asserted on
// there. A second copy in this table would be a second source of truth.
const KINDS: Record<string, KindSpec> = {
  evaluate: { script: "modes/oferta.md", needsCv: true, holdsTrackerWrite: true, persistsReport: true, prepare: prepareEvaluate },
  pdf: { script: "generate-pdf.mjs", needsCv: true, holdsTrackerWrite: true, emitsCvEnvelope: true, prepare: preparePdf },
  "fix-portal": { script: "verify-portals.mjs", prepare: prepareFixPortal },
  research: {},
};

/**
 * A kind none of the tables know about.
 *
 * buildPrompt deliberately falls through to the evaluate prompt for an unknown
 * kind and toolScopeFor hands it the read-only scope, so the route tolerates one
 * rather than rejecting it. This row keeps that tolerance and gives it the
 * conservative profile it already had: no script requirement, no CV gate, no
 * prepare step, no write token and no report check.
 */
const UNKNOWN_KIND: KindSpec = {};

export async function POST(req: Request) {
  let body: { kind?: string; input?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId } = body;
  if (!input || !cliId) {
    return new Response(JSON.stringify({ error: "input and cliId required" }), { status: 400 });
  }
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;

  // hasOwn, not `KINDS[kind] ?? UNKNOWN_KIND`: `kind` is client-supplied, and a
  // plain object literal answers `KINDS["constructor"]` with a function rather
  // than undefined — which would slip past `??` and read every flag off it.
  const k = Object.hasOwn(KINDS, kind) ? KINDS[kind] : UNKNOWN_KIND;
  /** Every per-kind gate below rejects the same way; only the reason differs. */
  const reject = (error: string) =>
    new Response(JSON.stringify({ error }), { status: 400, headers: { "Content-Type": "application/json" } });

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  //
  // The precondition must check the file the prompt will actually read. Pinning
  // evaluate to the table's modes/oferta.md meant a configured market
  // (language.modes_dir) passed a check on a file the run never opens, and would
  // have missed a market dir with no evaluation mode. The row still names the
  // default; the configured market replaces it here, where the config is read.
  const lang = readLanguageConfig();
  const requiredScript = kind === "evaluate" ? lang.evalModeFile : k.script;
  // CAREER_OPS_ROOT is runtime user data, not a build input. Tracing this
  // dynamic path would copy the whole web project into every server bundle.
  if (requiredScript && !fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ careerOpsRoot(), requiredScript))) {
    return reject(`This needs a complete career-ops checkout (${requiredScript}). CAREER_OPS_ROOT has data only. Point it at a full checkout.`);
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if (k.needsCv && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return reject("Add your CV first so I can score this against you. Drop it on the home page.");
  }

  const today = new Date().toISOString().slice(0, 10);

  // The one per-kind input gate: shell-safety for fix-portal, path resolution for
  // pdf, URL normalization for evaluate, nothing for research. See each prepare
  // function above for why its kind needs what it needs.
  const prepared: PrepareResult = k.prepare ? k.prepare(input, { root: careerOpsRoot(), today }) : { ok: true };
  if (!prepared.ok) return reject(prepared.error);
  const { pdfPaths, fetchUrl } = prepared;

  // Resolve the posting date HERE rather than asking the agent for it. The
  // scanner already wrote it from the provider's own `offer.postedAt`, so this
  // copies a recorded value instead of inviting a guess — and modes/oferta.md is
  // explicit that a guessed date is worse than an absent one (the POSTED column
  // renders absent as `—`, a wrong date as a fresh req). Unknown URL → undefined
  // → the prompt writes no segment at all.
  //
  // Looked up by the URL the CLIENT sent, not by prepare()'s rewrite: the inbox
  // and the scan-date map are both keyed by the canonical posting URL, which is
  // exactly what a mirror rewrite replaces.
  const postedAt =
    kind === "evaluate"
      ? readInbox().find((j) => j.url === input)?.postedAt ?? readScanDates().get(input)
      : undefined;
  // prepare() only returns an input when it rewrote one (evaluate); every other
  // kind sends what the client typed, untouched.
  const prompt = buildPrompt({ kind, input: prepared.input ?? input, memory: readMemory(), today, postedAt, fetchUrl, lang });

  const isClaude = cliId === "claude";
  // Which tools each kind gets, and the whole claude argv, live in
  // claude-invocation.mjs — see its header for the policy and for why it is asserted on
  // built values rather than on this file's source. NEVER auto-submits; that
  // remains a prompt-level guarantee.
  // Non-Claude CLIs get no tool flags from spec.args() at all, so their agents
  // stay unrestricted here. That gap is route-wide (it applies to 'evaluate' too),
  // not specific to pdf, and each CLI needs its own mechanism researched — tracked
  // as #2507 rather than half-fixed here. On those CLIs the backend is the only
  // INTENDED writer — the agent is not asked to write — but that is mitigation, not
  // enforcement: the capability is still there for an injected posting to reach.
  // A CLI with its own structured stream gets the argv that turns it on, so its
  // stdout matches spec.parseEvent below; spec.args stays the plain-text argv the
  // envelope-parsing routes rely on.
  const args = isClaude ? claudeCliArgs({ kind, prompt }) : (spec.streamArgs ?? spec.args)(prompt);

  // For write-needing kinds, snapshot reports/ so we can verify the worker
  // actually persisted (non-Claude CLIs lack Write auth and silently no-op).
  // Names, not a count: reserving a number writes reports/NNN-RESERVED.md and the
  // final report REPLACES it, so the `.md` count is unchanged and a count-delta
  // gate reported "didn't save a report" for an evaluation that saved fine (#2085).
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const reportEntries = () => {
    try {
      return fs.readdirSync(reportsDir);
    } catch {
      return [];
    }
  };
  // Registry-driven rather than `kind === "evaluate"`: same set today, but a
  // second persisting kind declares itself instead of editing this line.
  const persists = k.persistsReport === true;
  const reportsBefore = persists ? reportEntries() : [];
  // Tracker-mutating runs hold a write token so a row delete can't race their merge
  // (tracker.mjs delete doesn't yet share a lock with merge-tracker — see run-registry).
  const writeToken = k.holdsTrackerWrite ? acquireTrackerWrite() : null;

  // stdin must reach EOF or the CLI waits on piped input that never comes: Codex's
  // `exec` blocks reading stdin for additional context, hangs until the kill timer,
  // and then reports a generic "installed and authenticated?" error that reads as an
  // auth failure even though the CLI is fully signed in. #1973 fixed that here with
  // an inline `stdio: ["ignore", …]`; spawnHeadlessCli generalizes the same fix to
  // every CLI-invoking route (assistant, explore/ai, cv/ingest, the apply planners),
  // which had the identical bug, and puts it behind one tested helper so it cannot
  // drift back in on any single call site.
  const child = spawnHeadlessCli(binPath, args, { cwd: careerOpsRoot(), env: process.env });
  // Decode once on the stream, not per chunk. Buffer#toString() decodes each chunk
  // independently, so a chunk boundary falling inside a multi-byte UTF-8 sequence
  // yields a replacement character and mis-decodes the bytes after it. Those bytes
  // are the CV now (#2185) — the agent's HTML flows through cvFilter to
  // writeCvHtml and on to the renderer — and no structural check would catch it,
  // because the envelope markers and </html> are ASCII and still match. Setting
  // the encoding makes Node hold partial sequences across chunks.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  // pdf-kind's render+mark work (renderPdf, below) keeps running detached even
  // after the agent child closes — and even after a client disconnect fires
  // cancel(). Track its promise so cancel() can defer releasing writeToken
  // until that work actually settles, instead of releasing the tracker-delete
  // guard while mark-pdf-ready.mjs is still actively writing applications.md.
  let pdfRenderPromise: Promise<void> | null = null;
  let writeTokenReleased = false;
  const releaseWriteTokenOnce = () => {
    if (writeToken !== null && !writeTokenReleased) {
      writeTokenReleased = true;
      releaseTrackerWrite(writeToken);
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      // Set ONLY by an authoritative structured-stream signal (the ev.error branch
      // in processParsedLine below) — never by flagStderrLine. A stderr keyword
      // match is a guess, not a verdict; see stderrErrorSnippet.
      let sawError = false;
      let stderrBuf = "";
      // Fallback for a CLI with no CliSpec.stderrIsFatal of its own. Moved into
      // run-cli-support.mjs beside the per-CLI classifiers so it has a reachable
      // test: as an inline regex in this closure nothing could assert it, which
      // is how a bare `auth` came to match "Authentication successful" and mark a
      // successful run as failed on six of the eight runtimes (#1974).
      const isFatalStderr = spec.stderrIsFatal ?? isFatalGenericStderr;
      // Snippet only, never fatality. isFatalStderr is a keyword guess over a
      // CLI's own stderr chatter, not a verdict — trusting it to fail the run
      // outright is exactly the bug #1974 reported: "Authentication successful"
      // matched a bare `auth` and marked a clean, successful run as an error, on
      // six of the eight runtimes. The close handler below is the sole place that
      // decides fatality, from cleanExit and the CLI's own structured error event
      // (authoritative — see the ev.error branch in processParsedLine); this only
      // captures human-readable detail for whichever message that decision needs.
      let stderrErrorSnippet: string | null = null;
      const flagStderrLine = (line: string) => {
        if (stderrErrorSnippet || !line.trim() || !isFatalStderr(line)) return;
        stderrErrorSnippet = line.trim().slice(0, 200);
      };
      let lastTokens = 0; // per-run token cost from the CLI's structured usage event (#6) — local only
      let lastCostUsd: number | null = null;
      // pdf-mode's agent only tailors content now (rendering moved to the
      // backend, #2172) — but its killMs still has to leave real headroom
      // inside the route's overall maxDuration (800s): the render+mark phase
      // (renderPdf, below) starts only after this timer's window and has no
      // timeout of its own, so an agent that runs close to its full budget
      // would otherwise leave the platform's hard maxDuration cutoff to kill
      // generate-pdf.mjs mid-render. 600s agent / ~200s render is ample —
      // a Chromium PDF render normally takes low tens of seconds even with a
      // cold Playwright launch.
      // pdf keeps 600s because its render+mark phase runs AFTER this timer; a
      // plain evaluate has no such phase, so it can use almost the whole 800s
      // budget. 285s was cutting real evaluations off mid-run — reading the mode
      // and profile, fetching the posting, ~25 Bash calls and a few web searches
      // routinely run past it — and the SIGTERM then surfaced as "didn't save a
      // report" (see the close handler), blaming the CLI for a limit we imposed
      // (#3124). 780s leaves ~20s under maxDuration for a graceful shutdown.
      const killMs = killMsForKind(kind);
      // Set by the killer so the close handler can tell "we timed it out" apart
      // from "the CLI exited on its own" — different failures, different message.
      let killedByTimeout = false;
      killer = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, killMs);
      // Declared before send() so send() can clear it the moment it sees the
      // client disconnect; assigned just below, once close() exists.
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // The client is gone. Stop the heartbeat here rather than waiting for
          // close(): the child can still run for minutes (maxDuration 800s), and
          // a user retrying a failed run would otherwise accumulate one live
          // timer per abandoned request.
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
        }
      };
      // Time-based keepalive. The stream is silent whenever the agent is thinking
      // or inside a long tool call, and in pdf mode it is silent for the whole
      // 15-25 KB <<cv-html>> envelope (cvFilter swallows every byte). Measured
      // idle gaps on a real pdf run reached 149s — long enough for the browser or
      // a proxy to drop the connection, after which the client reports
      // "Connection error" even though the agent finished and the PDF rendered.
      // It must be a timer, not a hook on incoming text: piggy-backing on agent
      // output cannot fire during exactly the silences it needs to cover.
      // Unknown event types are ignored by the client's switch, so old tabs are safe.
      heartbeat = setInterval(() => send({ type: "keepalive" }), 10_000);
      const close = () => {
        if (!closed) {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          if (killer) clearTimeout(killer);
          releaseWriteTokenOnce();
          try { controller.close(); } catch { /* */ }
        }
      };
      // pdf's CV arrives inline in a <<cv-html>> envelope instead of being written
      // by the agent (#2185). The filter keeps every byte for the backend while
      // holding the 15-25 KB body out of the run log, which is the agent's
      // narration — see cv-envelope.mjs.
      const cvFilter = k.emitsCvEnvelope ? createCvEnvelopeFilter() : null;
      // While the agent emits the 15-25 KB <<cv-html>> envelope, cvFilter swallows
      // every byte, so the response stream goes completely silent for as long as
      // the model takes to write the CV — a minute or more. Nothing downstream can
      // tell that from a hung request, and the browser/proxy drops the connection;
      // the client then reports "Connection error" even though the agent is fine
      // and the PDF renders correctly server-side. Emit a throttled keepalive so
      // the stream never idles during the filtered phase. Unknown event types are
      // ignored by the client's switch, so this is safe for older tabs too.
      const sendAgentText = (text: string) => {
        const visible = cvFilter ? cvFilter.push(text) : text;
        if (visible) send({ type: "text", text: visible });
      };
      /** Surface non-fatal issues in the run log rather than only a server log. */
      const sendWarnings = (warnings: string[]) => {
        for (const w of warnings) send({ type: "text", text: `⚠️ ${w}\n` });
      };
      /** Persist the emitted CV; streams the reason and returns false on failure. */
      const saveCv = (paths: PdfPaths, envelope: CvEnvelope) => {
        const written = writeCvHtml({ pdfPaths: paths, html: envelope.html });
        if (!written.ok) send({ type: "error", msg: written.error.slice(0, 200) });
        return written.ok;
      };

      // One dispatch for every structured CLI: the per-CLI knowledge (which event
      // means text/tool/status/usage) lives in run-cli-support.mjs behind
      // spec.parseEvent, so adding the next such CLI needs no change here.
      // Shared with the close-time flush below, so a final JSONL line the CLI never
      // newline-terminates before exiting isn't dropped along with the usage event
      // it carries.
      const processParsedLine = (line: string) => {
        if (!spec.parseEvent) return;
        const ev = spec.parseEvent(line);
        if (ev?.text) {
          emittedText = true;
          // sendAgentText, NEVER send: pdf's CV arrives inside the agent's text as a
          // <<cv-html>> envelope, so parsed text has to reach cvFilter too or the
          // backend has nothing to save and the 25 KB body floods the run log (#2185).
          sendAgentText(ev.text);
        }
        if (ev?.tool) send({ type: "tool", name: ev.tool });
        if (ev?.status) send({ type: "status", label: ev.status });
        // Accumulated, not assigned: usage events are per-turn, so overwriting made a
        // multi-turn run report only its last turn. The authoritative "done" is sent
        // on close, so the honesty gate decides done-vs-error first.
        lastTokens = accumulateTokens(lastTokens, ev);
        if (typeof ev?.costUsd === "number") lastCostUsd = ev.costUsd;
        if (ev?.error) {
          sawError = true;
          send({ type: "error", msg: ev.error.slice(0, 200) });
        }
      };

      child.stdout.on("data", (chunk: string) => {
        if (closed) return;
        if (!spec.parseEvent) {
          emittedText = true;
          sendAgentText(chunk);
          return;
        }
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) processParsedLine(line);
        }
      });
      child.stderr.on("data", (chunk: string) => {
        // Match on COMPLETE lines. A chunk boundary can fall mid-word, so testing a
        // raw chunk both misses an error split across two of them and can match a
        // fragment that is not the word it looks like. The captured snippet only
        // supplies message text for whichever failure the close handler already
        // decided on — it never sets sawError itself (see flagStderrLine above).
        stderrBuf += chunk;
        let nl;
        while ((nl = stderrBuf.indexOf("\n")) !== -1) {
          const line = stderrBuf.slice(0, nl);
          stderrBuf = stderrBuf.slice(nl + 1);
          flagStderrLine(line);
        }
      });
      // Render + mark-tracker-ready live in pdf-render.mjs (plain, dependency-
      // injected, unit-tested) so the render-then-mark orchestration isn't
      // buried untested inside this transport-layer closure. Runs generate-
      // pdf.mjs and mark-pdf-ready.mjs as plain Node child processes — no agent
      // CLI or its sandbox involved — so a browser launch never depends on an
      // interactive approval nobody is present to grant in a headless/web-
      // triggered run (#2172). The tracker is marked ✅ only after a CONFIRMED
      // successful render, not optimistically — same honesty-gate discipline as
      // the evaluate path below.
      const renderPdf = async (paths: PdfPaths, format: "letter" | "a4") => {
        send({ type: "status", label: "Rendering PDF…" });
        // renderAndMarkPdf is designed to resolve, never throw — but this is
        // the one place nothing else awaits or catches this promise (cancel()
        // only attaches a .finally for the write-token release), so an
        // unexpected exception here must still close the stream instead of
        // leaving it — and the write-token — open until process shutdown.
        try {
          const result = await renderAndMarkPdf({
            spawnFn: spawn,
            execPath: process.execPath,
            root: careerOpsRoot(),
            pdfPaths: paths,
            format,
            reportNum: input,
          });
          if (result.kind === "render-failed") {
            send({ type: "error", msg: result.error.slice(0, 200) });
            return;
          }
          // Non-fatal issues (a defaulted page format, a tracker row not marked) still
          // surface here rather than only in a server log nobody sees.
          sendWarnings(result.warnings);
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } catch (e) {
          send({ type: "error", msg: `PDF rendering crashed unexpectedly: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) });
        } finally {
          close();
        }
      };

      child.on("error", (e) => { send({ type: "error", msg: e.message }); close(); });
      child.on("close", (code) => {
        // A trailing line with no newline would otherwise never be tested.
        if (stderrBuf) { flagStderrLine(stderrBuf); stderrBuf = ""; }
        // A client disconnect can fire cancel() (which kills `child`) before
        // this event finally arrives — killing a process doesn't make its
        // 'close' event disappear, just delays it. Without this guard a pdf
        // run could still start a brand-new render (and re-touch the tracker)
        // after the stream — and its writeToken guard — is already gone.
        if (closed) return;
        // A timeout is the ROOT cause behind every "no report / not clean"
        // symptom the gates below test, so classify it FIRST, for any kind.
        // Otherwise a run we cut off at the time limit reads as "the CLI couldn't
        // save a report" and sends the user to re-check a CLI that was working
        // fine (#3124). code is null here (killed by signal), which the gates
        // would read as a generic non-clean exit.
        if (killedByTimeout) {
          send({
            type: "error",
            msg: timeoutMessage(killMs, kind),
          });
          return close();
        }
        // A final JSONL line with no trailing newline stays in `buf` forever
        // otherwise — flush it through the same parser so the usage/result event it
        // usually carries (the last one of a run) isn't lost. Ahead of the pdf branch,
        // not just the evaluate gate: the pdf path reports lastTokens too.
        const trailing = buf.trim();
        if (trailing) {
          buf = "";
          processParsedLine(trailing);
        }
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        // Shared by both honesty gates below — the pdf gate receives it as
        // pdfRunOutcome's noOutputMessage — because a CLI that produced no output at
        // all is the same failure mode whether it was evaluating or tailoring
        // a PDF — one place for the condition/message pair instead of two.
        const noOutputError = (): string | null => {
          if (!emittedText && !sawError && !cleanExit) {
            const detail = stderrErrorSnippet ? ` (${stderrErrorSnippet})` : "";
            return `The CLI exited with an error. Is it installed and authenticated?${detail}`;
          }
          if (!emittedText && !sawError) return "The CLI produced no output. Is it installed and authenticated? (career-ops is best on Claude Code.)";
          return null;
        };

        if (k.emitsCvEnvelope) {
          // Release any text the filter was still holding, so the log keeps the
          // agent's closing narration and its VERDICT line.
          const tail = cvFilter?.flush();
          if (tail) send({ type: "text", text: tail });
          // The artifact check moved from the filesystem to the stream (#2185):
          // whether pdfPaths.html exists says nothing now that the backend is its
          // only writer. pdfRunOutcome owns the decision and the message.
          const envelope = cvFilter?.result();
          const outcome = pdfRunOutcome({
            envelope,
            noOutputMessage: noOutputError(),
            sawError,
            cleanExit,
            hasPaths: pdfPaths !== undefined,
          });
          if (!outcome.ok) {
            send({ type: "error", msg: outcome.message });
          } else if (!pdfPaths || envelope?.ok !== true) {
            // Unreachable: pdfRunOutcome validated both via hasPaths/envelope.ok.
            // Kept for narrowing, but it must REPORT rather than fall through to a
            // bare close() — a stream that ends with neither error nor done is the
            // one outcome this handler exists to prevent.
            send({ type: "error", msg: "Internal error: the pdf run passed its gate with no CV to save. Please report this." });
          } else {
            sendWarnings(envelope.warnings);
            if (saveCv(pdfPaths, envelope)) {
              // Tracked so cancel() can defer releasing writeToken until this
              // settles; close() happens once rendering finishes, not here.
              pdfRenderPromise = renderPdf(pdfPaths, envelope.format);
              return;
            }
            // saveCv already streamed the specific reason.
          }
          return close();
        }

        const wroteReport = hasNewCompletedReport(reportsBefore, reportEntries());
        // Honesty gate (#9): a green "done" with a parsed score requires a CLEAN exit,
        // real output, AND (for evaluations) a report actually written. Anything else
        // is surfaced — an errored run must never be banked as a confident score. The
        // five arms and the reason for each live in run-outcome.mjs, unit-tested
        // beside pdfRunOutcome's suite rather than buried in this transport closure.
        //
        // stderrSnippet only ever reaches the "hit an error before finishing" arm,
        // and only when no structured error already sent its own message: sawError
        // means the CLI was authoritative about the failure, so the heuristic
        // classifier's guess would be noise on top of it.
        const outcome = evaluateRunOutcome({
          noOutputMessage: noOutputError(),
          persists,
          wroteReport,
          cleanExit,
          sawError,
          stderrSnippet: stderrErrorSnippet ?? undefined,
        });
        if (!outcome.ok) {
          send({ type: "error", msg: outcome.message });
        } else {
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        }
        close();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      if (pdfRenderPromise) {
        // Render/mark keeps running after this client disconnects — wait for
        // it to settle before releasing the guard, so a concurrent tracker
        // delete can't race mark-pdf-ready.mjs's still-in-flight write.
        pdfRenderPromise.finally(releaseWriteTokenOnce);
      } else {
        releaseWriteTokenOnce();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
