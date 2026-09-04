import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { jdFilename, jdMarkdown } from "@/lib/jd-archive.mjs";
import { extractJdFile, MAX_UPLOAD_BYTES } from "@/lib/jd-extract.mjs";
import { JD_REF_PREFIX, validateJdText } from "@/lib/jd-source.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jd — archive a pasted or uploaded job description under `jds/` and
 * hand back the `local:jds/{file}` reference that identifies it everywhere else.
 *
 * This is the free, reversible half of "Add job": no tokens are spent and no
 * evaluation runs. The client then does exactly what it already did for a pasted
 * link, with the reference standing in for the URL — `startEvaluate` for
 * "Evaluate now", `/api/explore/add` for "Add to inbox". That symmetry is the
 * reason the reference exists at all; see jd-source.mjs's header.
 *
 * Two request shapes, one behaviour:
 *   application/json      { text, company?, role? }
 *   multipart/form-data   file, company?, role?     (PDF / DOCX / MD / TXT)
 *
 * Writing is idempotent because the filename is a hash of the JD's own text:
 * re-submitting the same posting resolves to the same file and the same
 * reference, so nothing downstream sees a duplicate. `existed` reports which
 * happened so the dialog can say so.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let text = "";
  let company = "";
  let role = "";
  let source = "pasted";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ error: "Could not read that upload." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file was attached." }, { status: 400 });
    // Checked before the body is buffered as well as inside extractJdFile: the
    // size is on the part's own header, so an oversized upload is refused
    // without ever holding it in memory.
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "That file is larger than 10MB. Upload the posting itself, not a whole brochure." }, { status: 400 });
    }
    const extracted = extractJdFile(Buffer.from(await file.arrayBuffer()), file.name);
    if (!extracted.ok) return Response.json({ error: extracted.error }, { status: 400 });
    text = extracted.text;
    company = String(form.get("company") ?? "");
    role = String(form.get("role") ?? "");
    source = `upload: ${path.basename(file.name).slice(0, 120)}`;
  } else {
    let body: { text?: unknown; company?: unknown; role?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad json" }, { status: 400 });
    }
    text = typeof body.text === "string" ? body.text : "";
    company = typeof body.company === "string" ? body.company : "";
    role = typeof body.role === "string" ? body.role : "";
  }

  // Runs on extracted text too, not just pasted text: a PDF whose text layer
  // yields two lines is as unevaluable as a two-line paste, and it is a much
  // easier mistake to make by accident.
  const valid = validateJdText(text);
  if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });

  const filename = jdFilename({ company, role, text: valid.text });
  const dir = path.join(careerOpsRoot(), "jds");
  const abs = path.join(dir, filename);
  const existed = fs.existsSync(abs);

  if (!existed) {
    try {
      atomicWrite(
        abs,
        jdMarkdown({
          company,
          role,
          source,
          savedAt: new Date().toISOString().slice(0, 10),
          text: valid.text,
        }),
      );
    } catch (e) {
      return Response.json({ error: `Could not save the job description: ${e instanceof Error ? e.message : "write failed"}` }, { status: 500 });
    }
  }

  return Response.json({
    ref: `${JD_REF_PREFIX}${filename}`,
    filename,
    company: company.trim(),
    role: role.trim(),
    chars: valid.text.length,
    existed,
  });
}
