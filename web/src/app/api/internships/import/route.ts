import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, readApplications, rootScript } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

type CsvRow = Record<string, string>;

function mapStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "open" || s === "rolling") return "Evaluated";
  if (s === "applied") return "Applied";
  if (s === "interviewing" || s === "interview") return "Interview";
  if (s === "offered" || s === "offer") return "Offer";
  if (s === "accepted") return "Hired";
  if (s === "rejected") return "Rejected";
  if (s === "closed") return "Discarded";
  if (s === "not yet posted") return "SKIP";
  return "Evaluated";
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

  // Read existing applications for dedup
  const apps = readApplications();
  const existingKeys = new Set(apps.map((a) => `${a.company.toLowerCase()}|${a.role.toLowerCase()}`));

  const today = new Date().toISOString().slice(0, 10);
  const root = careerOpsRoot();
  const tsvDir = path.join(root, "batch", "tracker-additions");
  fs.mkdirSync(tsvDir, { recursive: true });

  let nextNum = apps.reduce((m, a) => Math.max(m, parseInt(a.n) || 0), 0) + 1;
  let importedCount = 0;
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

    const num = String(nextNum++);
    const noteParts: string[] = [];
    if (row["Track"]) noteParts.push(`track:${row["Track"]}`);
    if (row["Source"]) noteParts.push(`source:${row["Source"]}`);
    if (row["Key Requirements"]) noteParts.push(`requirements:${row["Key Requirements"]}`);
    if (row["Deadline"]) noteParts.push(`deadline:${row["Deadline"]}`);
    if (row["Work Auth / Sponsorship"]) noteParts.push(`workAuth:${row["Work Auth / Sponsorship"]}`);
    if (row["Grad Year Eligibility"]) noteParts.push(`gradEligibility:${row["Grad Year Eligibility"]}`);
    if (row["My Notes"]) noteParts.push(row["My Notes"]);

    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    const tsvFile = path.join(tsvDir, `${num.padStart(3, "0")}-${slug}.tsv`);
    const header = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";
    const tsvRow = [
      num,
      row["Last Verified"] || today,
      company,
      role,
      mapStatus(row["Status"] ?? ""),
      "N/A",
      "❌",
      "—",
      noteParts.join(" | "),
      "",
    ].join("\t");
    fs.writeFileSync(tsvFile, `${header}\n${tsvRow}\n`);
    importedCount++;
  }

  // Run merge-tracker
  if (importedCount > 0) {
    try {
      execFileSync(process.execPath, [rootScript("merge-tracker")], {
        cwd: root, encoding: "utf8", timeout: 60000,
      });
    } catch (err) {
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
