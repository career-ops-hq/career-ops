"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useApply } from "@/components/apply/apply-provider";
import { applyDestination, applyOpenArgs } from "@/lib/apply-destination.mjs";

export function useStartApply() {
  const router = useRouter();
  const apply = useApply();
  return (dest: ReturnType<typeof applyDestination>, company: string) => {
    // usePathname() drops the query and hash. The list filter and the row anchor live there.
    const { pathname, search, hash } = window.location;
    const args = applyOpenArgs({ dest, company, from: `${pathname}${search}${hash}` });
    if (!args) return;
    apply.open(args.url, args.opts);
    router.push(args.href);
  };
}

export function ApplyButton({
  n,
  url,
  company,
  pdfReady,
  quiet = false,
  alreadyOnReport = true,
}: {
  n: string;
  url?: string;
  company: string;
  pdfReady: boolean;
  quiet?: boolean;
  alreadyOnReport?: boolean;
}) {
  const start = useStartApply();
  const dest = applyDestination({ n, pdfOnDisk: pdfReady, postingUrl: url, alreadyOnReport });

  if (dest.kind !== "apply") {
    return (
      <span className="inline-flex max-w-sm flex-col items-start gap-0.5">
        <span className="text-xs text-muted">{dest.message}</span>
        {dest.nextHref && dest.nextLabel && (
          <Link href={dest.nextHref} className="text-xs font-medium text-brand-text hover:underline">
            {dest.nextLabel}
          </Link>
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => start(dest, company)}
      className={
        quiet
          ? "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 py-1 text-xs font-medium text-muted transition-colors hover:border-foreground/20 hover:text-foreground max-sm:min-h-[44px]"
          : "inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-1 text-xs font-medium text-brand-foreground shadow-sm transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
      }
      title={
        quiet
          ? "Below the apply line or flagged caution. Opens the form pre-filled. You review and submit it yourself."
          : "Opens the form pre-filled. You review and submit it yourself."
      }
    >
      <Send className="size-3.5" /> Apply
    </button>
  );
}
