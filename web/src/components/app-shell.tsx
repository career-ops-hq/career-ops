"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, MoveHorizontal } from "lucide-react";
import { applyAppearance, loadAppearance, saveAppearance } from "@/lib/appearance";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { visibleNavItems, isActivePath } from "@/lib/nav-items";

export function AppShell({ children, followupsEnabled }: { children: React.ReactNode; followupsEnabled: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("career-ops:sidebar") === "hidden");
    } catch {
      /* ignore */
    }
  }, []);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("career-ops:sidebar", next ? "hidden" : "shown");
    } catch {
      /* ignore */
    }
  };
  const cycleWidth = () => {
    const a = loadAppearance();
    const order = ["small", "medium", "full"] as const;
    const next = { ...a, width: order[(order.indexOf(a.width) + 1) % 3] };
    applyAppearance(next);
    window.dispatchEvent(new Event("appearancechange")); // keep the Config page in step
    void saveAppearance(next);
  };
  return (
    <JobsProvider>
      <PipelineProvider>
      <ApplyProvider>
      <ExploreProvider>
      <a
        href="#main-content"
        className="sr-only rounded-md bg-brand text-sm font-medium text-brand-foreground focus:not-sr-only focus:fixed focus:px-3 focus:py-2 focus:left-3 focus:top-3 focus:z-[100] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        Skip to content
      </a>
      <MobileNav followupsEnabled={followupsEnabled} />
      <div className="flex min-h-screen">
        <aside className={cn("sticky top-0 hidden print:hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/30 p-4", !collapsed && "md:flex")}>
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-1">
            <CoMark size={32} />
            <span className={`${instrumentSerif.className} relative -top-px text-2xl font-normal tracking-tight text-landing`}>
              career-ops
            </span>
          </Link>
          <div className="mb-4 flex items-center gap-1 px-1">
            <button type="button" onClick={toggleSidebar} aria-label="Hide sidebar" title="Hide sidebar" className="rounded-md p-2 text-muted hover:bg-surface-hover hover:text-foreground">
              <PanelLeftClose className="size-4" />
            </button>
            <button type="button" onClick={cycleWidth} aria-label="Change page width" title="Page width: small / medium / full" className="rounded-md p-2 text-muted hover:bg-surface-hover hover:text-foreground">
              <MoveHorizontal className="size-4" />
            </button>
          </div>
          <CommandPalette followupsEnabled={followupsEnabled} />
          <nav className="flex flex-col gap-1">
            {visibleNavItems(followupsEnabled).map(({ href, label, icon: Icon, chip }) => {
              const active = isActivePath(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand-soft text-brand-text"
                      : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {chip && (
                    <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                      {chip}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <WorkerPills />

          <div className="mt-auto space-y-3 pb-16 pt-4 md-tall:pb-40">
            <UsageMeter />
            <ThemeToggle showLabel />
          </div>
        </aside>
        {collapsed && (
          <button type="button" onClick={toggleSidebar} aria-label="Show sidebar" title="Show sidebar"
            className="fixed left-3 top-3 z-30 hidden rounded-md border border-border bg-surface p-2 text-muted hover:text-foreground md:block print:hidden">
            <PanelLeftOpen className="size-4" />
          </button>
        )}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-x-hidden focus:outline-none">{children}</main>
        <div className="print:hidden">
          <AssistantConsole />
          <BackToTop />
          <FirstScoreView />
          <BetaBanner />
        </div>
      </div>
      </ExploreProvider>
      </ApplyProvider>
      </PipelineProvider>
    </JobsProvider>
  );
}
