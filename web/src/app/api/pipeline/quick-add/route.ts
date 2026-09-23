import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { addOffersToPipeline } from "@/lib/core/pipeline";
import type { DiscoveredOffer } from "@/lib/explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quick-add a PASTED JD (raw text, no public URL) to the pipeline — the web-UI
// twin of modes/scan.md's "Private URLs" convention: save the text under jds/,
// then reference it as local:jds/{file}.md everywhere else in the system
// (pipeline.md, the evaluate worker in /api/run) already knows how to read.
// A pasted URL doesn't need this route at all — the client posts straight to
// /api/explore/add for that case.
function slugify(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `pasted-${words || "jd"}-${stamp}`.slice(0, 80);
}

export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ added: 0, error: "bad request" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) return Response.json({ added: 0, error: "no JD text given" }, { status: 400 });

  const jdsDir = path.join(careerOpsRoot(), "jds");
  fs.mkdirSync(jdsDir, { recursive: true });
  const slug = slugify(text);
  const relRef = `jds/${slug}.md`;
  fs.writeFileSync(path.join(jdsDir, `${slug}.md`), text, "utf-8");

  const offer: DiscoveredOffer = {
    url: `local:${relRef}`,
    company: "",
    title: "",
    location: "",
    postedAt: "",
    ats: "manual",
    source: "manual-paste",
  };
  const result = await addOffersToPipeline([offer]);
  return Response.json({ ...result, localRef: `local:${relRef}` });
}
