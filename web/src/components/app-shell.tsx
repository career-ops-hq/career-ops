"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { CoMark } from "@/components/co-mark";
import { AssistantConsole } from "@/components/assistant-console";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackToTop } from "@/components/back-to-top";
import { CommandPalette } from "@/components/command-palette";
import { JobsProvider } from "@/components/jobs/job-store";
import { PipelineProvider } from "@/components/pipeline/pipeline-provider";
import { ApplyProvider } from "@/components/apply/apply-provider";
import { ExploreProvider } from "@/components/explore/explore-provider";
import { FirstScoreView } from "@/components/explore/first-score-view";
import { BetaBanner } from "@/components/beta/beta-banner";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { instrumentSerif } from "@/lib/fonts";
import { NAV_ITEMS, NAV_CATEGORIES, isActivePath } from "@/lib/nav-items";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <JobsProvider>
      <PipelineProvider>
        <ApplyProvider>
          <ExploreProvider>
            <MobileNav />
            <CommandPalette />
            <div className="flex min-h-screen">
              <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/30 p-4 md:flex">
                <div className="mb-4 flex items-center justify-between px-1">
                  <Link href="/" className="flex items-center gap-2.5">
                    <CoMark size={28} />
                    <span className={`${instrumentSerif.className} relative -top-px text-2xl font-normal tracking-tight text-landing`}>
                      career-ops
                    </span>
                  </Link>
                </div>

                {/* Quick search button */}
                <button
                  onClick={() => {
                    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true });
                    window.dispatchEvent(event);
                  }}
                  className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface/80 px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Search className="size-3.5 text-faint" />
                    <span>Quick Jump...</span>
                  </div>
                  <kbd className="rounded border border-border bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-faint">
                    Ctrl+K
                  </kbd>
                </button>

                <nav className="flex flex-col gap-4 overflow-y-auto pr-1">
                  {NAV_CATEGORIES.map((cat) => {
                    const items = NAV_ITEMS.filter((item) => item.category === cat.id);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.id} className="flex flex-col gap-0.5">
                        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                          {cat.label}
                        </div>
                        {items.map(({ href, label, icon: Icon, chip }) => {
                          const active = isActivePath(href, pathname);
                          return (
                            <Link
                              key={href}
                              href={href}
                              className={cn(
                                "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                active
                                  ? "bg-brand-soft text-brand-text font-semibold"
                                  : "text-muted hover:bg-surface-hover hover:text-foreground",
                              )}
                            >
                              <Icon className={cn("size-4 shrink-0", active ? "text-brand-text" : "text-muted")} />
                              <span className="truncate">{label}</span>
                              {chip && (
                                <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                                  {chip}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    );
                  })}
                </nav>

                <div className="mt-3">
                  <WorkerPills />
                </div>

                <div className="mt-auto space-y-2.5 pt-3 border-t border-border/50">
                  <UsageMeter />
                  <div className="flex items-center justify-between px-1">
                    <span className={`${instrumentSerif.className} text-xs text-faint`}>local-first</span>
                    <ThemeToggle />
                  </div>
                </div>
              </aside>
              <main className="flex-1 overflow-x-hidden">{children}</main>
              <AssistantConsole />
              <BackToTop />
              <FirstScoreView />
              <BetaBanner />
            </div>
          </ExploreProvider>
        </ApplyProvider>
      </PipelineProvider>
    </JobsProvider>
  );
}
