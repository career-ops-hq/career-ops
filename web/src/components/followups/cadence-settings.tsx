"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { PROFILE_CADENCE_KEYS, type ProfileCadenceKey } from "@/lib/followups";
import { cn } from "@/lib/cn";

// Follow-up cadence knobs → config/profile.yml (followup_cadence). Server-
// persisted (unlike the localStorage engine prefs above) because the core
// followup-cadence.mjs reads the same keys — the CLI and the web must agree.

const FIELDS: { key: ProfileCadenceKey; label: string; hint: string }[] = [
  { key: "applied_first_days", label: "Primeiro contacto", hint: "dias após o envio da candidatura" },
  { key: "applied_subsequent_days", label: "Entre contactos", hint: "dias entre contactos enquanto aguardas resposta" },
  { key: "applied_max_followups", label: "Máximo de contactos", hint: "ao atingir este número sem resposta, deixa de haver lembretes" },
  { key: "responded_initial_days", label: "Prazo de resposta", hint: "dias para responder a uma mensagem da empresa" },
  { key: "responded_subsequent_days", label: "Após resposta", hint: "dias entre contactos depois de a empresa responder" },
  { key: "interview_thankyou_days", label: "Agradecimento", hint: "dias para enviar uma nota depois da entrevista" },
];

export function CadenceSettings() {
  const [values, setValues] = useState<Record<ProfileCadenceKey, string> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a failed load, do NOT fall back to defaults: the user would see 7/7/2/…
  // with no warning and a Save would overwrite their real profile.yml
  // overrides. Show an error + Retry instead.
  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/followups/cadence")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        // `effective` is already defaults+overrides, computed server-side from
        // the CORE's cadenceDefaults (#2369) — no local defaults table to merge
        // in. A key the core didn't supply renders empty rather than as an
        // invented number.
        const eff = (d?.effective ?? {}) as Partial<Record<ProfileCadenceKey, number>>;
        setValues(Object.fromEntries(
          PROFILE_CADENCE_KEYS.map((k) => [k, eff[k] === undefined ? "" : String(eff[k])]),
        ) as Record<ProfileCadenceKey, string>);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!values) return;
    const payload: Partial<Record<ProfileCadenceKey, number>> = {};
    for (const k of PROFILE_CADENCE_KEYS) {
      // Number(), not parseInt(): "3.5" and "7abc" must be rejected, not truncated.
      const raw = values[k].trim();
      const n = raw === "" ? Number.NaN : Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        setError(`«${FIELDS.find((f) => f.key === k)?.label}» tem de ser um número inteiro igual ou superior a zero.`);
        return;
      }
      payload[k] = n;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/followups/cadence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Não foi possível guardar.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Não foi possível guardar.");
    }
    setSaving(false);
  };

  return (
    <div>
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Frequência dos contactos
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint">
          Define quando surgem os lembretes. Os valores são guardados em{" "}
          <span className="font-mono text-muted">config/profile.yml</span> e também são usados no terminal.
        </p>
        {loadError ? (
          <div className="mt-3 text-sm text-muted">
            <p className="text-red-500">
              Não foi possível ler os valores atuais. Os valores predefinidos ficam ocultos para evitar alterações em{" "}
              <span className="font-mono">config/profile.yml</span>.
            </p>
            <button
              type="button"
              onClick={load}
              className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover"
            >
              Tentar novamente
            </button>
          </div>
        ) : values === null ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-sm font-medium text-foreground">{f.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">{f.hint}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => (v ? { ...v, [f.key]: e.target.value } : v))}
                    className="mt-1.5 w-24 rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm tabular-nums outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
                  />
                </label>
              ))}
            </div>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
              {saved ? "Guardado" : "Guardar frequência"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
