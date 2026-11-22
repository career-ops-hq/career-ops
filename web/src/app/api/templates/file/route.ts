import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { parseKind, userTemplatesDir } from "@/lib/template-gallery.mjs";
import { assertVersionUnchanged, checkTemplateEdit, readUserTemplate } from "@/lib/template-edit.mjs";
import { readJsonObject } from "@/lib/json-body";
import { failure, text } from "../manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The body of one of your own templates: read it, and save an edit. A save is
// accepted only when the edited template still resolves (required placeholders,
// declared sections), and it is refused with the resolver's reason otherwise.
// Shipped templates are never editable here; duplicate one first.

function where() {
  return { codeRoot: resolveCodeRoot(process.cwd(), process.env), userDir: userTemplatesDir(careerOpsRoot()) };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const kind = parseKind(params.get("kind") ?? "cv");
  if (!kind) return NextResponse.json({ error: "kind must be cv or cover" }, { status: 400 });
  const { codeRoot, userDir } = where();
  try {
    return NextResponse.json(await readUserTemplate(codeRoot, { kind, name: params.get("name") ?? "", userDir }));
  } catch (e) {
    return failure(e);
  }
}

export async function PUT(req: Request) {
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const kind = parseKind(body.kind ?? "cv");
  if (!kind) return NextResponse.json({ error: "kind must be cv or cover" }, { status: 400 });
  const { codeRoot, userDir } = where();
  try {
    const checked = await checkTemplateEdit(codeRoot, { kind, name: text(body.name), text: text(body.text), version: text(body.version), userDir });
    // Compared again here, with no await before the write: the check above awaited.
    assertVersionUnchanged(checked.path, text(body.version));
    atomicWriteWithBackup(checked.path, text(body.text));
    return NextResponse.json({ ok: true, version: checked.version });
  } catch (e) {
    return failure(e);
  }
}
