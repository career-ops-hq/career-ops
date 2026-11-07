import { careerOpsRoot, isRegularContainedFile, readApplications } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { handleDocumentsRequest } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const manifestPath = await resolvePdfIndexPath();
  // A valid PDF id must still reach the PDF branch even if the tracker is unreadable.
  const applications = new URL(req.url).searchParams.get("id") ? undefined : readApplications();
  return handleDocumentsRequest(req, root, manifestPath, isRegularContainedFile, applications);
}
