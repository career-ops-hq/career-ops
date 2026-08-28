import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ManualJobForm } from "@/components/manual-job-form";

export default function AddJobPostingPage() {
  return <div className="mx-auto max-w-3xl px-6 py-8">
    <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand"><ArrowLeft className="size-4" /> Pipeline</Link>
    <h1 className="mt-5 font-display text-3xl tracking-tight text-landing">Add Job Posting</h1>
    <p className="mt-2 text-sm text-muted">Evaluate a job found outside Career-Ops against your current CV and profile.</p>
    <ManualJobForm />
  </div>;
}
