"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function JobNotFound() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text"
      >
        <ArrowLeft className="size-4" /> Jobs
      </Link>
      <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/30 p-5">
        <h1 className="font-display text-2xl tracking-tight text-landing">No job {id}</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing in this browser matches that address. It may have finished and been cleared, or the link is wrong.
        </p>
      </div>
    </div>
  );
}
