import { spawn } from "node:child_process";
import path from "node:path";
import { employerRequest, employerOutcome } from "../employer-preset.mjs";

export function runEmployerWorker(
  id,
  request,
  { codeRoot, signal, timeoutMs = 60_000 },
) {
  return new Promise((resolve) => {
    const worker = path.join(
      /* turbopackIgnore: true */ codeRoot,
      "web",
      "src",
      "lib",
      "core",
      "employer-source.mjs",
    );
    const child = spawn(process.execPath, [worker, "--worker", codeRoot, id], {
      cwd: codeRoot,
      stdio: ["pipe", "pipe", "pipe"],
      // windowsHide: see api/doctor/route.ts — a stale inherited console kills
      // every child with 0xC0000142 on Windows; never inherit one.
      windowsHide: true,
    });
    let output = "";
    let warnings = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const stop = (reason) => {
      child.kill("SIGKILL");
      finish({ id, state: "failed", reason, offers: [] });
    };
    const abort = () => stop("scan interrupted");
    const timer = setTimeout(() => stop("source timed out"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
    child.stdout.on("data", (data) => {
      output += data;
      if (output.length > 16_000_000)
        stop("source response exceeded size limit");
    });
    child.stderr.on("data", (data) => {
      warnings = (warnings + data).slice(-4000);
    });
    child.on("error", () =>
      finish({
        id,
        state: "failed",
        reason: "source could not start",
        offers: [],
      }),
    );
    child.on("close", (code) => {
      try {
        const result = JSON.parse(output);
        if (
          result.id !== id ||
          !Array.isArray(result.offers) ||
          !["complete", "incomplete", "failed"].includes(result.state)
        )
          throw new Error("invalid result");
        if (
          (code !== 0 || /⚠|truncated|failed/i.test(warnings)) &&
          result.state === "complete"
        ) {
          result.state = "incomplete";
          result.reason = "source stopped early";
        }
        finish(result);
      } catch {
        finish({
          id,
          state: "failed",
          reason: "source returned no readable result",
          offers: [],
        });
      }
    });
  });
}

export async function runEmployerDiscovery(
  raw,
  {
    codeRoot,
    signal,
    onEvent,
    runSource = runEmployerWorker,
    timeoutMs = 60_000,
  },
) {
  const request = employerRequest(raw);
  const results = await Promise.all(
    request.employers.map(async (id) => {
      onEvent({ kind: "atsStart", ats: id, companies: 1 });
      let result;
      try {
        result = await runSource(id, request, { codeRoot, signal, timeoutMs });
      } catch {
        result = { id, state: "failed", reason: "source failed", offers: [] };
      }
      for (const offer of result.offers) onEvent({ kind: "offer", offer });
      onEvent({
        kind: "atsDone",
        ats: id,
        unreachable: result.state === "complete" ? 0 : 1,
      });
      return result;
    }),
  );
  const offers = results.flatMap((r) => r.offers);
  const sources = results.map(({ id, state, reason }) => ({
    id,
    state,
    reason,
  }));
  const outcome = employerOutcome(sources, offers.length);
  onEvent({
    kind: "summary",
    companiesScanned: results.filter((r) => r.state !== "failed").length,
    matches: offers.length,
    unreachable: sources.filter((s) => s.state !== "complete").length,
    incomplete: sources.filter((s) => s.state !== "complete").map((s) => s.id),
    employerOutcome: outcome,
    employerSources: sources,
  });
  if (outcome.state === "failed")
    onEvent({ kind: "error", message: outcome.message });
  return offers;
}
