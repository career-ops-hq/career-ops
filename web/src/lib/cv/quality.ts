// Client-safe (no node). The readiness check lives in readiness.mjs.

// ── CV ingest stream markers (parallel to the <<act:>>/<<offer:>> envelopes) ──
export type CvSeed = { title?: string; roles?: string[]; location?: string };
export type CvIngestResult = { markdown: string; seed: CvSeed | null; error: string | null; trace: string };

export function cvStreamErrorMessage(reason: string): string {
  if (reason === "unreadable") return "I couldn't read text from that file (it may be a scanned image). Upload the TeX source or paste the text instead.";
  if (reason === "timeout") return "CV conversion timed out. Try again or check your AI CLI in Config.";
  if (["cli-failed", "launch-failed", "no-output"].includes(reason)) return "Your AI CLI couldn't finish converting the CV. Check its sign-in and connection in Config, then try again.";
  return "Couldn't finish converting the CV. Try again or paste the text instead.";
}

/** Parse the full accumulated ingest stream text into its parts. Tolerant: a
 *  still-streaming buffer just yields partial markdown + the pre-start trace. */
export function parseCvStream(buf: string): CvIngestResult {
  const errM = buf.match(/<<cv:error>>\s*(\{[^}]*\})/);
  if (errM) {
    let reason = "unreadable";
    try {
      reason = JSON.parse(errM[1]).reason || reason;
    } catch {
      /* keep default */
    }
    return { markdown: "", seed: null, error: reason, trace: buf.split("<<cv:error>>")[0].trim() };
  }

  const start = buf.indexOf("<<cv:start>>");
  const trace = (start === -1 ? buf : buf.slice(0, start)).replace(/<<cv:[a-z]+>>.*$/s, "").trim();
  if (start === -1) return { markdown: "", seed: null, error: null, trace };

  const afterStart = buf.slice(start + "<<cv:start>>".length);
  const end = afterStart.indexOf("<<cv:end>>");
  const markdown = (end === -1 ? afterStart : afterStart.slice(0, end)).replace(/^\s*\n/, "").trimEnd();

  let seed: CvSeed | null = null;
  const seedM = buf.match(/<<cv:seed>>\s*(\{[\s\S]*?\})/);
  if (seedM) {
    try {
      const j = JSON.parse(seedM[1]);
      seed = {
        title: typeof j.title === "string" ? j.title : undefined,
        roles: Array.isArray(j.roles) ? j.roles.filter((r: unknown): r is string => typeof r === "string").slice(0, 6) : undefined,
        location: typeof j.location === "string" ? j.location : undefined,
      };
    } catch {
      /* malformed seed → ignore */
    }
  }
  return { markdown, seed, error: null, trace };
}
