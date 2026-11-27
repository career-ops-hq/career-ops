"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, FileWarning } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";

// Production replaces a server error's message with generic text, so the
// digest is the only detail worth showing: it matches the server log line.
export default function ReportError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
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
      <div className="mt-8 flex gap-3 rounded-2xl border border-border bg-surface/30 p-5">
        <FileWarning className="mt-1 size-5 shrink-0 text-faint" />
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Report #{id} could not be read</h1>
          <p className="mt-2 text-sm text-muted">
            The file is there, but the server could not open it. Common causes are its permissions, a sync app
            holding it, or a folder with a .md name under <code className="text-foreground">reports/</code>.
          </p>
          {error.digest && <p className="mt-3 font-mono text-xs text-faint">Error digest {error.digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px]"
          >
            Try again
          </button>
        </div>
      </div>
    </PageFrame>
  );
}
