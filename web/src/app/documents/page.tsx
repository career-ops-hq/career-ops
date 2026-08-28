import Link from "next/link";
import { Files, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DocumentsView } from "@/components/documents-view";
import { readDocumentLibrary } from "@/lib/document-library";

export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  const library = readDocumentLibrary();
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Files className="size-6 text-brand" /><h1 className="font-display text-2xl tracking-tight text-landing">Documents</h1></div>
        <Link href="/documents/create" className={cn(buttonVariants({ variant: "primary" }))}><Plus className="size-4" />Create Resume</Link>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-muted">
        Browse job-specific resumes and cover letters already created by career-ops. The CV page remains the editor for your master CV.
      </p>
      <div className="mt-6"><DocumentsView {...library} /></div>
    </div>
  );
}
