"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Play,
  Radar,
  RefreshCw,
  Save,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";

const MODE_OPTIONS = [
  { id: "remote", label: "Distans", detail: "Helt på distans" },
  { id: "hybrid", label: "Hybrid", detail: "Kontor och distans" },
  { id: "onsite", label: "På plats", detail: "Fysisk arbetsplats" },
  { id: "mobile", label: "Mobilt", detail: "Resande eller fältarbete" },
] as const;

const SOURCE_OPTIONS = ["greenhouse", "lever", "ashby", "workday"] as const;

type WorkMode = (typeof MODE_OPTIONS)[number]["id"];
type Source = (typeof SOURCE_OPTIONS)[number];

type Watch = {
  id: string;
  name: string;
  enabled: boolean;
  roles: string[];
  locations: string[];
  workModes: WorkMode[];
  includeKeywords: string[];
  excludeKeywords: string[];
  sources: Source[];
  intervalHours: number;
  minimumScore: number;
  aiEnabled: boolean;
  lastRunAt: string | null;
};

type Offer = {
  title: string;
  company: string;
  location: string;
  url: string;
  date?: string;
  source?: string;
  score: number;
  workModes: WorkMode[];
  reasons: string[];
  aiScore?: number;
  aiReason?: string;
};

type Run = {
  id: string;
  finishedAt: string;
  discovered: number;
  matched: number;
  aiUsed: boolean;
  status: "ok" | "degraded" | "error";
  message: string;
};

type Snapshot = {
  state: { watch: Watch; results: Offer[]; runs: Run[]; updatedAt: string };
  gateway: { reachable: boolean; model: string; models?: string[]; detail: string };
  due: boolean;
  running: boolean;
};

function list(value: string): string[] {
  return Array.from(new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)));
}

