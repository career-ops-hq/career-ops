import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, readApplications, rootScript, type Application } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

/**
 * The Internship type is a VIEW over Application rows in data/applications.md.
 * Extended fields (track, source, etc.) are encoded in the Notes column as
 * pipe-delimited tags: "track:DS | source:simplify-github | Posted: 3d ago"
 */
export type Internship = {
  id: string;        // maps to Application.n
  company: string;
  role: string;
  location: string;
  status: string;    // canonical states from states.yml
  dateAdded: string; // Application.date
  url?: string;      // Application.applyLink
  notes: string;
  score?: string;
  // Extended fields parsed from Notes tags
  track?: string;
  source?: string;
  requirements?: string;
  deadline?: string;
  workAuth?: string;
  gradEligibility?: string;
};

/** Status mapping: internship UI statuses → canonical tracker states */
const STATUS_TO_CANONICAL: Record<string, string> = {
  wishlist: "Evaluated",
  applied: "Applied",
  interviewing: "Interview",
  offered: "Offer",
  rejected: "Rejected",
  accepted: "Hired",
  closed: "Discarded",
  not_posted: "SKIP",
  unknown: "Evaluated",
};

/** Reverse mapping: canonical tracker states → internship UI statuses */
const CANONICAL_TO_STATUS: Record<string, string> = {
  Evaluated: "wishlist",
  Applied: "applied",
  Responded: "applied",
  Interview: "interviewing",
  Offer: "offered",
  Hired: "accepted",
  Rejected: "rejected",
  Discarded: "closed",
  SKIP: "not_posted",
};

/** Parse extended fields from the Notes column. Tags are "key:value" separated by " | ". */
function parseNoteTags(notes: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const parts = notes.split(" | ");
  const plainParts: string[] = [];
  for (const part of parts) {
    const m = part.match(/^(\w+):(.+)$/);
    if (m) {
      tags[m[1]] = m[2].trim();
    } else {
      plainParts.push(part);
    }
  }
  tags._plain = plainParts.join(" | ");
  return tags;
}

/** Encode extended fields back into Notes tags. */
function encodeNoteTags(fields: Record<string, string | undefined>, plainNotes: string): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val) parts.push(`${key}:${val}`);
  }
  if (plainNotes) parts.push(plainNotes);
  return parts.join(" | ");
}

/** Convert an Application row to an Internship view. */
export function appToInternship(app: Application): Internship {
  const tags = parseNoteTags(app.notes);
  return {
    id: app.n,
    company: app.company,
    role: app.role,
    location: app.location,
    status: CANONICAL_TO_STATUS[app.status] ?? "unknown",
    dateAdded: app.date,
    url: app.applyLink || undefined,
    notes: tags._plain || "",
    score: app.score || undefined,
    track: tags.track,
    source: tags.source,
    requirements: tags.requirements,
    deadline: tags.deadline,
    workAuth: tags.workAuth,
    gradEligibility: tags.gradEligibility,
  };
}

// GET: return all internships (optionally filtered by source)
export async function GET(req: NextRequest) {
  const apps = readApplications();
  const { searchParams } = new URL(req.url);
  const sourceFilter = searchParams.get("source");

  let internships = apps.map(appToInternship);
  if (sourceFilter) {
    internships = internships.filter((i) => i.source === sourceFilter);
  }
  return NextResponse.json(internships);
}

// POST: add a new internship by writing a TSV and running merge-tracker
export async function POST(req: NextRequest) {
  let body: Record<string, string | undefined>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const company = body.company ?? "";
  const role = body.role ?? "";
  if (!company || !role) {
    return NextResponse.json({ error: "company and role required" }, { status: 400 });
  }

  // Dedup: check if company+role already exists
  const apps = readApplications();
  const normC = company.toLowerCase();
  const normR = role.toLowerCase();
  const existing = apps.find(
    (a) => a.company.toLowerCase() === normC && a.role.toLowerCase() === normR,
  );
  if (existing) {
    return NextResponse.json(appToInternship(existing), { status: 200 });
  }

  const status = STATUS_TO_CANONICAL[body.status ?? "wishlist"] ?? "Evaluated";
  const date = body.dateAdded ?? new Date().toISOString().slice(0, 10);

  // Encode extended fields in notes
  const noteTags = encodeNoteTags(
    {
      track: body.track,
      source: body.source,
      requirements: body.requirements,
      deadline: body.deadline,
      workAuth: body.workAuth,
      gradEligibility: body.gradEligibility,
    },
    body.notes ?? "",
  );

  // Reserve a report number for the new row
  const root = careerOpsRoot();
  let num: string;
  try {
    num = execFileSync(process.execPath, [rootScript("reserve-report-num"), "--count", "1"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
    }).trim().split("-")[0];
  } catch {
    // Fallback: find max # from existing apps + 1
    const maxN = apps.reduce((m, a) => Math.max(m, parseInt(a.n) || 0), 0);
    num = String(maxN + 1);
  }

  // Write TSV with header
  const tsvDir = path.join(root, "batch", "tracker-additions");
  fs.mkdirSync(tsvDir, { recursive: true });
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  const tsvFile = path.join(tsvDir, `${num.padStart(3, "0")}-${slug}.tsv`);
  const header = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";
  const row = [
    num,
    date,
    company,
    role,
    status,
    body.score ?? "N/A",
    "❌",
    "—",
    noteTags,
    body.url ?? "",
  ].join("\t");
  fs.writeFileSync(tsvFile, `${header}\n${row}\n`);

  // Run merge-tracker
  try {
    execFileSync(process.execPath, [rootScript("merge-tracker")], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  } catch (err) {
    // Clean up TSV on merge failure
    try { fs.unlinkSync(tsvFile); } catch { /* ignore */ }
    return NextResponse.json(
      { error: `merge failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Read back the merged result
  const updated = readApplications();
  const added = updated.find(
    (a) => a.company.toLowerCase() === normC && a.role.toLowerCase() === normR,
  );
  return NextResponse.json(added ? appToInternship(added) : { id: num, company, role, status: body.status ?? "wishlist" }, { status: 201 });
}

// PUT: update status via set-status.mjs
export async function PUT(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const id = body.id; // tracker row #
  const newStatus = body.status;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (newStatus) {
    const canonStatus = STATUS_TO_CANONICAL[newStatus] ?? newStatus;
    try {
      execFileSync(process.execPath, [
        rootScript("set-status"),
        "--row", id,
        canonStatus,
        "--source", "web",
        "--json",
      ], {
        cwd: careerOpsRoot(),
        encoding: "utf8",
        timeout: 30000,
      });
    } catch (err) {
      return NextResponse.json(
        { error: `status update failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  }

  // Read back updated row
  const apps = readApplications();
  const app = apps.find((a) => a.n === id);
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(appToInternship(app));
}

// DELETE: delegate to tracker.mjs delete
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    execFileSync(process.execPath, [
      rootScript("tracker"),
      "delete",
      "--num", id,
    ], {
      cwd: careerOpsRoot(),
      encoding: "utf8",
      timeout: 30000,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `delete failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
