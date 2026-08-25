// Client-safe (no node). Deterministic "is this CV good enough to score?" signal —
// ZERO tokens. Advisory only: it drives a green-check vs amber hint, NEVER blocks
// saving (the minimal-CV principle: even a rough parse is enough for a first score).

export type CvReadiness = { scoreable: boolean; words: number; hasExperience: boolean; hasSkills: boolean; hint?: string };

export function cvReadiness(md: string): CvReadiness {
  const text = (md || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const hasExperience = /(^|\n)#{1,3}\s*(experience|work|employment|empleo|experiencia)/i.test(text) || /\b(20\d\d)\s*[-–—]\s*(20\d\d|present|now|actualidad)/i.test(text);
  const hasSkills = /(^|\n)#{1,3}\s*(skills|technologies|competenc|habilidad)/i.test(text);
  const scoreable = words >= 80 && (hasExperience || hasSkills || words >= 200);
  let hint: string | undefined;
  if (!scoreable) hint = words < 40 ? "That's very short — add your experience for real matches (you can save anyway)." : "Looks thin — add a role or two for better matches (you can save anyway).";
  return { scoreable, words, hasExperience, hasSkills, hint };
}

// ── CV ingest stream markers (parallel to the <<act:>>/<<offer:>> envelopes) ──
export type CvSeed = { title?: string; roles?: string[]; location?: string };
export type CvIngestResult = { markdown: string; seed: CvSeed | null; error: string | null; trace: string };

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
