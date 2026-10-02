import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

const INTERNSHIPS_FILE = () => path.join(careerOpsRoot(), "data", "internships.json");

export type Internship = {
  id: string;
  company: string;
  role: string;
  location: string;
  status: "wishlist" | "applied" | "interviewing" | "offered" | "rejected" | "accepted";
  dateAdded: string;
  dateApplied?: string;
  deadline?: string;
  url?: string;
  notes: string;
  resumeFile?: string; // filename in data/internship-resumes/
  score?: string;
};

const VALID_STATUSES = new Set<Internship["status"]>(["wishlist", "applied", "interviewing", "offered", "rejected", "accepted"]);

const WRITABLE_FIELDS = new Set([
  "company", "role", "location", "status", "dateApplied",
  "deadline", "url", "notes", "resumeFile", "score",
]);

function readInternships(): { data: Internship[]; error?: string } {
  const file = INTERNSHIPS_FILE();
  try {
    fs.accessSync(file);
  } catch {
    return { data: [] }; // file doesn't exist yet — valid empty state
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { data: JSON.parse(raw) };
  } catch {
    return { data: [], error: "corrupt" };
  }
}

function writeInternships(data: Internship[]): void {
  const dir = path.dirname(INTERNSHIPS_FILE());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INTERNSHIPS_FILE(), JSON.stringify(data, null, 2));
}

export async function GET() {
  const { data, error } = readInternships();
  if (error) return NextResponse.json({ error: "data file is corrupt, please fix or delete data/internships.json" }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data: internships, error } = readInternships();
  if (error) return NextResponse.json({ error: "data file is corrupt" }, { status: 500 });

  const status = body.status ?? "wishlist";
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
  }

  const newEntry: Internship = {
    id: crypto.randomUUID(),
    company: body.company ?? "",
    role: body.role ?? "",
    location: body.location ?? "",
    status,
    dateAdded: new Date().toISOString().slice(0, 10),
    dateApplied: body.dateApplied,
    deadline: body.deadline,
    url: body.url,
    notes: body.notes ?? "",
    resumeFile: body.resumeFile,
    score: body.score,
  };

  internships.push(newEntry);
  writeInternships(internships);
  return NextResponse.json(newEntry, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (body.status && !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 });
  }

  const { data: internships, error } = readInternships();
  if (error) return NextResponse.json({ error: "data file is corrupt" }, { status: 500 });

  const idx = internships.findIndex((i) => i.id === body.id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Only allow known fields to be updated, never overwrite id or dateAdded
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (WRITABLE_FIELDS.has(key)) updates[key] = body[key];
  }

  internships[idx] = { ...internships[idx], ...updates };
  writeInternships(internships);
  return NextResponse.json(internships[idx]);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: internships, error } = readInternships();
  if (error) return NextResponse.json({ error: "data file is corrupt" }, { status: 500 });

  writeInternships(internships.filter((i) => i.id !== id));
  return NextResponse.json({ ok: true });
}
