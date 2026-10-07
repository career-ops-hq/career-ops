import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import type { Internship } from "../route";

export const dynamic = "force-dynamic";

const INTERNSHIPS_FILE = () =>
  path.join(careerOpsRoot(), "data", "internships.json");

type CsvRow = Record<string, string>;

/** Normalize a header label for flexible matching. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[_\- ]+/g, "");
}

/**
 * Look up a value from a row trying multiple header variants.
 * `keyMap` maps normalized names to the original header strings used in the row.
 */
function pick(
  row: CsvRow,
  keyMap: Record<string, string>,
  ...variants: string[]
): string {
  for (const v of variants) {
    const original = keyMap[norm(v)];
    if (original !== undefined) {
      const val = row[original];
      if (val !== undefined) return val;
    }
  }
  return "";
}

/** Map Simplify status strings to internship tracker statuses. */
function mapStatus(raw: string): Internship["status"] {
  const s = raw.trim().toLowerCase();
  if (["saved", "bookmarked", "interested"].includes(s)) return "wishlist";
  if (["applied", "submitted"].includes(s)) return "applied";
  if (["interview", "interviewing", "phone screen", "on-site"].includes(s))
    return "interviewing";
  if (["offer", "offered"].includes(s)) return "offered";
  if (s === "accepted") return "accepted";
  if (["rejected", "declined", "not selected"].includes(s)) return "rejected";
  if (["archived", "withdrawn", "closed"].includes(s)) return "closed";
  return "unknown";
}

/** Parse CSV text handling quoted fields with commas and escaped quotes. */
function parseCSV(text: string): { rows: CsvRow[]; keyMap: Record<string, string> } {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], keyMap: {} };

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

  const rawHeaders = parseRow(lines[0]);

  // Build normalized-key -> original-header lookup for flexible column matching
  const keyMap: Record<string, string> = {};
  for (const h of rawHeaders) {
    keyMap[norm(h)] = h;
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < rawHeaders.length; j++) {
      row[rawHeaders[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return { rows, keyMap };
}

/** Try to parse a date string into YYYY-MM-DD. Returns undefined on failure. */
function parseDate(raw: string): string | undefined {
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const csv = body.csv as string;
  if (!csv)
    return NextResponse.json({ error: "csv field required" }, { status: 400 });

  const { rows, keyMap } = parseCSV(csv);
  if (rows.length === 0)
    return NextResponse.json(
      { error: "no data rows found" },
      { status: 400 },
    );

  const p = (row: CsvRow, ...variants: string[]) =>
    pick(row, keyMap, ...variants);

  // Read existing internships for dedup
  let existing: Internship[] = [];
  const file = INTERNSHIPS_FILE();
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return NextResponse.json(
        {
          error:
            "data file is corrupt, fix or delete data/internships.json before importing",
        },
        { status: 500 },
      );
    }
  }

  const existingKeys = new Set(
    existing.map((i) => `${i.company.toLowerCase()}|${i.role.toLowerCase()}`),
  );

  const today = new Date().toISOString().slice(0, 10);
  const imported: Internship[] = [];
  let skipped = 0;

  for (const row of rows) {
    const company = p(row, "Company Name", "Company");
    const role = p(row, "Job Title", "Position", "Role", "Title");
    if (!company || !role) continue;

    const key = `${company.toLowerCase()}|${role.toLowerCase()}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    existingKeys.add(key);

    const rawStatus = p(row, "Status");
    const rawDateApplied = p(
      row,
      "Date Applied",
      "Applied Date",
      "Application Date",
    );
    const location = p(row, "Location", "City", "Region");
    const url = p(row, "URL", "Job URL", "Link", "Apply URL", "Application URL");
    const notes = p(row, "Notes", "Note", "Comments");

    const entry: Internship = {
      id: crypto.randomUUID(),
      company,
      role,
      location,
      status: mapStatus(rawStatus),
      dateAdded: today,
      dateApplied: parseDate(rawDateApplied),
      url: url || undefined,
      notes,
      source: "simplify",
      statusLog: [],
    };

    imported.push(entry);
  }

  const merged = [...existing, ...imported];
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));

  return NextResponse.json({
    imported: imported.length,
    skipped,
    total: merged.length,
  });
}
