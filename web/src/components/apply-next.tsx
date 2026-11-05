"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useStartApply } from "@/components/apply-button";
import { applyDestination } from "@/lib/apply-destination.mjs";

export function ApplyNext({
  n,
  company,
  score,
  pdfOnDisk,
  postingUrl,
}: {
  n: string;
  company: string;
  score: string;
  pdfOnDisk: boolean;
  postingUrl: string;
}) {
  const start = useStartApply();
  const dest = applyDestination({ n, pdfOnDisk, postingUrl, alreadyOnReport: false });
  if (dest.kind !== "apply") {
    return (
      <div className="mb-3 max-w-xl">
        <p className="text-sm text-muted">
          {company}. {dest.message}
        </p>
        {dest.nextHref && dest.nextLabel && (
          <Link href={dest.nextHref} className="mt-1 inline-flex text-sm font-medium text-brand-text hover:underline">
            {dest.nextLabel}
          </Link>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => start(dest, company)}
      className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]"
    >
      Apply next · {company} {score} <ArrowRight className="size-4" />
    </button>
  );
}
