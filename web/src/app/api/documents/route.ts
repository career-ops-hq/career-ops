import { careerOpsRoot, isRegularContainedFile, readApplications } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { handleDocumentsRequest } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const manifestPath = await resolvePdfIndexPath();
  let applications;
  if (!new URL(req.url).searchParams.get("id")) {
    try {
      applications = readApplications();
    } catch (err) {
      console.error("[documents] tracker unreadable:", err);
    }
  }
  return handleDocumentsRequest(req, root, manifestPath, isRegularContainedFile, applications);
}
