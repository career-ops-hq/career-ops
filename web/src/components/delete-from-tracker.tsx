"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";

// disc#9: remove a bogus tracker row (e.g. a job marked Evaluated after the CLI
// errored mid-run). Hard delete via the core write-gate (/api/tracker/delete →
// tracker.mjs delete), behind a confirm. The soft option (status → Discarded) lives
// in StatusSelect and stays for real-but-passed applications.
export function DeleteFromTracker({ n }: { n: string }) {
  const router = useRouter();
  const t = useT();
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
        setErr(d.error || t("This row can’t be removed."));
        return;
      }
      setOrphan(d.orphanReport ?? null);
    } catch {
      setErr(t("Couldn’t reach the tracker."));
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
        setErr(d.error || t("Delete failed."));
        setBusy(false);
        return;
      }
      // Row is gone — leave the (now-orphaned) report page for the pipeline.
      router.push("/pipeline");
      router.refresh();
    } catch {
      setErr(t("Delete failed."));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openConfirm}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted max-sm:min-h-[44px] transition-colors hover:border-red-400/50 hover:text-red-500"
      >
        <Trash2 className="size-3.5" /> {t("Remove from tracker")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-400/30 bg-red-500/[0.06] p-3 text-xs">
      <p className="font-medium text-foreground">{t("Permanently remove application #{n} from your tracker?", { n })}</p>
      <p className="mt-1 text-muted">
        {t("This can’t be undone.")}{orphan ? " " + t("Its report file ({file}) is left on disk.", { file: orphan }) : ""}
      </p>
      {err && <p className="mt-1.5 text-red-500">{err}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          disabled={busy}
          onClick={confirmDelete}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-2.5 py-1 font-medium max-sm:min-h-[44px] text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} {t("Delete")}
        </button>
        <button
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded-md border border-border px-2.5 py-1 text-muted max-sm:min-h-[44px] transition-colors hover:text-foreground disabled:opacity-50"
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
