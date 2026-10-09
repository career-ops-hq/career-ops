import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { careerOpsRoot, readApplications, rootScript } from "@/lib/career-ops";
import type { Internship } from "../route";

export const dynamic = "force-dynamic";

const README_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md";

/** Known section headers in the README and their short labels. */
const SECTION_HEADERS: Record<string, string> = {
  "Software Engineering Internship Roles": "Software Engineering",
  "Product Management Internship Roles": "Product Management",
  "Data Science, AI & Machine Learning Internship Roles":
    "Data Science, AI & Machine Learning",
  "Quantitative Finance Internship Roles": "Quantitative Finance",
  "Hardware Engineering Internship Roles": "Hardware Engineering",
};

/** Map a section label to an internship track code. */
function sectionToTrack(section: string): string {
  if (section.includes("Software Engineering")) return "SWE";
  if (section.includes("Data Science") || section.includes("Machine Learning"))
    return "DS";
  if (section.includes("Quantitative Finance")) return "DS";
  if (section.includes("Product Management")) return "DA";
  if (section.includes("Hardware Engineering")) return "SWE";
  return "SWE";
}

// US state abbreviations (2-letter)
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const US_CITY_ABBREVIATIONS = new Set([
  "NYC","SF","LA","ATL","CHI","BOS","SEA","DFW","DMV","SLC","PHX","PDX",
]);

/** Check whether a location string looks like a US location. */
function isUsLocation(location: string): boolean {
  if (!location.trim()) return false;
  const upper = location.toUpperCase();
  if (
    upper.includes("UNITED STATES") ||
    upper.includes("USA") ||
    upper.includes("U.S.A") ||
    upper.includes("U.S.") ||
    /\bREMOTE\b/.test(upper)
  ) {
    return true;
  }
  // Check for US state abbreviations as word boundaries
  for (const st of US_STATES) {
    // Match ", CA" or ", CA " or "CA;" patterns common in location strings
    if (new RegExp(`\\b${st}\\b`).test(upper)) return true;
  }
  for (const city of US_CITY_ABBREVIATIONS) {
    if (new RegExp(`\\b${city}\\b`).test(upper)) return true;
  }
  return false;
}

/** Strip HTML tags from a string. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Remove common emojis used as decorators in the repo. */
function stripEmojis(text: string): string {
  return text.replace(/[\u{1F525}\u{1F393}\u{1F4BB}\u{1F4F1}\u{1F916}\u{1F4C8}\u{1F527}\u{1F512}]/gu, "").trim();
}

type ParsedRow = {
  company: string;
  role: string;
  location: string;
  url: string;
  age: string;
  closed: boolean;
};

/** Parse a single <tr> from the HTML table. */
function parseRow(tr: string): ParsedRow | null {
  // Extract <td> contents
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const tds: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tdRegex.exec(tr)) !== null) {
    tds.push(m[1]);
  }
  if (tds.length < 4) return null;

  // Company: first <td>, strip HTML and emojis
  const company = stripEmojis(stripHtml(tds[0]));
  if (!company) return null;

  // Role: second <td>
  const roleRaw = stripHtml(tds[1]);
  const closed = roleRaw.includes("\u{1F512}"); // lock emoji
  const role = stripEmojis(roleRaw).replace(/\u{1F512}/gu, "").trim();
  if (!role) return null;

  // Location: third <td>, handle <details> tags
  let location: string;
  if (tds[2].includes("<details")) {
    // Extract all text from within <details>, stripping tags
    // Locations are typically inside <summary> and plain text or <br> separated
    const detailContent = tds[2]
      .replace(/<\/?details[^>]*>/gi, "")
      .replace(/<\/?summary[^>]*>/gi, "");
    const locations = stripHtml(detailContent)
      .split(/\n|<br\s*\/?>/)
      .map((l) => l.trim())
      .filter(Boolean);
    location = locations.join(" | ");
  } else {
    location = stripHtml(tds[2]);
  }

  // URL: fourth <td>, find the first <a href> that is NOT simplify.jobs
  let url = "";
  const linkRegex = /<a\s+href="([^"]+)"/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(tds[3])) !== null) {
    const href = linkMatch[1];
    if (!href.includes("simplify.jobs")) {
      url = href;
      break;
    }
  }

  // Age: fifth <td> if present
  const age = tds.length >= 5 ? stripHtml(tds[4]) : "";

  return { company, role, location, url, age, closed };
}

