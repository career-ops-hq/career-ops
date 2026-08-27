import { readDocumentLibrary } from "@/lib/document-library";
import { CreateResumeView } from "@/components/create-resume-view";

export const dynamic = "force-dynamic";
export default function CreateResumePage() {
  const { applications } = readDocumentLibrary();
  return <div className="mx-auto max-w-4xl px-6 py-8"><CreateResumeView applications={applications} /></div>;
}
