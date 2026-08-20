import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const root = careerOpsRoot();
    const contactsPath = path.join(root, "data", "contacts.tsv");

    if (!fs.existsSync(contactsPath)) {
      return new Response(JSON.stringify({ contacts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const raw = fs.readFileSync(contactsPath, "utf8");
    const lines = raw.split("\n").filter(l => l.trim() && !l.startsWith("#"));

    const contacts = lines.map(line => {
      const parts = line.split("\t");
      return {
        name: parts[0] || "",
        company: parts[1] || "",
        type: parts[2] || "recruiter",
        title: parts[3] || "",
        phone: parts[4] || "",
        email: parts[5] || "",
        linkedin: parts[6] || "",
        trackerId: parts[7] || "",
        notes: parts[8] || ""
      };
    });

    return new Response(JSON.stringify({ contacts }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
