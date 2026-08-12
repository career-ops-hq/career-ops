import { careerOpsRoot, readInbox } from "@/lib/career-ops";
import { readCareerMasterProfile } from "@/lib/career-profile-store.mjs";
import { readActiveCv } from "@/lib/cv-version-store.mjs";
import {
  analyzeJobText,
  buildProfileEvidence,
  matchAnalysis,
  summarizeAnalysis,
} from "@/lib/job-intelligence.mjs";
import {
  jobIntelligenceId,
  listJobAnalyses,
  saveJobAnalysis,
} from "@/lib/job-intelligence-store.mjs";
import { extractPdfText } from "@/lib/pdf-text.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 60_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

// --- deterministic HTML → text (no dependency, never invents content) ---
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPrivateUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    return false;
  } catch {
    return true;
  }
}

async function fetchUrlText(url: string): Promise<string> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    throw new Error("Ogiltig URL — ange en http(s)-adress.");
  }
  if (isLikelyPrivateUrl(url)) {
    throw new Error("URL:en pekar på ett privat/nätverksinternt mål och kan inte hämtas.");
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
    headers: { "user-agent": "CareerPilot-AI/0.6 (job-intelligence import)" },
  });
  if (!res.ok) throw new Error(`Kunde inte hämta URL:en (HTTP ${res.status}).`);
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) throw new Error("Hämtad fil är för stor (max 10 MB).");
  if (ctype.includes("application/pdf") || url.toLowerCase().includes(".pdf")) {
    return extractPdfText(buf);
  }
  const text = await res.text();
  if (ctype.includes("html") || /<html|<body|<div|<p\b/i.test(text.slice(0, 2000))) {
    return htmlToText(text);
  }
  return text.trim();
}

async function buildEvidence(root: string, answers?: Record<string, string>) {
  const profile = await readCareerMasterProfile(root);
  const cv = await readActiveCv(root);
  return buildProfileEvidence(profile || {}, cv || "", answers);
}

async function runAnalysis(
  root: string,
  sourceText: string,
  meta: { source: string; url: string | null; fileName: string | null; savedRole?: string; savedCompany?: string },
) {
  const analysis = analyzeJobText(sourceText);
  const evidence = await buildEvidence(root);
  const report = matchAnalysis(analysis, evidence);
  const id = jobIntelligenceId(analysis.metadata.jobTitle, meta.url, sourceText);
  const now = new Date().toISOString();
  analysis.analyzedAt = now;
  report.generatedAt = now;
  const summary = summarizeAnalysis(analysis, report, id);
  const record = { id, meta, analysis, report, summary, answers: {}, updatedAt: now };
  await saveJobAnalysis(root, record);
  return record;
}

export async function GET(): Promise<Response> {
  try {
    const root = careerOpsRoot();
    const analyses = await listJobAnalyses(root);
    const savedSources = readInbox().map((job) => ({
      url: job.url,
      company: job.company,
      role: job.role,
      location: job.location || null,
      compensation: job.compensation || null,
      done: job.done,
    }));
    return Response.json({ analyses, savedSources });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Okänt fel" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const source = String(body?.source ?? "text");
    let sourceText = "";
    let meta: { source: string; url: string | null; fileName: string | null; savedRole?: string; savedCompany?: string } = {
      source,
      url: null,
      fileName: null,
    };

    if (source === "text") {
      sourceText = String(body?.text ?? "").trim();
    } else if (source === "url") {
      meta.url = String(body?.url ?? "").trim();
      sourceText = await fetchUrlText(meta.url);
    } else if (source === "pdf") {
      const b64 = String(body?.fileB64 ?? "");
      if (!b64) throw new Error("Ingen PDF-data mottagen.");
      const buf = Buffer.from(b64, "base64");
      if (buf.byteLength > MAX_PDF_BYTES) throw new Error("PDF:en är för stor (max 10 MB).");
      meta.fileName = String(body?.fileName ?? "annons.pdf");
      sourceText = extractPdfText(buf);
    } else if (source === "saved") {
      const url = String(body?.url ?? "").trim();
      const inbox = readInbox();
      const job = inbox.find((j) => j.url === url);
      if (!job) throw new Error("Den sparade tjänsten hittades inte i inkorgen.");
      meta.url = job.url;
      meta.savedRole = job.role;
      meta.savedCompany = job.company;
      sourceText = await fetchUrlText(job.url);
    } else {
      throw new Error(`Okänd importkälla: ${source}`);
    }

    sourceText = sourceText.slice(0, MAX_INPUT_CHARS);
    if (sourceText.trim().length < 40) {
      throw new Error("Annonstexten verkar ofullständig (minst 40 tecken) — kontrollera källan.");
    }

    const record = await runAnalysis(careerOpsRoot(), sourceText, meta);
    return Response.json({ analysis: record });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Okänt fel" }, { status: 400 });
  }
}