/** Split the README into sections and parse each section's table rows. */
function parseSections(
  readme: string,
  requestedSections?: string[],
): { section: string; rows: ParsedRow[] }[] {
  const results: { section: string; rows: ParsedRow[] }[] = [];

  for (const [headerText, label] of Object.entries(SECTION_HEADERS)) {
    // Skip sections the caller didn't request
    if (requestedSections && requestedSections.length > 0) {
      const matches = requestedSections.some(
        (s) =>
          label.toLowerCase().includes(s.toLowerCase()) ||
          s.toLowerCase().includes(label.toLowerCase()) ||
          headerText.toLowerCase().includes(s.toLowerCase()),
      );
      if (!matches) continue;
    }

    // Find the section in the README (header starts with ## and an emoji)
    const sectionIdx = readme.indexOf(headerText);
    if (sectionIdx === -1) continue;

    // Find the next ## heading or end of file
    const afterHeader = readme.indexOf("\n", sectionIdx);
    if (afterHeader === -1) continue;
    const nextSection = readme.indexOf("\n## ", afterHeader);
    const sectionContent =
      nextSection === -1
        ? readme.slice(afterHeader)
        : readme.slice(afterHeader, nextSection);

    // Extract all <tr> blocks
    const trRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    const rows: ParsedRow[] = [];
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(sectionContent)) !== null) {
      // Skip header rows (contain <th>)
      if (trMatch[1].includes("<th")) continue;
      const parsed = parseRow(trMatch[0]);
      if (parsed) rows.push(parsed);
    }

    results.push({ section: label, rows });
  }

  return results;
}

export async function POST(req: NextRequest) {
  let body: { sections?: string[]; usOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const usOnly = body.usOnly ?? true;
  const requestedSections = body.sections;

  // Fetch README from hardcoded URL
  let readme: string;
  try {
    const res = await fetch(README_URL, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch README: ${res.status} ${res.statusText}` },
        { status: 502 },
      );
    }
    readme = await res.text();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Network error fetching README: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  // Parse sections
  const sections = parseSections(readme, requestedSections);
  if (sections.length === 0) {
    return NextResponse.json(
      { error: "No matching sections found in README" },
      { status: 404 },
    );
  }

  // Read existing applications for dedup
  const apps = readApplications();
  const existingKeys = new Set(
    apps.map((a) => `${a.company.toLowerCase()}|${a.role.toLowerCase()}`),
  );

  const today = new Date().toISOString().slice(0, 10);
  const root = careerOpsRoot();
  const tsvDir = path.join(root, "batch", "tracker-additions");
  fs.mkdirSync(tsvDir, { recursive: true });

  const imported: Internship[] = [];
  let skipped = 0;
  let closed = 0;
  let filtered = 0;
  const sectionNames: string[] = [];

  // Reserve report numbers for all imports at once
  let nextNum = apps.reduce((m, a) => Math.max(m, parseInt(a.n) || 0), 0) + 1;
  try {
    // Count importable rows first for reservation
    let importCount = 0;
    for (const { rows } of sections) {
      for (const row of rows) {
        if (row.closed) continue;
        if (usOnly && !isUsLocation(row.location)) continue;
        const key = `${row.company.toLowerCase()}|${row.role.toLowerCase()}`;
        if (!existingKeys.has(key)) importCount++;
      }
    }
    if (importCount > 0) {
      const reserved = execFileSync(process.execPath, [
        rootScript("reserve-report-num"), "--count", String(importCount),
      ], { cwd: root, encoding: "utf8", timeout: 30000 }).trim();
      nextNum = parseInt(reserved.split("-")[0]);
    }
  } catch {
    // fallback: use max+1 from existing apps
  }

  for (const { section, rows } of sections) {
    sectionNames.push(section);
    const track = sectionToTrack(section);

    for (const row of rows) {
      if (row.closed) { closed++; continue; }
      if (usOnly && !isUsLocation(row.location)) { filtered++; continue; }

      const key = `${row.company.toLowerCase()}|${row.role.toLowerCase()}`;
      if (existingKeys.has(key)) { skipped++; continue; }
      existingKeys.add(key);

      const num = String(nextNum++);
      const noteParts: string[] = [];
      noteParts.push(`track:${track}`);
      noteParts.push("source:simplify-github");
      if (row.age) noteParts.push(`Posted: ${row.age} ago`);

      // Write TSV for this row
      const slug = row.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
      const tsvFile = path.join(tsvDir, `${num.padStart(3, "0")}-${slug}.tsv`);
      const header = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";
      const tsvRow = [
        num, today, row.company, row.role, "Evaluated", "N/A", "❌", "—",
        noteParts.join(" | "), row.url || "",
      ].join("\t");
      fs.writeFileSync(tsvFile, `${header}\n${tsvRow}\n`);

      imported.push({
        id: num,
        company: row.company,
        role: row.role,
        location: row.location,
        status: "wishlist",
        dateAdded: today,
        url: row.url || undefined,
        notes: row.age ? `Posted: ${row.age} ago` : "",
        source: "simplify-github",
        track,
      });
    }
  }

  // Run merge-tracker to incorporate all new rows
  if (imported.length > 0) {
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
    imported: imported.length,
    skipped,
    closed,
    filtered,
    total: apps.length + imported.length,
    sections: sectionNames,
  });
}
