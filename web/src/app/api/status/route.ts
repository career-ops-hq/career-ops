import fs from "node:fs";
import { rootScript } from "@/lib/career-ops";
import { runSetStatus } from "@/lib/core-cli";
import { canonicalizeStatus } from "@/lib/core/states";
import { parseCliJson, trackerRowArg, clientErrorMessage } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs"; // delegates to the core CLI via child_process

// Writeback: UPDATE the status cell of an EXISTING tracker row only. Never adds
// rows — per the core data contract, new rows go through the TSV + merge flow.
//
// This route used to read data/applications.md, rewrite the Status cell in
// memory and atomically write the file back. It was the only tracker writer
// that took no lock: atomicWrite is atomic about the *file*, not about the
// read-modify-write around it, so a change committed by merge-tracker.mjs or
// set-status.mjs between the read and the write was silently overwritten by a
// copy of the tracker that predated it (#2900).
//
// So it delegates. set-status.mjs is the path every other writer already uses:
// it holds the shared tracker lock across the whole read-modify-write,
// validates the state against templates/states.yml, and appends the transition
// ledger. Routing through it closes the race, drops this file's duplicate
// Status-column detection, and produces the ledger row as a consequence of the
// write rather than as a second writer racing beside it. `--source web` keeps
// rows written from here distinguishable in the ledger.
//
// What stays here is the HTTP contract: reject a bad request before spawning
// anything, and map the CLI's exit codes onto status codes.

// set-status.mjs exit codes (CLI_EXIT in tracker-utils.mjs) → HTTP.
// 4 means another writer holds the tracker lock: transient, so the caller should
// retry rather than treat the change as rejected.
const EXIT_TO_HTTP: Record<number, number> = { 2: 404, 3: 409, 4: 503 };

// Exit 1 is the CLI's catch-all, and only part of it is the caller's fault.
// `usage` and `invalid-state` describe a bad request; `states-error` (unreadable
// templates/states.yml), `write-failure`, `no-notes-column` and `lock-error`
// describe a broken checkout or filesystem on this machine. Blaming the caller
// for those sends someone to re-check a request that was fine.
//
// Allow-list rather than deny-list on purpose: an exit-1 code this route has
// never seen — including a crash that printed no JSON at all — is far more
// likely to be ours than theirs, so the unknown case should read 500.
const CLIENT_ERROR_CODES = new Set(["usage", "invalid-state", "undo-unknown-prior"]);

// --json puts a single JSON object on stdout on both the success and the error
// path. Anything printed before it (a ledger-append warning, say) is not part
// of the document, and can contain a brace of its own — so status-cli.mjs reads
// the document from the end rather than from the first `{`.

export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; status?: string; undo?: boolean }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const { n, status } = body;
  // {n, undo: true} takes back the row's last logged change (set-status.mjs
  // --undo). The CLI picks the status to restore, so there is none to check.
  if (body.undo === true) return writeStatus(n, null);
  if (!n || typeof status !== "string" || !status.trim()) {
    return Response.json({ error: "n and status required" }, { status: 400 });
  }
  // Rejected here rather than left to the CLI: these characters would break the
  // markdown row, and refusing them before spawning keeps the failure cheap and
  // the message specific.
  if (/[|\r\n*]/.test(status)) {
    return Response.json({ error: "invalid status (table-breaking characters)" }, { status: 400 });
  }
  // Resolving aliases here lets the response echo the canonical label without
  // waiting on the CLI, and costs no process spawn for an unknown state.
  // set-status.mjs validates again against states.yml — this is a fast path,
  // not the authority.
  const canon = canonicalizeStatus(status);
  if (!canon) {
    return Response.json({ error: `not a canonical status: ${status}` }, { status: 400 });
  }
  return writeStatus(n, canon);
}

async function writeStatus(n: unknown, canon: string | null) {
  // Same reason the status is checked above: answer a bad request before paying
  // for a process spawn and a tracker lock. `n` is typed as a string but arrives
  // from untrusted JSON, so it can be an array or an object, and `String(n)`
  // would send "[object Object]" to --row and return the CLI's usage text.
  const row = trackerRowArg(n);
  if (!row) {
    return Response.json({ error: "n must be a tracker row number" }, { status: 400 });
  }

  // The web can run against a CAREER_OPS_ROOT that holds data and no scripts.
  // Delegation needs a defined answer there, and "spawn it and see" is not one:
  // the child's failure is a Node module-resolution stack trace, which is both
  // useless to the caller and an absolute-path disclosure if echoed. Same
  // existsSync feature-detection /api/followups already uses.
  const script = rootScript("set-status");
  if (!fs.existsSync(script)) {
    return Response.json(
      {
        error: "status updates need the career-ops scripts; this root has data only",
        code: "core-script-missing",
      },
      { status: 503 },
    );
  }

  // --row: `n` is the tracker's # column, the same key this route has always
  // matched on. It is NOT a report number — the two counters diverge
  // permanently — so naming the number space is required, not cosmetic.
  // --detach-jd-archive: a move into Interview may start a JD archive that can
  // run past this request's 30s budget. Waiting for it turned a saved status
  // into a 504, and this route never reads the archive's outcome anyway.
  const { code, stdout, stderr, spawnFailed, timedOut } = await runSetStatus([
    "--row",
    row,
    canon ?? "--undo",
    "--source",
    "web",
    "--detach-jd-archive",
    "--json",
  ]);
  const parsed = parseCliJson(stdout);

  if (spawnFailed) {
    // Child stderr is a Node stack trace carrying absolute server paths. It
    // belongs in the server log, never in the response body.
    console.error(`/api/status: set-status.mjs failed to run: ${stderr.trim()}`);
    return Response.json({ error: "status update failed to run" }, { status: 500 });
  }

  // Killed by our own timeout. The child gets a shorter lock wait than this, so
  // reaching here means it was stuck on something other than lock contention.
  // Whether the tracker was written is genuinely unknown — say so rather than
  // implying the change was rejected.
  if (timedOut) {
    return Response.json(
      { error: "status update timed out; the change may or may not have been applied" },
      { status: 504, headers: { "Retry-After": "5" } },
    );
  }

  if (code !== 0) {
    const cliCode = typeof parsed?.code === "string" ? parsed.code : undefined;
    const httpStatus =
      code === 1
        ? (cliCode && CLIENT_ERROR_CODES.has(cliCode) ? 400 : 500)
        : (EXIT_TO_HTTP[code] ?? 500);
    // Child stderr is logged, never echoed: on this path it is most likely a
    // Node stack trace carrying absolute server paths, the same content the
    // spawn-failure branch above already keeps out of the response body.
    if (!parsed && stderr.trim()) {
      console.error(`/api/status: set-status.mjs exited ${code} without JSON: ${stderr.trim()}`);
    }
    const error = clientErrorMessage(parsed, stderr);
    return Response.json(
      { error, ...(cliCode ? { code: cliCode } : {}) },
      {
        status: httpStatus,
        ...(httpStatus === 503 ? { headers: { "Retry-After": "5" } } : {}),
      },
    );
  }

  if (!parsed) {
    return Response.json({ error: "status update returned no result" }, { status: 500 });
  }

  // Response shape is unchanged for existing callers; `changed` and
  // `statusLogged` are additive.
  return Response.json({
    ok: true,
    status: canon ?? parsed.newStatus,
    changed: parsed.changed === true,
    statusLogged: parsed.statusLogged === true,
  });
}
