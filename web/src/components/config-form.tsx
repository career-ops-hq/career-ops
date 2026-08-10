"use client";

import { useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  TerminalSquare,
  Terminal,
  Loader2,
  CircleDashed,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CONFIG_CHANGED_EVENT, CONFIG_KEY, patchClientConfig, readConfiguredCli } from "@/lib/client-config.mjs";
import { CadenceSettings } from "@/components/followups/cadence-settings";

type Cli = {
  id: string;
  name: string;
  run: string;
  url: string;
  installed: boolean;
  path: string | null;
};

type Mode = "cli" | "key" | "manual";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

export function ConfigForm() {
  const [mode, setMode] = useState<Mode>("cli");
  const [clis, setClis] = useState<Cli[] | null>(null);
  const [cliId, setCliId] = useState<string>("");
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [logos, setLogos] = useState(true);
  const [saved, setSaved] = useState(false);

  // Profile states
  const [country, setCountry] = useState("");
  const [authorizedIn, setAuthorizedIn] = useState("");
  const [preferences, setPreferences] = useState("");
  // Location filter — these write directly to portals.yml (the scanner reads from there)
  const [locationAllow, setLocationAllow] = useState<string[]>([]);
  const [locationInput, setLocationInput] = useState("");
  const [locationBlock, setLocationBlock] = useState<string[]>([]);
  const [locationBlockInput, setLocationBlockInput] = useState("");
  const [blockInput, setBlockInput] = useState("");

  // Load saved profile
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.location?.country) setCountry(d.location.country);
        if (d.location?.authorized_in) setAuthorizedIn(d.location.authorized_in.join(", "));
        if (d.culture_screen?.require) setPreferences(d.culture_screen.require.join("\n"));
      })
      .catch(() => {});
  }, []);

  // Load portals location filter
  useEffect(() => {
    fetch("/api/portals")
      .then((r) => r.json())
      .then((d) => {
        if (d.location_filter?.allow) setLocationAllow(d.location_filter.allow);
        if (d.location_filter?.block) setLocationBlock(d.location_filter.block);
      })
      .catch(() => {});
  }, []);

  // Load saved prefs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        // key/manual are not wired yet (nothing reads them) → never restore into
        // those dead panels; only the Installed-CLI path is functional.
        if (v.mode === "cli") setMode("cli");
        if (v.cliId) setCliId(v.cliId);
        if (v.provider) setProvider(v.provider);
        if (typeof v.logos === "boolean") setLogos(v.logos);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Detect installed CLIs
  useEffect(() => {
    fetch("/api/clis")
      .then((r) => r.json())
      .then((d) => {
        const list: Cli[] = d.clis ?? [];
        setClis(list);
        const savedCli = readConfiguredCli(localStorage.getItem(CONFIG_KEY));
        const savedIsInstalled = !!savedCli && list.some((c) => c.installed && c.id === savedCli);
        const nextCli = savedIsInstalled ? savedCli : list.find((c) => c.installed)?.id || "";
        setCliId(nextCli);
        // A visible auto-selection must be real, not cosmetic. Persist it and
        // notify the persistent assistant mounted outside this page.
        if (nextCli && nextCli !== savedCli) {
          localStorage.setItem(
            CONFIG_KEY,
            patchClientConfig(localStorage.getItem(CONFIG_KEY), { mode: "cli", cliId: nextCli }),
          );
          window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT));
        }
      })
      .catch(() => setClis([]));
  }, []);

  function save() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ mode, cliId, provider, logos }));
    window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT));

    // Save profile.yml (country, authorized_in, culture_screen)
    fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: country.trim() || undefined,
        authorizedIn: authorizedIn ? authorizedIn.split(",").map(s => s.trim()).filter(Boolean) : undefined,
        preferences: preferences ? preferences.split("\n").map(s => s.trim()).filter(Boolean) : undefined
      })
    }).catch(console.error);

    // Save portals.yml location_filter (this is what the scanner actually reads)
    fetch("/api/portals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: locationAllow,
        block: locationBlock,
      })
    }).catch(console.error);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function selectCli(nextCliId: string) {
    setCliId(nextCliId);
    // Selecting an installed CLI should enable the persistent assistant
    // immediately. The native storage event only fires in OTHER tabs, so emit a
    // same-tab event as well.
    const next = patchClientConfig(localStorage.getItem(CONFIG_KEY), { mode: "cli", cliId: nextCliId });
    localStorage.setItem(CONFIG_KEY, next);
    window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT));
  }

  const installed = clis?.filter((c) => c.installed) ?? [];

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-2xl tracking-tight text-landing">Config</h1>
      <p className="mt-1 text-sm text-muted">
        Run career-ops on your own AI, right on your computer. Your CV and data never leave your machine.
      </p>

      {/* Engine mode */}
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        AI Engine
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <ModeCard
          active={mode === "cli"}
          onClick={() => setMode("cli")}
          icon={Terminal}
          title="Use an AI tool you have"
          hint="Recommended"
        />
        <ModeCard
          active={mode === "key"}
          onClick={() => setMode("key")}
          icon={KeyRound}
          title="Paste an AI key"
          hint="Coming soon"
          disabled
        />
        <ModeCard
          active={mode === "manual"}
          onClick={() => setMode("manual")}
          icon={TerminalSquare}
          title="No setup needed"
          hint="Coming soon"
          disabled
        />
      </div>

      <div className="mt-6">
        {mode === "cli" && (
          <div>
            <p className="mb-1 text-sm text-muted">
              career-ops uses an AI tool you already have — signed in, your own usage, nothing to paste.
            </p>
            <p className="mb-3 text-xs text-faint">Works with Claude Code, Codex, OpenCode and more — free ones work great.</p>
            {clis === null ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> Checking what&apos;s on your computer…
              </div>
            ) : installed.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
                No AI tool yet? Free options like <span className="text-foreground">OpenCode</span> with Qwen or GLM work great.{" "}
                <a href="https://career-ops.org/docs/free-ai-engine" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                  Get one free <ExternalLink className="size-3" />
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                {clis.map((c) => {
                  const selected = c.id === cliId;
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                        selected
                          ? "border-brand/50 bg-brand-soft"
                          : c.installed
                            ? "border-border bg-surface/50"
                            : "border-border/60 bg-surface/20",
                      )}
                    >
                      {c.installed ? (
                        <Check className="size-4 shrink-0 text-emerald-400" />
                      ) : (
                        <CircleDashed className="size-4 shrink-0 text-faint" />
                      )}
                      <button
                        type="button"
                        disabled={!c.installed}
                        onClick={() => selectCli(c.id)}
                        className={cn(
                          "flex flex-1 items-center gap-2 text-left max-sm:min-h-[44px]",
                          c.installed ? "" : "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "font-medium",
                            selected ? "text-foreground" : c.installed ? "" : "text-muted",
                          )}
                        >
                          {c.name}
                        </span>
                        <span className="font-mono text-xs text-faint">{c.run}</span>
                      </button>
                      {c.installed ? (
                        <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-faint sm:block">
                          {c.path}
                        </span>
                      ) : (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center justify-center gap-1 text-xs text-brand hover:underline max-sm:min-h-[44px]"
                        >
                          Install <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
                {installed.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-xs text-muted">
                    No supported CLI found on your PATH. Install one (e.g. Claude Code, Gemini CLI, OpenCode) to get started.
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Best on <span className="text-muted">Claude Code</span> (live progress, the agentic apply + AI search,
                  reliable evaluation persistence). Other CLIs work for the core flows with reduced features.
                </p>
              </div>
            )}
          </div>
        )}

        {mode === "key" && (
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                Provider
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={cn(
                      "rounded-xl border px-4 py-2.5 text-left text-sm transition-colors",
                      provider === p.id
                        ? "border-brand/50 bg-brand-soft text-foreground"
                        : "border-border bg-surface/50 text-muted hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                Paste an AI key
              </label>
              <p className="mb-2 text-xs text-faint">Bring a key from OpenAI, Anthropic, and others.</p>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className="w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
              />
              <p className="mt-2 text-xs text-faint">
                Stored only in this browser — never sent anywhere but your chosen provider.
              </p>
            </div>
          </div>
        )}

        {mode === "manual" && (
          <div className="rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
            The easiest way in — no keys, nothing to set up. On the roadmap.
          </div>
        )}
      </div>

      {/* Appearance / privacy */}
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Appearance
      </label>
      <button
        type="button"
        onClick={() => setLogos((v) => !v)}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface/50 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Company logos</span>
          <span className="mt-0.5 block text-xs text-faint">
            Show each company&apos;s real logo. Fetched once through your local server and cached on
            disk — only the employer domain is sent to a third party. Off = colored monograms only.
          </span>
        </span>
        <span
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            logos ? "bg-brand" : "bg-surface-hover",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
              logos ? "translate-x-[1.375rem]" : "translate-x-0.5",
            )}
          />
        </span>
      </button>

      {/* Profile & Location Filters */}
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Dónde buscar
      </label>
      <div className="space-y-5 rounded-xl border border-border bg-surface/50 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">País de Residencia</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Ej: Colombia"
              className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Autorizado para trabajar en</label>
            <input
              type="text"
              value={authorizedIn}
              onChange={(e) => setAuthorizedIn(e.target.value)}
              placeholder="Ej: Colombia, United States"
              className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/50"
            />
            <p className="mt-1 text-[11px] text-faint">Países separados por coma. Penaliza roles que no contraten aquí.</p>
          </div>
        </div>

        {/* Location allow chips */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Ubicaciones permitidas en el escáner
          </label>
          <p className="mb-2 text-[11px] text-faint">
            El escáner sólo mostrará vacantes cuya ubicación contenga alguno de estos términos. Añade Ciudad, País, &quot;Remote&quot;, &quot;LATAM&quot;, etc.
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {Array.from(new Set(locationAllow)).map((loc) => (
              <span key={loc} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                {loc}
                <button type="button" aria-label={`Quitar ${loc}`} onClick={() => setLocationAllow(locationAllow.filter(l => l !== loc))} className="ml-0.5 opacity-60 hover:opacity-100">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && locationInput.trim()) {
                  e.preventDefault();
                  const val = locationInput.trim().replace(/,$/, "");
                  if (val && !locationAllow.includes(val)) setLocationAllow([...locationAllow, val]);
                  setLocationInput("");
                }
              }}
              placeholder="Colombia, Cali, Remote, LATAM…"
              className="flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/50"
            />
            <button
              type="button"
              onClick={() => {
                const val = locationInput.trim().replace(/,$/, "");
                if (val && !locationAllow.includes(val)) setLocationAllow([...locationAllow, val]);
                setLocationInput("");
              }}
              className="rounded-lg border border-border bg-surface/50 px-3 py-2 text-sm hover:bg-surface-hover"
            >
              Añadir
            </button>
          </div>
          {/* Quick-add suggestions */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["Colombia", "Cali", "Bogotá", "Medellín", "Remote", "LATAM", "Worldwide"].filter(s => !locationAllow.includes(s)).map(s => (
              <button key={s} type="button" onClick={() => setLocationAllow([...locationAllow, s])}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:border-brand/40 hover:text-brand">
                + {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Ubicaciones bloqueadas
          </label>
          <p className="mb-2 text-[11px] text-faint">
            Cualquier vacante cuya ubicación contenga alguna de estas palabras será descartada.
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {Array.from(new Set(locationBlock)).map((loc) => (
              <span key={loc} className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">
                {loc}
                <button type="button" aria-label={`Quitar ${loc}`} onClick={() => setLocationBlock(locationBlock.filter(l => l !== loc))} className="ml-0.5 opacity-60 hover:opacity-100">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={locationBlockInput}
              onChange={(e) => setLocationBlockInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && locationBlockInput.trim()) {
                  e.preventDefault();
                  const val = locationBlockInput.trim().replace(/,$/, "");
                  if (val && !locationBlock.includes(val)) setLocationBlock([...locationBlock, val]);
                  setLocationBlockInput("");
                }
              }}
              placeholder="US, USA, Europe, San Francisco…"
              className="flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-red-500/50"
            />
            <button
              type="button"
              onClick={() => {
                const val = locationBlockInput.trim().replace(/,$/, "");
                if (val && !locationBlock.includes(val)) setLocationBlock([...locationBlock, val]);
                setLocationBlockInput("");
              }}
              className="rounded-lg border border-border bg-surface/50 px-3 py-2 text-sm hover:bg-surface-hover"
            >
              Añadir
            </button>
          </div>
          {/* Quick-add suggestions */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["US", "USA", "United States", "North America", "Europe", "UK"].filter(s => !locationBlock.includes(s)).map(s => (
              <button key={s} type="button" onClick={() => setLocationBlock([...locationBlock, s])}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:border-red-500/40 hover:text-red-500">
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Contract requirements */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Requisitos de Contrato y Empresa (Bilingüe)</label>
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder={"Contrato a término indefinido / Full-time indefinite contract\nModalidad 100% Remoto / 100% Remote"}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/50"
          />
          <p className="mt-1 text-[11px] text-faint">Una regla por línea. Escribe en inglés y español para que la IA entienda ofertas en ambos idiomas.</p>
        </div>
      </div>

      <CadenceSettings />

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]"
        >
          {saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : "Save config"}
        </button>
        <span className="text-xs text-faint">Local-first · on our roadmap</span>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  title,
  hint,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-border bg-surface/30 opacity-55"
          : active
            ? "border-brand/50 bg-brand-soft"
            : "border-border bg-surface/50 hover:bg-surface-hover",
      )}
    >
      <Icon className={cn("size-4", active && !disabled ? "text-brand" : "text-muted")} />
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-faint">{hint}</span>
    </button>
  );
}
