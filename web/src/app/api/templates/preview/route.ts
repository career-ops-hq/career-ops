import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { parseKind, assertSelectableTemplate, renderTemplatePreview, userTemplatesDir, withPreviewCsp } from "@/lib/template-gallery.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A template filled with the fictional sample resume, as a standalone page for an
// iframe. Never the user's data: the sample is bundled with the app.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const name = params.get("name") ?? "";
  const kind = parseKind(params.get("kind") ?? "cv");
  if (!kind) return Response.json({ error: "kind must be cv or cover" }, { status: 400 });
  const root = resolveCodeRoot(process.cwd(), process.env);
  const userDir = userTemplatesDir(careerOpsRoot());
  try {
    await assertSelectableTemplate(root, name, kind, { userDir });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unknown template" }, { status: 404 });
  }
  try {
    return new Response(withPreviewCsp(await renderTemplatePreview(root, name, kind, { userDir })), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // A template is user-editable markup. The sandbox keeps any script in it
        // from running, and the rest keeps it from fetching anything.
        "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "could not render the preview" }, { status: 500 });
  }
}
