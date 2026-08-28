import { ResumeUpdateReview } from "@/components/resume-update-review";
import { readDocumentLibrary } from "@/lib/document-library";

export const dynamic = "force-dynamic";
export default function ReviewResumeUpdatesPage() {
  const library = readDocumentLibrary();
  return <ResumeUpdateReview applications={library.applications} roleResumes={library.roleResumes} profileState={library.profileState} />;
}
