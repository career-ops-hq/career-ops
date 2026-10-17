import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

const UPLOADS_DIR = () => path.join(careerOpsRoot(), "data", "uploads");
const RESUME_DIR = () => path.join(UPLOADS_DIR(), "resumes");
const PROJECT_DIR = () => path.join(UPLOADS_DIR(), "projects");
const META_FILE = () => path.join(UPLOADS_DIR(), "uploads-meta.json");

export type UploadMeta = {
  id: string;
  filename: string;
  originalName: string;
  category: "resume" | "project";
  description: string;
  dateUploaded: string;
  size: number;
};

function readMeta(): UploadMeta[] {
  try {
    return JSON.parse(fs.readFileSync(META_FILE(), "utf8"));
  } catch {
    return [];
  }
}

function writeMeta(data: UploadMeta[]): void {
  fs.mkdirSync(path.dirname(META_FILE()), { recursive: true });
  fs.writeFileSync(META_FILE(), JSON.stringify(data, null, 2));
}

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".zip": "application/zip",
  ".gz": "application/gzip",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  // No id → return the full metadata list
  if (!id) return NextResponse.json(readMeta());

  // With id → serve the file for download
  const all = readMeta();
  const entry = all.find((u) => u.id === id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const dir = entry.category === "resume" ? RESUME_DIR() : PROJECT_DIR();
  const filePath = path.join(dir, entry.filename);

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return NextResponse.json({ error: "file missing from disk" }, { status: 404 });
  }

  const ext = entry.originalName.toLowerCase().endsWith(".tar.gz")
    ? ".gz"
    : path.extname(entry.originalName.toLowerCase());
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${entry.originalName}"`,
    },
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) ?? "resume";
  const description = (formData.get("description") as string) ?? "";

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (category !== "resume" && category !== "project") {
    return NextResponse.json({ error: "category must be resume or project" }, { status: 400 });
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".md", ".txt", ".zip", ".tar.gz"]);

  const nameLower = file.name.toLowerCase();
  const ext = nameLower.endsWith(".tar.gz") ? ".tar.gz" : path.extname(nameLower);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `file type ${ext} not allowed` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_SIZE) {
    return NextResponse.json({ error: "file exceeds 10 MB limit" }, { status: 400 });
  }

  const dir = category === "resume" ? RESUME_DIR() : PROJECT_DIR();
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID();
  const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const filename = `${id.slice(0, 8)}-${safeBase}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  const meta: UploadMeta = {
    id,
    filename,
    originalName: file.name,
    category,
    description,
    dateUploaded: new Date().toISOString().slice(0, 10),
    size: buffer.length,
  };

  const all = readMeta();
  all.push(meta);
  writeMeta(all);

  // Signal that a resume was uploaded — the tailor panel triggers parsing on demand
  return NextResponse.json({ ...meta, resumeUploaded: category === "resume" }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const all = readMeta();
  const entry = all.find((u) => u.id === id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const dir = entry.category === "resume" ? RESUME_DIR() : PROJECT_DIR();
  try {
    fs.unlinkSync(path.join(dir, entry.filename));
  } catch {
    // file already gone
  }

  writeMeta(all.filter((u) => u.id !== id));
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const id = formData.get("id") as string | null;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const all = readMeta();
  const entry = all.find((u) => u.id === id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const MAX_SIZE = 10 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".md", ".txt", ".zip", ".tar.gz"]);

  const nameLower = file.name.toLowerCase();
  const ext = nameLower.endsWith(".tar.gz") ? ".tar.gz" : path.extname(nameLower);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `file type ${ext} not allowed` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_SIZE) {
    return NextResponse.json({ error: "file exceeds 10 MB limit" }, { status: 400 });
  }

  const dir = entry.category === "resume" ? RESUME_DIR() : PROJECT_DIR();

  // Write new file BEFORE deleting old one — a failed write preserves the old file
  const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const filename = `${id.slice(0, 8)}-${safeBase}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  // Delete old file only after the new one is safely written
  if (entry.filename !== filename) {
    try { fs.unlinkSync(path.join(dir, entry.filename)); } catch { /* already gone */ }
  }

  // Update metadata
  entry.filename = filename;
  entry.originalName = file.name;
  entry.size = buffer.length;
  entry.dateUploaded = new Date().toISOString().slice(0, 10);

  writeMeta(all);
  return NextResponse.json(entry);
}
