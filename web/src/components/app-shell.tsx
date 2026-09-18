"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { resolveCliId } from "@/lib/saved-cli";
import { CoMark } from "@/components/co-mark";
import { AssistantConsole } from "@/components/assistant-console";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackToTop } from "@/components/back-to-top";
import { JobsProvider } from "@/components/jobs/job-store";
import { PipelineProvider } from "@/components/pipeline/pipeline-provider";
import { ApplyProvider } from "@/components/apply/apply-provider";
import { ExploreProvider } from "@/components/explore/explore-provider";
import { FirstScoreView } from "@/components/explore/first-score-view";
import { BetaBanner } from "@/components/beta/beta-banner";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { instrumentSerif } from "@/lib/fonts";
import { NAV_ITEMS, isActivePath } from "@/lib/nav-items";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [cliResolved, setCliResolved] = useState(false);
  // Bumped only when resolveCliId() persists a value AFTER the timeout already
  // opened the gate — forces the already-mounted surfaces below to remount and
  // re-read storage, since flipping `cliResolved` again (already true) is a no-op.
  const [cliRemountKey, setCliRemountKey] = useState(0);

  // Settle the engine choice once per session, before the page content mounts.
  // Several surfaces (Explore, the onboarding banner) read the saved cliId
  // synchronously in their OWN mount effect, and React runs child effects
  // before parent effects — so resolving here in a plain effect after `children`
  // already mounted was still too late for a fresh session's first paint.
  // Gating `children` on the resolution (instead of just firing it) guarantees
  // the write lands before those reads run, with no extra network cost: when a
  // choice is already saved, resolveCliId() resolves on the next microtask.
  // A hard timeout opens the gate regardless if /api/clis never responds, so a
  // hung request can't leave the page blank forever — the surfaces behind the
  // gate already have their own "no CLI" fallback for exactly that case. If
  // resolution then finishes late (after the timeout already opened the gate),
  // remount `children` so the surfaces that already rendered on empty storage
  // pick up the value it just persisted, instead of staying stuck.
  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!cancelled) setCliResolved(true);
    }, 3000);
    resolveCliId().then((cliId) => {
      clearTimeout(timeout);
      if (cancelled) return;
      // Only a NEWLY resolved id is worth a remount: null means nothing was
      // persisted (no sole installed CLI, or the request itself failed), so
      // storage is exactly as empty as when the gate opened, and remounting
      // now would just discard whatever the user already typed on the page.
      if (timedOut && cliId) {
        setCliRemountKey((k) => k + 1);
      } else if (!timedOut) {
        setCliResolved(true);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  return (
    <JobsProvider>
      <PipelineProvider>
      <ApplyProvider>
      <ExploreProvider>
      <MobileNav />
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/30 p-4 md:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-1">
            <CoMark size={32} />
            <span className={`${instrumentSerif.className} relative -top-px text-2xl font-normal tracking-tight text-landing`}>
              career-ops
            </span>
          </Link>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon, chip }) => {
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

          <div className="mt-auto space-y-3 pt-4">
            <UsageMeter />
            <div className="flex items-center justify-between px-1">
              <span className={`${instrumentSerif.className} text-sm text-faint`}>local-first · v0</span>
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-x-hidden">
          {cliResolved ? <Fragment key={cliRemountKey}>{children}</Fragment> : null}
        </main>
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
