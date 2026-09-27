import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type ContactItem = {
  id: string;
  name: string;
  company: string;
  role: string;
  source: string;
  linkedin?: string;
  email?: string;
  notes?: string;
  relatedJob?: string;
  status: "identified" | "contacted" | "replied" | "referral";
};

export async function GET() {
  const root = careerOpsRoot();
  const contactsPath = path.join(root, "data", "contacts.tsv");
  const connectionsPath = path.join(root, "data", "Connections.csv");

  const contacts: ContactItem[] = [];
  let connectionsCount = 0;

  // Read contacts.tsv
  if (fs.existsSync(contactsPath)) {
    try {
      const content = fs.readFileSync(contactsPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 3) {
          contacts.push({
            id: `c-${i}`,
            name: parts[0]?.trim() || "",
            company: parts[1]?.trim() || "",
            role: parts[2]?.trim() || "",
            source: parts[3]?.trim() || "direct",
            linkedin: parts[4]?.trim() || "",
            email: parts[5]?.trim() || "",
            notes: parts[6]?.trim() || "",
            status: (parts[7]?.trim() as ContactItem["status"]) || "identified",
          });
        }
      }
    } catch {
      // Ignored
    }
  }

  // Check LinkedIn Connections export
  if (fs.existsSync(connectionsPath)) {
    try {
      const content = fs.readFileSync(connectionsPath, "utf8");
      connectionsCount = Math.max(0, content.split("\n").filter((l) => l.trim().length > 0).length - 1);
    } catch {
      // Ignored
    }
  }

  return NextResponse.json({
    contacts,
    connectionsCount,
    hasConnectionsFile: fs.existsSync(connectionsPath),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, company, role, source, linkedin, email, notes, status } = body;

    if (!name || !company) {
      return NextResponse.json({ error: "Name and company are required" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const dataDir = path.join(root, "data");
    const contactsPath = path.join(dataDir, "contacts.tsv");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let content = "";
    if (fs.existsSync(contactsPath)) {
      content = fs.readFileSync(contactsPath, "utf8");
    } else {
      content = "Name\tCompany\tRole\tSource\tLinkedIn\tEmail\tNotes\tStatus\n";
    }

    const newRow = `${name}\t${company}\t${role || ""}\t${source || "direct"}\t${linkedin || ""}\t${email || ""}\t${notes || ""}\t${status || "identified"}\n`;
    content += newRow;

    atomicWrite(contactsPath, content);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
