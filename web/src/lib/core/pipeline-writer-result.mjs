// Reads the answer of the short-lived "Add to pipeline" writer child spawned by
// pipeline.ts. Kept as a plain .mjs so a `node --test` can load it (the web
// suite cannot import pipeline.ts, which uses the `@/` alias).
//
// The child prints exactly one JSON line, `{ added, error? }`, from inside its
// own try/catch. A child that never gets that far (scan.mjs failed to import,
// the process was killed, out of memory) prints nothing on stdout, and that
// must read as a failure: an empty answer once parsed as `{}`, i.e. "added 0,
// no error", which the UI cannot tell from "nothing new to add".

/**
 * @param {string} stdout
 * @param {string} stderr
 * @param {{ code: number | null, signal: string | null }} exit
 * @returns {{ added: number, error?: string }}
 */
export function pipelineWriterResult(stdout, stderr, exit) {
  const last = String(stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
  if (last) {
    try {
      const parsed = JSON.parse(last);
      if (parsed && typeof parsed === "object" && typeof parsed.added === "number") {
        return parsed.error ? { added: parsed.added, error: String(parsed.error) } : { added: parsed.added };
      }
    } catch {
      // Not the writer's answer; fall through to the exit status.
    }
  }
  // Node ends a crash with its version banner, which says nothing about why.
  const said = String(stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Node\.js v\d/.test(l));
  const why = said.find((l) => /^\w*Error\b/.test(l)) ?? said.pop();
  const how = exit?.signal ? `killed by ${exit.signal}` : exit?.code ? `exit code ${exit.code}` : "no result";
  return { added: 0, error: `pipeline writer failed (${how})${why ? `: ${why.slice(0, 200)}` : ""}` };
}
