// Client-safe (NO node imports) tolerant streaming parser for the AI-search
// `<<offer:{...}>>` envelopes emitted by modes/discover.md. Modeled on the
// assistant console's <<act:>> envelope parsing, factored out so the grammar
// can't drift. The load-bearing requirement: an envelope (or its opener) split
// across stream chunk boundaries must BUFFER, never flush as garbage or drop.

import type { DiscoveredOffer } from "./explore";

const OPEN = "<<offer:";
const CLOSE = ">>";

export type AiTraceChunk =
  | { kind: "offer"; offer: DiscoveredOffer }
  | { kind: "narration"; text: string }
  | { kind: "malformed"; raw: string };

/** Normalize a URL for dedup: host+path, lowercased, no query/fragment/trailing slash. */
export function canon(u: string): string {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).toLowerCase().replace(/\/$/, "");
  } catch {
    return u.toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function toOffer(raw: unknown): DiscoveredOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const conf = o.confidence;
  return {
    url,
    company: str(o.company),
    title: str(o.title),
    location: str(o.location),
    postedAt: "", // AI gives only a human postedHint, never a trustworthy date
    ats: str(o.ats) || "other",
    source: "ai-search",
    verification: "unconfirmed",
    why: str(o.why) || undefined,
    postedHint: str(o.postedHint) || undefined,
    confidence: conf === "low" || conf === "medium" || conf === "high" ? conf : undefined,
  };
}

export function makeAiStreamParser(opts?: { knownUrls?: Set<string> }) {
  const known = opts?.knownUrls ?? new Set<string>();
  const seen = new Set<string>();
  let buf = "";

  return {
    feed(delta: string): AiTraceChunk[] {
      buf += delta;
      const out: AiTraceChunk[] = [];
      for (;;) {
        const open = buf.indexOf(OPEN);
        if (open === -1) {
          // No opener in view. Flush as narration — but hold back a short tail
          // that could be the start of a split opener ("<<offe…").
          const keep = OPEN.length - 1;
          if (buf.length > keep) {
            const tail = buf.slice(buf.length - keep);
            if (OPEN.startsWith(tail)) {
              const text = buf.slice(0, buf.length - keep);
              if (text.trim()) out.push({ kind: "narration", text });
              buf = tail;
            } else {
              if (buf.trim()) out.push({ kind: "narration", text: buf });
              buf = "";
            }
          }
          break;
        }
        const before = buf.slice(0, open);
        if (before.trim()) out.push({ kind: "narration", text: before });
        const close = buf.indexOf(CLOSE, open + OPEN.length);
        if (close === -1) {
          // Envelope still streaming — keep from the opener onward and wait.
          buf = buf.slice(open);
          break;
        }
        const json = buf.slice(open + OPEN.length, close);
        buf = buf.slice(close + CLOSE.length);
        let offer: DiscoveredOffer | null = null;
        try {
          offer = toOffer(JSON.parse(json));
        } catch {
          offer = null;
        }
        if (!offer) {
          out.push({ kind: "malformed", raw: json.slice(0, 120) });
          continue;
        }
        const key = canon(offer.url);
        if (seen.has(key) || known.has(key)) continue; // intra-run + known dedup
        seen.add(key);
        out.push({ kind: "offer", offer });
      }
      return out;
    },
    /** Emit any trailing buffered narration when the stream ends. */
    flush(): AiTraceChunk[] {
      const text = buf;
      buf = "";
      return text.trim() ? [{ kind: "narration" as const, text }] : [];
    },
  };
}
