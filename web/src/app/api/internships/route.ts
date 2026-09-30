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

function readInternships(): Internship[] {
  try {
    const raw = fs.readFileSync(INTERNSHIPS_FILE(), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeInternships(data: Internship[]): void {
  const dir = path.dirname(INTERNSHIPS_FILE());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INTERNSHIPS_FILE(), JSON.stringify(data, null, 2));
}

export async function GET() {
  return NextResponse.json(readInternships());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const internships = readInternships();

  const newEntry: Internship = {
    id: crypto.randomUUID(),
    company: body.company ?? "",
    role: body.role ?? "",
    location: body.location ?? "",
    status: body.status ?? "wishlist",
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

  const internships = readInternships();
  const idx = internships.findIndex((i) => i.id === body.id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });

  internships[idx] = { ...internships[idx], ...body };
  writeInternships(internships);
  return NextResponse.json(internships[idx]);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let internships = readInternships();
  internships = internships.filter((i) => i.id !== id);
  writeInternships(internships);
  return NextResponse.json({ ok: true });
}
