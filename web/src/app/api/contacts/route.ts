import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Confirm-then-save path for contacto's own step 7 ("Offer to save the
// contact... NEVER save without the candidate confirming first") — the web
// job itself never writes data/contacts.tsv (kept read-only/DRAFT-ONLY, see
// api/run/route.ts), so this is the one write path, gated behind the user
// actually filling in and submitting the form on /jobs/[id]. Same schema and
// update-in-place-by-name+company semantics as contacts.mjs documents.

const VALID_TYPES = new Set(["recruiter", "hiring-manager", "peer", "interviewer", "other"]);
const HEADER = "# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker#\tnotes";

type Body = {
  name?: string;
  company?: string;
  type?: string;
  title?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  trackerNum?: string;
  notes?: string;
};

// TSV cells can't carry tabs/newlines without corrupting the column count for
// every reader downstream (contacts.mjs, --vcf, the CLI) — collapse instead
// of rejecting, so a pasted multi-line note still saves.
const clean = (v?: string) => (v ?? "").replace(/[\t\r\n]+/g, " ").trim();

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const name = clean(body.name);
  const company = clean(body.company);
  if (!name || !company) {
    return Response.json({ error: "name and company are required" }, { status: 400 });
  }
  const type = VALID_TYPES.has(body.type ?? "") ? (body.type as string) : "other";
  const row = [
    name,
    company,
    type,
    clean(body.title),
    clean(body.phone),
    clean(body.email),
    clean(body.linkedin),
    clean(body.trackerNum) || "-",
    clean(body.notes),
  ].join("\t");

  const file = path.join(careerOpsRoot(), "data", "contacts.tsv");
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    lines = [HEADER];
  }

  const uidKey = (n: string, c: string) => `${n.toLowerCase()} ${c.toLowerCase()}`;
  const target = uidKey(name, company);
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const cells = line.split("\t");
    if (cells.length < 2) continue;
    if (uidKey(cells[0].trim(), cells[1].trim()) === target) {
      lines[i] = row;
      updated = true;
      break;
    }
  }
  if (!updated) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(row);
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, lines.join("\n") + "\n");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, updated });
}
