import { careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { handleDocumentsRequest } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const manifestPath = await resolvePdfIndexPath();
  return handleDocumentsRequest(req, root, manifestPath, isRegularContainedFile);
}
