"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Single-line monospace command + copy-to-clipboard — ported from the
// career-ops-docs home. Truncates on narrow viewports (intent is "copy this").
export function CopyableCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Non-secure context or permission denied — fail silently.
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pl-4 pr-1.5 font-mono text-sm text-muted shadow-sm",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate">
        <span className="text-faint">$</span> {command}
      </code>
      <span
        aria-hidden="true"
        className={cn(
          "hidden shrink-0 text-xs font-medium text-brand transition-opacity duration-200 sm:inline-block",
          copied ? "opacity-100" : "opacity-0",
        )}
      >
        Copied
      </span>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied to clipboard" : "Copy command"}
        title={copied ? "Copied" : "Copy"}
        className="shrink-0 text-muted"
      >
        {copied ? (
          <CheckIcon className="size-4 text-brand" aria-hidden="true" />
        ) : (
          <CopyIcon className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