function formatTime(value?: string | null): string {
  if (!value) return "Aldrig";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function modeLabel(mode: WorkMode): string {
  return MODE_OPTIONS.find((item) => item.id === mode)?.label || mode;
}

export function AutomationDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [roles, setRoles] = useState("");
  const [locations, setLocations] = useState("");
  const [includes, setIncludes] = useState("");
  const [excludes, setExcludes] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | "running" | "adding" | null>("loading");
  const [notice, setNotice] = useState("");

  const applySnapshot = useCallback((next: Snapshot) => {
    setSnapshot(next);
    setWatch(next.state.watch);
    setRoles(next.state.watch.roles.join(", "));
    setLocations(next.state.watch.locations.join(", "));
    setIncludes(next.state.watch.includeKeywords.join(", "));
    setExcludes(next.state.watch.excludeKeywords.join(", "));
  }, []);

  const load = useCallback(async () => {
    setBusy("loading");
    try {
      const response = await fetch("/api/automation", { cache: "no-store" });
      if (!response.ok) throw new Error("Kunde inte läsa bevakningen.");
      applySnapshot((await response.json()) as Snapshot);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kunde inte läsa bevakningen.");
    } finally {
      setBusy(null);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft = useMemo<Watch | null>(() => watch ? {
    ...watch,
    roles: list(roles),
    locations: list(locations),
    includeKeywords: list(includes),
    excludeKeywords: list(excludes),
  } : null, [watch, roles, locations, includes, excludes]);

  async function save(showNotice = true): Promise<boolean> {
    if (!draft) return false;
    setBusy("saving");
    try {
      const response = await fetch("/api/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json() as { ok?: boolean; state?: Snapshot["state"]; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error || "Kunde inte spara.");
      setSnapshot((current) => current ? { ...current, state: payload.state! } : current);
      setWatch(payload.state.watch);
      if (showNotice) setNotice("Bevakningen är sparad.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kunde inte spara.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!(await save(false))) return;
    setBusy("running");
    setNotice("Söker på godkända ATS-källor och rankar matchningar …");
    try {
      const response = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", force: true }),
      });
      const payload = await response.json() as { state?: Snapshot["state"]; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error || "Körningen misslyckades.");
      setSnapshot((current) => current ? { ...current, state: payload.state!, due: false, running: false } : current);
      setWatch(payload.state.watch);
      const latest = payload.state.runs[0];
      setNotice(latest?.message || "Bevakningen är klar.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Körningen misslyckades.");
    } finally {
      setBusy(null);
    }
  }

  async function addToPipeline(offer: Offer) {
    setBusy("adding");
    try {
      const response = await fetch("/api/explore/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offers: [{
          url: offer.url,
          company: offer.company,
          title: offer.title,
          location: offer.location,
          postedAt: offer.date || "",
          ats: offer.source || "automation",
          source: offer.source || "automation",
          reason: offer.aiReason || offer.reasons.join(" · "),
        }] }),
      });
      const payload = await response.json() as { added?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Kunde inte lägga till jobbet.");
      setNotice(payload.added ? `${offer.title} lades till i din pipeline.` : "Jobbet finns redan i din pipeline.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kunde inte lägga till jobbet.");
    } finally {
      setBusy(null);
    }
  }

  function toggleMode(mode: WorkMode) {
    if (!watch) return;
    setWatch({ ...watch, workModes: watch.workModes.includes(mode)
      ? watch.workModes.filter((item) => item !== mode)
      : [...watch.workModes, mode] });
  }

  function toggleSource(source: Source) {
    if (!watch) return;
    setWatch({ ...watch, sources: watch.sources.includes(source)
      ? watch.sources.filter((item) => item !== source)
      : [...watch.sources, source] });
  }

  if (!watch || !snapshot) {
    return <main className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center px-6"><LoaderCircle className="h-6 w-6 animate-spin text-[var(--muted)]" /></main>;
  }

  const latestRun = snapshot.state.runs[0];
  const running = busy === "running";

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:p-8">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              <Radar className="h-4 w-4" /> SJÄLVGÅENDE JOBBMOTOR
            </div>
            <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Dina jobb, bevakade automatiskt.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
              Career-Ops söker tillåtna ATS-källor, filtrerar efter hur du vill arbeta och använder OmniRoute för att prioritera de starkaste matchningarna.
            </p>
          </div>
          <div className="grid min-w-64 grid-cols-2 gap-3">
            <StatusCard icon={snapshot.gateway.reachable ? Wifi : WifiOff} label="OmniRoute" value={snapshot.gateway.reachable ? "Ansluten" : "Degraderad"} tone={snapshot.gateway.reachable ? "good" : "warn"} />
            <StatusCard icon={Clock3} label="Senaste körning" value={watch.lastRunAt ? formatTime(watch.lastRunAt) : "Inte körd"} />
          </div>
        </div>
      </section>

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-[var(--muted)] hover:text-[var(--foreground)]">Stäng</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="space-y-5 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Bevakningsprofil</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Sparas lokalt på din Mac.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={watch.enabled} onChange={(event) => setWatch({ ...watch, enabled: event.target.checked })} /> Aktiv
            </label>
          </div>

          <Field label="Målroller" hint="Separera med komma">
            <input value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="AI Engineer, Platform Engineer" className="input-base" />
          </Field>
          <Field label="Platser" hint="Distans kan kombineras med länder eller städer">
            <input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Sverige, Stockholm, Göteborg" className="input-base" />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Så vill jag arbeta</legend>
            <div className="grid grid-cols-2 gap-2">
              {MODE_OPTIONS.map((mode) => {
                const active = watch.workModes.includes(mode.id);
                return (
                  <button key={mode.id} type="button" onClick={() => toggleMode(mode.id)} className={`rounded-xl border p-3 text-left transition ${active ? "border-emerald-500 bg-emerald-500/10" : "border-[var(--border)] hover:bg-[var(--surface-hover)]"}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold">{active && <Check className="h-3.5 w-3.5" />}{mode.label}</span>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">{mode.detail}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field label="Önskade nyckelord">
            <input value={includes} onChange={(event) => setIncludes(event.target.value)} placeholder="Python, AI, platform" className="input-base" />
          </Field>
          <Field label="Ord att undvika">
            <input value={excludes} onChange={(event) => setExcludes(event.target.value)} placeholder="praktik, unpaid" className="input-base" />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Jobbkällor</legend>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map((source) => (
                <button key={source} type="button" onClick={() => toggleSource(source)} className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize ${watch.sources.includes(source) ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-[var(--border)] text-[var(--muted)]"}`}>{source}</button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kör varje">
              <select value={watch.intervalHours} onChange={(event) => setWatch({ ...watch, intervalHours: Number(event.target.value) })} className="input-base">
                <option value={1}>Varje timme</option><option value={6}>Var 6:e timme</option><option value={12}>Var 12:e timme</option><option value={24}>Varje dag</option><option value={168}>Varje vecka</option>
              </select>
            </Field>
            <Field label="Minsta matchning">
              <select value={watch.minimumScore} onChange={(event) => setWatch({ ...watch, minimumScore: Number(event.target.value) })} className="input-base">
                <option value={30}>Bred · 30</option><option value={45}>Balanserad · 45</option><option value={60}>Strikt · 60</option><option value={75}>Mycket strikt · 75</option>
              </select>
            </Field>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] p-3">
            <input type="checkbox" className="mt-1" checked={watch.aiEnabled} onChange={(event) => setWatch({ ...watch, aiEnabled: event.target.checked })} />
            <span><span className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" /> AI-prioritering via OmniRoute</span><span className="mt-1 block text-xs text-[var(--muted)]">Faller automatiskt tillbaka till lokal matchning om en extern modell är tillfälligt otillgänglig.</span></span>
          </label>

          <div className="flex gap-2 pt-1">
            <button onClick={() => void save()} disabled={!!busy} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--surface-hover)] disabled:opacity-50"><Save className="h-4 w-4" /> Spara</button>
            <button onClick={() => void runNow()} disabled={!!busy || watch.roles.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-sm font-semibold text-[var(--background)] disabled:opacity-50">{running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Kör nu</button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Hittade" value={latestRun?.discovered ?? 0} icon={Radar} />
            <Metric label="Matchningar" value={snapshot.state.results.length} icon={BriefcaseBusiness} />
            <Metric label="AI-rankade" value={latestRun?.aiUsed ? snapshot.state.results.length : 0} icon={Bot} />
          </div>

          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-5">
              <div><h2 className="font-semibold">Prioriterade jobb</h2><p className="mt-1 text-xs text-[var(--muted)]">{snapshot.state.results.length ? `Sorterade efter matchning · ${formatTime(watch.lastRunAt)}` : "Kör bevakningen för att hitta matchningar."}</p></div>
              <button onClick={() => void load()} disabled={!!busy} title="Uppdatera" className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]"><RefreshCw className={`h-4 w-4 ${busy === "loading" ? "animate-spin" : ""}`} /></button>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {snapshot.state.results.length === 0 ? (
                <div className="px-6 py-16 text-center"><Radar className="mx-auto h-8 w-8 text-[var(--muted)]" /><p className="mt-3 font-medium">Inga resultat ännu</p><p className="mt-1 text-sm text-[var(--muted)]">Kontrollera målroller och källor, spara och välj Kör nu.</p></div>
              ) : snapshot.state.results.map((offer) => (
                <article key={offer.url} className="p-5 transition hover:bg-[var(--surface-hover)]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{offer.aiScore ?? offer.score}% match</span>
                        {offer.aiScore != null && <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">OmniRoute</span>}
                        {offer.workModes.map((mode) => <span key={mode} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">{modeLabel(mode)}</span>)}
                      </div>
                      <h3 className="mt-3 text-lg font-semibold">{offer.title}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">{offer.company} · <MapPin className="inline h-3.5 w-3.5" /> {offer.location || "Plats ej angiven"}</p>
                      <p className="mt-3 text-sm leading-6">{offer.aiReason || offer.reasons.slice(0, 3).join(" · ")}</p>
                      <p className="mt-2 text-xs text-[var(--muted)]">{offer.source || "ATS"}{offer.date ? ` · Publicerad ${offer.date}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => void addToPipeline(offer)} disabled={!!busy} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface)] disabled:opacity-50">Till pipeline</button>
                      <a href={offer.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-semibold text-[var(--background)]">Öppna <ExternalLink className="h-3.5 w-3.5" /></a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {latestRun && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold"><span className={`h-2 w-2 rounded-full ${latestRun.status === "ok" ? "bg-emerald-500" : latestRun.status === "degraded" ? "bg-amber-500" : "bg-red-500"}`} /> Senaste körningen</div>
              <p className="mt-2 text-[var(--muted)]">{latestRun.message}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="flex items-baseline justify-between text-sm font-medium">{label}{hint && <span className="text-[10px] font-normal text-[var(--muted)]">{hint}</span>}</span><span className="mt-2 block">{children}</span></label>;
}

function StatusCard({ icon: Icon, label, value, tone = "default" }: { icon: typeof Wifi; label: string; value: string; tone?: "default" | "good" | "warn" }) {
  return <div className="rounded-2xl border border-[var(--border)] p-4"><Icon className={`h-4 w-4 ${tone === "good" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "text-[var(--muted)]"}`} /><p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="mt-1 text-xs font-semibold">{value}</p></div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Radar }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><Icon className="h-4 w-4 text-[var(--muted)]" /><p className="mt-3 text-2xl font-semibold">{value}</p><p className="text-xs text-[var(--muted)]">{label}</p></div>;
}
