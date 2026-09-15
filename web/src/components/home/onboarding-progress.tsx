"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Check, Circle, CircleDashed } from "lucide-react";

// The "profile that grows while you talk": a live checklist of the four setup
// prerequisites plus the eight personalization sections, read from the same
// two signals the assistant gets (/api/doctor and /api/personalization) — never
// a parallel notion of "done". Refetches after every confirmed write
// (co-onboarding-changed) and after every finished worker (co-job-done), so a
// section flips to filled the moment its confirm card is accepted.

type Doctor = { available: boolean; onboardingNeeded: boolean; missing: string[] };
type Section = { id: string; heading: string; state: "filled" | "template" | "missing" };

const PREREQS: { key: string; label: string; ask: string }[] = [
  { key: "cv.md", label: "Your CV", ask: "my CV" },
  { key: "config/profile.yml", label: "Profile — target roles, comp, location", ask: "my profile (target roles, comp, location)" },
  { key: "portals.yml", label: "Companies and roles to scan", ask: "the roles and companies to scan" },
];

function hasCli(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId;
  } catch {
    return false;
  }
}

export function OnboardingProgress({ compact = false }: { compact?: boolean }) {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [cli, setCli] = useState(true);

  const refetch = useCallback(() => {
    fetch("/api/doctor").then((r) => r.json()).then(setDoctor).catch(() => {});
    fetch("/api/personalization").then((r) => r.json()).then((d) => setSections(Array.isArray(d.sections) ? d.sections : [])).catch(() => {});
  }, []);

  useEffect(() => {
    setCli(hasCli());
    refetch();
    window.addEventListener("co-onboarding-changed", refetch);
    window.addEventListener("co-job-done", refetch);
    return () => {
      window.removeEventListener("co-onboarding-changed", refetch);
      window.removeEventListener("co-job-done", refetch);
    };
  }, [refetch]);

  if (!doctor || !sections) return null;
  // doctor.available=false means "could not determine" — say nothing rather than guess.
  if (!doctor.available) return null;

  const missing = new Set(doctor.missing);
  const generic = sections.filter((s) => s.state !== "filled");
  const prereqDone = PREREQS.filter((p) => !missing.has(p.key)).length;
  const total = PREREQS.length + sections.length;
  const done = prereqDone + (sections.length - generic.length);
  if (done === total) return null; // fully personalized: the panel has done its job

  const asks = [
    ...PREREQS.filter((p) => missing.has(p.key)).map((p) => p.ask),
    ...(generic.length ? [`my personalization (${generic.map((s) => s.heading.replace(/^## Your /, "").toLowerCase()).join(", ")})`] : []),
  ];
  const kickoff = `Let's finish setting me up. Still to do: ${asks.join("; ")}. Walk me through it like a recruiter building my brief — one or two things at a time, propose what you infer from my CV, and let me confirm each piece. Don't ask for anything already on file.`;

  return (
    <aside className={`rounded-2xl border border-border bg-surface/40 ${compact ? "p-4" : "p-5"}`} aria-label="Setup progress">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Your profile, as it takes shape</h2>
        <span className="font-mono text-xs text-muted">{done}/{total}</span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>

      <ul className="mt-4 space-y-1.5 text-sm">
        {PREREQS.map((p) => (
          <Row key={p.key} state={missing.has(p.key) ? "missing" : "filled"} label={p.label} />
        ))}
        <li className="pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">personalization — what evaluations score against</li>
        {sections.map((s) => (
          <Row key={s.id} state={s.state} label={s.heading.replace(/^## Your /, "")} />
        ))}
      </ul>

      {cli ? (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message: kickoff } }))}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Sparkles className="size-4" /> Continue with the assistant
        </button>
      ) : (
        <p className="mt-4 text-xs text-muted">
          Connect your AI CLI in <a href="/config" className="text-foreground underline-offset-2 hover:underline">Config</a> and the assistant fills this in with you.
        </p>
      )}
    </aside>
  );
}

function Row({ state, label }: { state: "filled" | "template" | "missing"; label: string }) {
  const Icon = state === "filled" ? Check : state === "template" ? CircleDashed : Circle;
  const tone = state === "filled" ? "text-foreground" : "text-muted";
  const hint = state === "template" ? "still the example" : state === "missing" ? "not yet" : "";
  return (
    <li className={`flex items-center gap-2 ${tone}`}>
      <Icon className={`size-3.5 shrink-0 ${state === "filled" ? "text-brand" : "text-faint"}`} aria-hidden />
      <span className="truncate">{label}</span>
      {hint && <span className="ml-auto shrink-0 text-[11px] text-faint">{hint}</span>}
    </li>
  );
}
