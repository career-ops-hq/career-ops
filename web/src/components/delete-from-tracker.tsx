"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

// disc#9: remove a bogus tracker row (e.g. a job marked Evaluated after the CLI
// errored mid-run). Hard delete via the core write-gate (/api/tracker/delete →
// tracker.mjs delete), behind a confirm. The soft option (status → Discarded) lives
// in StatusSelect and stays for real-but-passed applications.
export function DeleteFromTracker({ n }: { n: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orphan, setOrphan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function openConfirm() {
    setOpen(true);
    setErr("");
    setOrphan(null);
    try {
      const r = await fetch("/api/tracker/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, dryRun: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "Não foi possível remover este registo.");
        return;
      }
      setOrphan(d.orphanReport ?? null);
    } catch {
      setErr("Não foi possível aceder ao registo de candidaturas.");
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/tracker/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "Não foi possível eliminar o registo.");
        setBusy(false);
        return;
      }
      // Row is gone — leave the (now-orphaned) report page for the pipeline.
      router.push("/pipeline");
      router.refresh();
    } catch {
      setErr("Não foi possível eliminar o registo.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openConfirm}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted max-sm:min-h-[44px] transition-colors hover:border-red-400/50 hover:text-red-500"
      >
        <Trash2 className="size-3.5" /> Remover do registo
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-400/30 bg-red-500/[0.06] p-3 text-xs">
      <p className="font-medium text-foreground">Eliminar definitivamente a candidatura #{n}?</p>
      <p className="mt-1 text-muted">
        Esta ação não pode ser anulada.{orphan ? ` O relatório (${orphan}) permanece no disco.` : ""}
      </p>
      {err && <p className="mt-1.5 text-red-500">{err}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          disabled={busy}
          onClick={confirmDelete}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-2.5 py-1 font-medium max-sm:min-h-[44px] text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Eliminar
        </button>
        <button
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded-md border border-border px-2.5 py-1 text-muted max-sm:min-h-[44px] transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
