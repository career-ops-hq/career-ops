"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CircleHelp, Search, ArrowRight } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import type { Application, InboxJob } from "@/lib/career-ops";
import type { DiscoveredOffer } from "@/lib/explore";
import { DiscoveryCard } from "@/components/explore/discovery-card";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";
import { DecisionCard } from "@/components/home/decision-card";
import { QuickEvaluate } from "@/components/quick-evaluate";
import { scoreNum } from "@/lib/format";
import { PT_PT_LOCALE } from "@/lib/pt-pt";
import { pickAwaitingDecision } from "@/lib/home/awaiting.mjs";

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
  const router = useRouter();
  const dateLabel = useMemo(() => new Date().toLocaleDateString(PT_PT_LOCALE, { weekday: "long", day: "numeric", month: "short" }), []);

  const refetch = useCallback(() => {
    fetch("/api/followups")
      .then((r) => r.json())
      .then((d) => {
        // /api/followups already filters to urgency 'urgent'/'overdue' — due
        // now, never 'waiting'/'cold' (#86). Both count toward "due"; a
        // missing metadata.overdue must read as 0 due, never as "every entry
        // is overdue" (the old `?? d.entries?.length` fallback).
        setFollowups(Array.isArray(d.entries) ? d.entries : []);
        setOverdue((d.metadata?.overdue ?? 0) + (d.metadata?.urgent ?? 0));
        setNextUpcoming(d.nextUpcoming ?? null);
      })
      .catch(() => {});
    fetch("/api/whats-new")
      .then((r) => r.json())
      .then((d) => {
        const offers = Array.isArray(d.offers) ? d.offers : [];
        const count = Number(d.count);
        setFresh(offers);
        setFreshCount(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : offers.length);
      })
      .catch(() => {});
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
    return () => window.removeEventListener("co-job-done", onDone);
  }, [refetch, router]);

  // Awaiting decision: scored (Evaluated) but no terminal status yet. The
  // ordering lives in lib/home/awaiting.mjs so it can be tested — see the file
  // for why "first six in the array" was a bug waiting for #3529.
  const awaiting = useMemo(() => pickAwaitingDecision(applications, scoreNum), [applications]);
  const awaitingCount = applications.length; // todaySnapshot keeps every pending decision.

  const newThisWeek = freshCount;
  const allClear = newThisWeek === 0 && overdue === 0 && awaitingCount === 0;
  const inboxUrls = useMemo(() => new Set(inbox.map((j) => j.url)), [inbox]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24">
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <div>
          <p className="text-sm text-muted"><span className="tabular-nums">{dateLabel}</span></p>
          <h1 className={`${instrumentSerif.className} mt-3 text-4xl leading-[1.05] text-landing md:text-5xl`}>
            {allClear ? (
              <>Está tudo em dia.</>
            ) : (
              <>
                {newThisWeek > 0 && (
                  <>
                    <span className="text-brand tabular-nums">{newThisWeek}</span> {newThisWeek === 1 ? "oferta nova" : "ofertas novas"} esta semana
                  </>
                )}
                {newThisWeek > 0 && overdue > 0 && <span className="text-faint"> · </span>}
                {overdue > 0 && (
                  <>
                    <span className="text-brand tabular-nums">{overdue}</span> {overdue === 1 ? "acompanhamento pendente" : "acompanhamentos pendentes"}
                  </>
                )}
                {newThisWeek === 0 && overdue === 0 && awaitingCount > 0 && (
                  <>
                    <span className="text-brand tabular-nums">{awaitingCount}</span> {awaitingCount === 1 ? "decisão pendente" : "decisões pendentes"}
                  </>
                )}
              </>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted">
            {allClear ? "Não há ações pendentes. Podes procurar novas ofertas ou rever as candidaturas quando quiseres." : "As ações de hoje, ordenadas num só lugar."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/explore" className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]">
              Procurar ofertas <ArrowRight className="size-4" />
            </Link>
            <Link href="/pipeline" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]">
              Ver candidaturas
            </Link>
          </div>
          {inBetween && <QuickEvaluate />}
        </div>
      </section>

      {/* A. Follow-ups due (demand loop) */}
      {followups.length > 0 ? (
        <Section icon={Bell} title="Acompanhamentos pendentes" hint="Contactos que já estão no prazo">
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
          <Section icon={Bell} title="Próximo acompanhamento" hint="Ainda não está em atraso">
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">{nextUpcoming.company}</span>
              {nextUpcoming.role && <span> · {nextUpcoming.role}</span>}
              {nextUpcoming.nextFollowupDate && <span className="text-faint"> — previsto para {nextUpcoming.nextFollowupDate}</span>}
            </p>
          </Section>
        )
      )}

      {/* B. Awaiting your decision */}
      {awaiting.length > 0 && (
        <Section icon={CircleHelp} title="À espera da tua decisão" hint="Candidatar ou retirar da lista">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {awaiting.map((a) => (
              <DecisionCard key={a.n} app={a} />
            ))}
          </div>
        </Section>
      )}

      {/* C. Fresh matches this week (supply loop) */}
      {fresh.length > 0 && (
        <Section icon={Search} title="Ofertas novas esta semana" hint="Encontradas sem usar tokens">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fresh.slice(0, 6).map((o) => (
              <DiscoveryCard key={o.url} offer={o} inPipeline={inboxUrls.has(o.url)} />
            ))}
          </div>
          {fresh.length > 6 && (
            <Link href="/explore?view=fresh" className="mt-3 inline-flex items-center text-sm text-muted transition hover:text-brand max-sm:min-h-[44px]">
              Ver todas ({freshCount}) →
            </Link>
          )}
        </Section>
      )}

      {allClear && (
        <div className="mt-8 border-t border-border px-6 py-8 text-center">
          <p className="mx-auto max-w-md text-sm text-muted">
            Não tens ações pendentes. Podes <Link href="/explore" className="text-brand hover:underline">procurar novas ofertas</Link> ou rever as <Link href="/pipeline" className="text-brand hover:underline">candidaturas</Link>.
          </p>
        </div>
      )}
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
