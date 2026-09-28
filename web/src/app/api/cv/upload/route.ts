import { parseCvTextToMarkdown } from "@/lib/cv/pdf-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CV_BYTES = 500_000;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > MAX_CV_BYTES) {
      return Response.json({ error: "Uploaded CV file is too large (max 500KB)" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".docx")) {
      return Response.json(
        { error: "Word documents (.docx) are not supported. Please upload a plain text or markdown CV." },
        { status: 400 }
      );
    }

    if (fileName.endsWith(".pdf")) {
      return Response.json(
        { error: "Direct PDF parsing in quick upload is not supported. Please use AI Ingestion or upload a plain text/markdown file." },
        { status: 400 }
      );
    }

    const text = buffer.toString("utf8");
    const parsed = parseCvTextToMarkdown(text);

    return Response.json({
      ok: true,
      markdown: parsed.markdown,
      candidate: parsed.candidate,
      targetRoles: parsed.targetRoles,
      seed: {
        title: parsed.candidate.title,
        roles: parsed.targetRoles,
        location: parsed.candidate.location,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to process CV upload" },
      { status: 500 }
    );
  }
}
