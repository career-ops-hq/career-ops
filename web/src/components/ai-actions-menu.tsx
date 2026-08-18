"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, ChevronDown, Users, Telescope, PenLine, Mail, Loader2, Check, ArrowUpRight, RotateCcw } from "lucide-react";
import { useJobs, type Job } from "@/components/jobs/job-store";

type ActionDef = {
  kind: "contacto" | "deep" | "cover" | "email";
  icon: typeof Users;
  label: string;
  doneLabel: string;
  description: string;
  title: (company: string) => string;
  subtitle: string;
};

const ACTIONS: ActionDef[] = [
  {
    kind: "contacto",
    icon: Users,
    label: "Find contacts",
    doneLabel: "View contacts & outreach",
    description: "Hiring manager, recruiter & peers, with draft messages",
    title: (c) => `Find contacts · ${c}`,
    subtitle: "hiring manager, recruiter & peers",
  },
  {
    kind: "deep",
    icon: Telescope,
    label: "Company research",
    doneLabel: "View research",
    description: "AI strategy, culture, challenges, your angle",
    title: (c) => `Company research · ${c}`,
    subtitle: "6-axis interview prep",
  },
  {
    kind: "cover",
    icon: PenLine,
    label: "Cover letter",
    doneLabel: "View cover letter",
    description: "Tailored draft from this JD",
    title: (c) => `Cover letter · ${c}`,
    subtitle: "tailored draft",
  },
  {
    kind: "email",
    icon: Mail,
    label: "Application email",
    doneLabel: "View email draft",
    description: "Subject, body, attachment checklist",
    title: (c) => `Application email · ${c}`,
    subtitle: "draft only",
  },
];

// Consolidates the 4 secondary generative actions (contacto/deep/cover/email)
// behind one trigger instead of 4 always-visible pill buttons + 4 repeated
// "USES TOKENS" badges — that repetition was the actual density complaint,
// not any single button. A running/done action still surfaces on the trigger
// itself (spinner / count dot) so progress stays visible with the menu closed.
export function AiActionsMenu({ n, company }: { n: string; company: string }) {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const latestByKind = useMemo(() => {
    const map = new Map<string, Job>();
    for (const action of ACTIONS) {
      const job = jobs.filter((j) => j.kind === action.kind && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0];
      if (job) map.set(action.kind, job);
    }
    return map;
  }, [jobs, n]);

  const runningCount = ACTIONS.filter((a) => latestByKind.get(a.kind)?.status === "running").length;
  const doneCount = ACTIONS.filter((a) => latestByKind.get(a.kind)?.status === "done").length;

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        title="Outreach, research, cover letter & email drafts for this role"
      >
        {runningCount > 0 ? <Loader2 className="size-3.5 animate-spin text-brand" /> : <Sparkles className="size-3.5" />}
        AI actions
        {doneCount > 0 && runningCount === 0 && (
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            {doneCount}
          </span>
        )}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[100] mt-2 w-80 origin-top-left overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">AI actions</span>
            <span className="text-[11px] text-faint">runs on your own AI — uses tokens</span>
          </div>
          <div className="p-1.5">
            {ACTIONS.map((action) => {
              const job = latestByKind.get(action.kind);
              const Icon = action.icon;
              if (job?.status === "running") {
                return (
                  <Link
                    key={action.kind}
                    href={`/jobs/${job.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-surface-hover"
                  >
                    <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{action.label}</span>
                      <span className="block text-xs text-faint">Working…</span>
                    </span>
                  </Link>
                );
              }
              if (job?.status === "done") {
                return (
                  <div key={action.kind} className="flex items-center gap-1 rounded-lg hover:bg-surface-hover">
                    <Link
                      href={`/jobs/${job.id}`}
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 text-left"
                    >
                      <Check className="size-4 shrink-0 text-emerald-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{action.doneLabel}</span>
                        <span className="block text-xs text-faint">{action.description}</span>
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-faint" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        const id = startJob({ title: action.title(company), subtitle: action.subtitle, kind: action.kind, input: n, page: `/pipeline/${n}` });
                        setOpen(false);
                        if (id) router.push(`/jobs/${id}`);
                      }}
                      title="Check again — re-runs this, doesn't touch the saved result"
                      className="mr-1.5 inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-faint transition-colors hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  </div>
                );
              }
              return (
                <button
                  key={action.kind}
                  type="button"
                  onClick={() => {
                    const id = startJob({ title: action.title(company), subtitle: action.subtitle, kind: action.kind, input: n, page: `/pipeline/${n}` });
                    setOpen(false);
                    if (id) router.push(`/jobs/${id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <Icon className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{action.label}</span>
                    <span className="block text-xs text-faint">{action.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
