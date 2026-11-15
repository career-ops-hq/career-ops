"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";

export default function ReportNotFound() {
  const { id } = useParams<{ id: string }>();
  const query = pipelineQuery(useSearchParams().toString());
  return (
    <PageFrame className="max-w-3xl">
      <Link
        href={`/pipeline${query ? `?${query}` : ""}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text"
      >
        <ArrowLeft className="size-4" /> Pipeline
      </Link>
      <div className="mt-8 flex gap-3 rounded-2xl border border-dashed border-border bg-surface/30 p-5">
        <FileText className="mt-1 size-5 shrink-0 text-faint" />
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">No report #{id}</h1>
          <p className="mt-2 text-sm text-muted">
            No tracker row or <code className="text-foreground">reports/</code> file has that number.
          </p>
        </div>
      </div>
    </PageFrame>
  );
}
