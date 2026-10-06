import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import type { Internship } from "../route";

export const dynamic = "force-dynamic";

const INTERNSHIPS_FILE = () => path.join(careerOpsRoot(), "data", "internships.json");

type CsvRow = Record<string, string>;

function mapStatus(raw: string): Internship["status"] {
  const s = raw.trim().toLowerCase();
  if (s === "open" || s === "rolling") return "wishlist";
  if (s === "applied") return "applied";
  if (s === "interviewing" || s === "interview") return "interviewing";
  if (s === "offered" || s === "offer") return "offered";
  if (s === "accepted") return "accepted";
  if (s === "rejected") return "rejected";
  if (s === "closed") return "closed";
  if (s === "not yet posted") return "not_posted";
  return "unknown";
}

function parseCSV(text: string): CsvRow[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Parse header — handle quoted fields
  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const csv = body.csv as string;
  if (!csv) return NextResponse.json({ error: "csv field required" }, { status: 400 });

  const rows = parseCSV(csv);
  if (rows.length === 0) return NextResponse.json({ error: "no data rows found" }, { status: 400 });

  // Read existing to dedup by company+role
  let existing: Internship[] = [];
  const file = INTERNSHIPS_FILE();
  try {
    fs.accessSync(file);
  } catch {
    // no file yet — valid empty state
  }
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return NextResponse.json({ error: "data file is corrupt, fix or delete data/internships.json before importing" }, { status: 500 });
    }
  }
  const existingKeys = new Set(existing.map((i) => `${i.company.toLowerCase()}|${i.role.toLowerCase()}`));

  const imported: Internship[] = [];
  let skipped = 0;

  for (const row of rows) {
    const company = row["Company"] ?? "";
    const role = row["Role Title"] ?? "";
    if (!company || !role) continue;

    const key = `${company.toLowerCase()}|${role.toLowerCase()}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    existingKeys.add(key);

    const entry: Internship = {
      id: crypto.randomUUID(),
      company,
      role,
      location: row["Locations"] ?? "",
      status: mapStatus(row["Status"] ?? ""),
      dateAdded: row["Last Verified"] || new Date().toISOString().slice(0, 10),
      dateApplied: row["App Date"] || undefined,
      deadline: row["Deadline"] || undefined,
      url: undefined,
      notes: row["My Notes"] ?? "",
      track: row["Track"] || undefined,
      term: row["Term"] || undefined,
      opened: row["Opened"] || undefined,
      dateConfidence: row["Date Confidence"] || undefined,
      gradEligibility: row["Grad Year Eligibility"] || undefined,
      workAuth: row["Work Auth / Sponsorship"] || undefined,
      requirements: row["Key Requirements"] || undefined,
      priority: row["Priority"] || undefined,
      source: row["Source"] || undefined,
      lastVerified: row["Last Verified"] || undefined,
      statusLog: [],
    };

    imported.push(entry);
  }

  const merged = [...existing, ...imported];
  const dir = path.dirname(INTERNSHIPS_FILE());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INTERNSHIPS_FILE(), JSON.stringify(merged, null, 2));

  return NextResponse.json({
    imported: imported.length,
    skipped,
    total: merged.length,
  });
}
