"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CircleHelp, Sparkles, ArrowRight } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { HeroGlow } from "@/components/hero-glow";
import type { Application, InboxJob } from "@/lib/career-ops";
import type { DiscoveredOffer } from "@/lib/explore";
import { DiscoveryCard } from "@/components/explore/discovery-card";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";
import { DecisionCard } from "@/components/home/decision-card";
import { QuickEvaluate } from "@/components/quick-evaluate";
import { scoreNum } from "@/lib/format";
import { pickAwaitingDecision } from "@/lib/home/awaiting.mjs";
import { parseTodayFollowups, parseTodayMatches, pendingInboxCount, summarizeToday } from "@/lib/home/today-state.mjs";

type LoadState = { status: "loading" | "ready" | "error"; error: string | null };

// The retention "Today": a dual-loop action queue (the maintainer's
// "N new matches this week · M follow-ups due"). SUPPLY loop = fresh free-scan
// matches (zero tokens, /api/whats-new); DEMAND loop = follow-ups due
// (/api/followups). Each item one-tap actionable. Home stays a VIEW over the
// canonical files — every action dispatches a real registry action / route.
export function TodayDashboard({
  applications,
  inbox,
  inBetween,
}: {
  applications: Application[];
  inbox: Pick<InboxJob, "url" | "done">[];
  inBetween: boolean;
}) {
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [nextUpcoming, setNextUpcoming] = useState<FollowUp | null>(null);
  const [fresh, setFresh] = useState<DiscoveredOffer[]>([]);
  const [freshCount, setFreshCount] = useState(0);
  const [followupState, setFollowupState] = useState<LoadState>({ status: "loading", error: null });
  const [freshState, setFreshState] = useState<LoadState>({ status: "loading", error: null });
  const activeRequest = useRef<AbortController | null>(null);
  const router = useRouter();
  const dateLabel = useMemo(() => new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }), []);

  const refetch = useCallback(() => {
    // An earlier request can finish after a worker event or a saved follow-up.
    // Cancel it and check its signal before applying any result or error.
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const { signal } = controller;
    setFollowupState({ status: "loading", error: null });
    setFreshState({ status: "loading", error: null });
    fetch("/api/followups", { signal, cache: "no-store" })
      .then(async (r) => parseTodayFollowups(r.ok, await r.json().catch(() => null)))
      .then((data) => {
        if (signal.aborted) return;
        setFollowups(data.entries);
        setOverdue(data.due);
        setNextUpcoming(data.nextUpcoming);
        setFollowupState({ status: "ready", error: null });
      })
      .catch((error) => {
        if (signal.aborted) return;
        setFollowupState({ status: "error", error: error instanceof TypeError ? "Could not reach the server. Check your connection and retry." : error instanceof Error ? error.message : "Could not load follow-ups." });
      });
    fetch("/api/whats-new", { signal, cache: "no-store" })
      .then(async (r) => parseTodayMatches(r.ok, await r.json().catch(() => null)))
      .then((data) => {
        if (signal.aborted) return;
        setFresh(data.offers);
        setFreshCount(data.count);
        setFreshState({ status: "ready", error: null });
      })
      .catch((error) => {
        if (signal.aborted) return;
        setFreshState({ status: "error", error: error instanceof TypeError ? "Could not reach the server. Check your connection and retry." : error instanceof Error ? error.message : "Could not load fresh matches." });
      });
  }, []);

  useEffect(() => {
    refetch();
    // A worker (evaluate/pdf) just wrote a real tracker row — refresh the server
    // snapshot (applications/inbox props) + the client loops so the freshly-scored
    // role appears in "Awaiting your decision" without a manual reload.
    const onDone = () => {
      router.refresh();
      refetch();
    };
    window.addEventListener("co-job-done", onDone);
    return () => {
      window.removeEventListener("co-job-done", onDone);
      activeRequest.current?.abort();
    };
  }, [refetch, router]);

  // Awaiting decision: scored (Evaluated) but no terminal status yet. The
  // ordering lives in lib/home/awaiting.mjs so it can be tested — see the file
  // for why "first six in the array" was a bug waiting for #3529.
  const awaiting = useMemo(() => pickAwaitingDecision(applications, scoreNum, Infinity), [applications]);

  const pendingCount = useMemo(() => pendingInboxCount(inbox), [inbox]);
  const summary = summarizeToday({
    freshCount,
    // The route returns only due entries. Metadata can be absent, but a
    // visible due card still means there is work to do.
    dueCount: Math.max(overdue, followups.length),
    decisionCount: awaiting.length,
    inboxCount: pendingCount,
    followupState: followupState.status,
    freshState: freshState.status,
  });
  const { allClear } = summary;
  const inboxUrls = useMemo(() => new Set(inbox.map((j) => j.url)), [inbox]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24">
      <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <HeroGlow />
        {/* Readability scrim between the animated glow (z-0) and the copy (z-10). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-surface/55 backdrop-blur-[2px] dark:bg-background/45" />
        <div className="relative z-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            <span className="text-faint">//</span> today · <span className="tabular-nums">{dateLabel}</span>
          </p>
          <h1 className={`${instrumentSerif.className} mt-3 text-4xl leading-[1.05] text-landing md:text-5xl`}>
            {summary.items.length ? summary.items.map((item, index) => (
              <Fragment key={item.label}>
                {index > 0 && <span className="text-faint"> · </span>}
                <span className="text-brand tabular-nums">{item.count}</span>{" "}{item.label}
              </Fragment>
            )) : summary.emptyHeading}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted">
            {allClear ? "Run a free scan when you want to find more roles." : "Review jobs, make application decisions, and track follow-ups in one place."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/explore" className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]">
              Find new roles <ArrowRight className="size-4" />
            </Link>
            <Link href="/pipeline" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]">
              {pendingCount > 0 ? `Review inbox (${pendingCount})` : "Open pipeline"}
            </Link>
          </div>
          {inBetween && <QuickEvaluate />}
        </div>
      </section>

      <LoadNotice label="Follow-ups" state={followupState} onRetry={refetch} />
      <LoadNotice label="Fresh matches" state={freshState} onRetry={refetch} />

      {/* A. Follow-ups due (demand loop) */}
      {followups.length > 0 ? (
        <Section icon={Bell} title="Follow-ups due" hint="Keep your applications alive — a nudge beats silence">
          <div className="grid gap-2.5">
            {followups.map((f) => (
              // Refetch (not a local decrement) so the parent's followups/nextUpcoming
              // stay in sync with the server — logging the LAST due item must flip this
              // section over to "Next follow-up" instead of leaving it empty.
              <FollowUpCard key={`${f.num}-${f.company}`} followup={f} onLogged={refetch} />
            ))}
          </div>
        </Section>
      ) : (
        nextUpcoming && (
          // Nothing is due — say so honestly instead of an empty "due" block,
          // but still surface what's next so the queue isn't silent (#86).
          <Section icon={Bell} title="Next follow-up" hint="Nothing due yet">
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">{nextUpcoming.company}</span>
              {nextUpcoming.role && <span> · {nextUpcoming.role}</span>}
              {nextUpcoming.nextFollowupDate && <span className="text-faint"> — upcoming {nextUpcoming.nextFollowupDate}</span>}
            </p>
          </Section>
        )
      )}

      {/* B. Awaiting your decision */}
      {awaiting.length > 0 && (
        <Section icon={CircleHelp} title="Awaiting your decision" hint="Scored — apply or skip">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {awaiting.slice(0, 6).map((a) => (
              <DecisionCard key={a.n} app={a} onSaved={refetch} />
            ))}
          </div>
          {awaiting.length > 6 && <Link href="/pipeline?tab=EVALUATED" className="mt-3 inline-flex text-sm text-muted hover:text-brand max-sm:min-h-[44px]">Review all {awaiting.length} decisions →</Link>}
        </Section>
      )}

      {/* C. Fresh matches this week (supply loop) */}
      {fresh.length > 0 && (
        <Section icon={Sparkles} title="Fresh matches this week" hint="Found by your free scans · 0 tokens">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fresh.slice(0, 6).map((o) => (
              <DiscoveryCard key={o.url} offer={o} inPipeline={inboxUrls.has(o.url)} />
            ))}
          </div>
          {fresh.length > 6 && (
            <Link href="/explore?view=fresh" className="mt-3 inline-flex items-center text-sm text-muted transition hover:text-brand max-sm:min-h-[44px]">
              See all {freshCount} →
            </Link>
          )}
        </Section>
      )}

      {allClear && (
        <div className="mt-8 rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
          <Sparkles className="mx-auto size-6 text-brand" />
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Nothing needs you right now. Run a <Link href="/explore" className="text-brand hover:underline">free scan</Link> to surface this week&apos;s roles, or check your <Link href="/pipeline" className="text-brand hover:underline">pipeline</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function LoadNotice({ label, state, onRetry }: { label: string; state: LoadState; onRetry: () => void }) {
  if (state.status === "ready") return null;
  if (state.status === "loading") return <p role="status" className="mt-4 text-sm text-muted">Checking {label.toLowerCase()}…</p>;
  return (
    <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/25 bg-surface/40 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{label} could not be updated.</p>
        <p className="mt-1 text-muted">{state.error} Any items shown may be out of date.</p>
      </div>
      <button type="button" onClick={onRetry} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:text-brand max-sm:min-h-[44px]">Retry {label.toLowerCase()}</button>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
        <span className="text-xs text-faint">· {hint}</span>
      </div>
      {children}
    </section>
  );
}
