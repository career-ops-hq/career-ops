import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import type { DiscoveredOffer } from "@/lib/explore";
import { collectWhatsNew } from "@/lib/whats-new.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The SUPPLY loop, ZERO tokens: "new matches this week" = roles surfaced by past
// free scans (data/scan-history.tsv) in the last N days that the user hasn't
// evaluated yet. No scan runs here — it reads the history a past scan already
// wrote, so the home stays instant + free (directly answers the #1 token-cost
// complaint). cols: url, first_seen, portal, title, company, status, location.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 7));
  // Home only needs enough offers for its cards. Explore's explicit “See all”
  // hand-off opts into the complete list, while `count` is always complete.
  const offerLimit = searchParams.get("limit") === "all" ? Number.POSITIVE_INFINITY : 24;
  const cutoff = Date.now() - days * 86_400_000;
  let rows: string[];
  try {
    rows = fs.readFileSync(path.join(careerOpsRoot(), "data", "scan-history.tsv"), "utf8").split("\n");
  } catch {
    return Response.json({ offers: [], count: 0 });
  }

  // Companies already evaluated → don't resurface as "new".
  const evaluated = new Set(readApplications().map((a) => norm(a.company)).filter(Boolean));

  const toOffer = (c: string[]): DiscoveredOffer | null => {
    const [url, firstSeen, portal, title, company, status, location] = c;
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (status && /skipped|expired/i.test(status)) return null;
    if (company && evaluated.has(norm(company))) return null;
    return {
      url,
      company: (company || "").trim(),
      title: (title || "").trim(),
      location: (location || "").trim(),
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(firstSeen || "") ? firstSeen : "",
      ats: (portal || "").replace(/-full$/, "").trim() || "other",
      source: "whats-new",
    };
  };

  const { offers, count } = collectWhatsNew(rows, { cutoff, toOffer, offerLimit });
  return Response.json({ offers, count });
}
