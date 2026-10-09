"use client";

import { useRef, useState } from "react";
import { CalendarPlus, Loader2, X } from "lucide-react";
import type { ScanEngine } from "@/lib/scheduled-jobs";
import { DEFAULT_FILTERS, type ExploreFilters } from "@/lib/explore";
import { FilterBuilder } from "@/components/explore/filter-builder";
import { ScheduledOverlay } from "./scheduled-overlay";
import { cadenceMinimum, cadenceValueForUnit, createScheduledJobRequest } from "@/lib/scheduled-job-client.mjs";

export function CreateJobModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("Pesquisa agendada");
  const [engine, setEngine] = useState<ScanEngine>("full");
  const [every, setEvery] = useState(6);
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [filters, setFilters] = useState<ExploreFilters>({
    ...DEFAULT_FILTERS,
    ats: [...DEFAULT_FILTERS.ats],
    positive: [],
    negative: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await createScheduledJobRequest({ name, engine, every, unit, filters });

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a pesquisa.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScheduledOverlay isOpen={isOpen} onClose={onClose} titleId="create-scheduled-scan-title" initialFocusRef={nameRef} panelClassName="max-w-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <CalendarPlus className="size-5" />
            </div>
            <div>
              <h2 id="create-scheduled-scan-title" className="text-lg font-semibold text-foreground">Nova pesquisa agendada</h2>
              <p className="text-xs text-muted">Guarda filtros e a frequência com que pretendes repetir a pesquisa.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500">{error}</div>}

          {/* ─── Name + Engine + Cadence ─── */}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-foreground">Nome</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-xl border border-border bg-surface-hover/60 px-3.5 py-2 text-sm text-foreground outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              placeholder="Ex.: Apoio ao cliente em Lisboa"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-foreground">Método de pesquisa</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as ScanEngine)}
                className="w-full rounded-xl border border-border bg-surface-hover/60 px-3.5 py-2 text-sm text-foreground outline-none focus:border-brand/60"
              >
                <option value="full">Bases públicas de ATS</option>
                <option value="portals">Empresas de portals.yml</option>
              </select>
              <p className="mt-1 text-[11px] text-faint">
                {engine === "full"
                  ? "Pesquisa dados públicos da Greenhouse, Lever e Ashby."
                  : "Pesquisa apenas as empresas configuradas em portals.yml, sem usar o agente."}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-foreground">Repetir a cada</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={cadenceMinimum(unit)}
                  value={every}
                  onChange={(e) => setEvery(Math.max(cadenceMinimum(unit), Number(e.target.value)))}
                  className="w-20 rounded-xl border border-border bg-surface-hover/60 px-3.5 py-2 text-sm text-foreground outline-none focus:border-brand/60"
                />
                <select
                  value={unit}
                  onChange={(e) => {
                    const nextUnit = e.target.value as "minutes" | "hours" | "days";
                    setUnit(nextUnit);
                    setEvery((value) => cadenceValueForUnit(value, nextUnit));
                  }}
                  className="flex-1 rounded-xl border border-border bg-surface-hover/60 px-3.5 py-2 text-sm text-foreground outline-none focus:border-brand/60"
                >
                  <option value="hours">horas</option>
                  <option value="days">dias</option>
                  <option value="minutes">minutos</option>
                </select>
              </div>
            </div>
          </div>

          {/* ─── Reuse FilterBuilder from Explore ─── */}
          <div className="rounded-xl border border-border bg-surface/30 p-4">
            <FilterBuilder filters={filters} onChange={setFilters} />
          </div>

          {/* ─── Actions ─── */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-xs font-medium text-brand-foreground shadow transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              {submitting ? "A criar…" : "Guardar pesquisa"}
            </button>
          </div>
        </form>
    </ScheduledOverlay>
  );
}
