import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, readApplications, rootScript } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

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

/** Map Simplify status strings to canonical tracker states. */
function mapStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (["saved", "bookmarked", "interested"].includes(s)) return "Evaluated";
  if (["applied", "submitted"].includes(s)) return "Applied";
  if (["interview", "interviewing", "phone screen", "on-site"].includes(s))
    return "Interview";
  if (["offer", "offered"].includes(s)) return "Offer";
  if (s === "accepted") return "Hired";
  if (["rejected", "declined", "not selected"].includes(s)) return "Rejected";
  if (["archived", "withdrawn", "closed"].includes(s)) return "Discarded";
  return "Evaluated";
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

  // Read existing applications for dedup
  const apps = readApplications();
  const existingKeys = new Set(
    apps.map((a) => `${a.company.toLowerCase()}|${a.role.toLowerCase()}`),
  );

  const today = new Date().toISOString().slice(0, 10);
  const root = careerOpsRoot();
  const tsvDir = path.join(root, "batch", "tracker-additions");
  fs.mkdirSync(tsvDir, { recursive: true });

  /** Strip tabs and newlines so user-provided values cannot corrupt TSV columns. */
  const sanitize = (s: string) => s.replace(/[\t\r\n]/g, " ");

  let nextNum = apps.reduce((m, a) => Math.max(m, parseInt(a.n) || 0), 0) + 1;
  let importedCount = 0;
  let skipped = 0;
  const writtenTsvFiles: string[] = [];

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
    const url = p(row, "URL", "Job URL", "Link", "Apply URL", "Application URL");
    const notes = p(row, "Notes", "Note", "Comments");

    const num = String(nextNum++);
    const noteParts: string[] = [];
    noteParts.push("source:simplify");
    if (notes) noteParts.push(sanitize(notes));

    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    const tsvFile = path.join(tsvDir, `${num.padStart(3, "0")}-${slug}.tsv`);
    const header = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";
    const tsvRow = [
      num, today, sanitize(company), sanitize(role), mapStatus(rawStatus),
      "N/A", "❌", "—", noteParts.join(" | "), sanitize(url) || "",
    ].join("\t");
    fs.writeFileSync(tsvFile, `${header}\n${tsvRow}\n`);
    writtenTsvFiles.push(tsvFile);
    importedCount++;
  }

  // Run merge-tracker
  if (importedCount > 0) {
    try {
      execFileSync(process.execPath, [rootScript("merge-tracker")], {
        cwd: root, encoding: "utf8", timeout: 60000,
      });
    } catch (err) {
      // Clean up TSV files so a retry doesn't produce duplicates
      for (const f of writtenTsvFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      return NextResponse.json(
        { error: `merge failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    imported: importedCount,
    skipped,
    total: apps.length + importedCount,
  });
}
