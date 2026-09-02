"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

// Opt-in signed-in browser profile for the apply flow.
//
// The apply session normally browses in a fresh cookie-less context, which is
// right for a public ATS form and wrong for a gated one: LinkedIn shows its
// authwall, so an Easy Apply posting (whose form lives ON LinkedIn, with no
// external ATS link to resolve) can never be reached.
//
// The profile is a DEDICATED directory, not the user's real Chrome profile, so it
// carries only what they deliberately sign into and never fights their everyday
// browser. They sign in themselves in a real window; career-ops never sees a
// password.

type Status = {
  enabled: boolean;
  dir: string;
  exists: boolean;
  /** Set when `apply.profile_dir` pointed outside the project and was refused,
   *  so the path shown below is the default rather than the one they wrote. */
  dirRejected?: string;
};

export function SignedInBrowser() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "open" | "close">(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus((await (await fetch("/api/apply/profile")).json()) as Status);
    } catch {
      /* best-effort: the section simply stays hidden */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "enable" | "disable" | "open" | "close", busyAs: "toggle" | "open" | "close") => {
    setBusy(busyAs);
    setError(null);
    try {
      const res = await fetch("/api/apply/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "That did not work.");
        return;
      }
      if (action === "open") setOpened(true);
      if (action === "close") setOpened(false);
      await load();
    } catch {
      setError("That did not work.");
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;

  return (
    <section className="mt-8">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Signed-in browser
      </label>

      <button
        type="button"
        onClick={() => act(status.enabled ? "disable" : "enable", "toggle")}
        disabled={busy !== null}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface/50 px-4 py-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-70"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Use a signed-in browser profile</span>
          <span className="mt-0.5 block text-xs text-faint">
            Apply normally browses signed out, so LinkedIn shows its login wall and an Easy Apply
            posting can never be reached. This uses a separate browser profile you sign into once. It
            is not your everyday Chrome profile, so it only ever holds the sites you add to it.
          </span>
        </span>
        <span
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            status.enabled ? "bg-brand" : "bg-surface-hover",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
              status.enabled ? "translate-x-[1.375rem]" : "translate-x-0.5",
            )}
          />
        </span>
      </button>

      {status.enabled && (
        <div className="mt-3 rounded-xl border border-border bg-surface/30 p-4">
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" />
            <span>
              Opens a real browser window. Sign in there yourself: career-ops never sees, types or
              stores your password. Close the window when you are done and the session is remembered
              for future applications.
            </span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => act("open", "open")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60"
            >
              {busy === "open" ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
              {status.exists ? "Open to check or re-sign in" : "Open and sign in to LinkedIn"}
            </button>
            {opened && (
              <button
                type="button"
                onClick={() => act("close", "close")}
                disabled={busy !== null}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-60"
              >
                {busy === "close" ? "Closing…" : "Done, close it"}
              </button>
            )}
          </div>

          {opened && (
            <p className="mt-2 text-xs text-muted">
              The window is open. Sign in, then come back and close it here.
            </p>
          )}
          {status.dirRejected && (
            <p className="mt-2 text-xs text-amber-400">
              Your <span className="font-mono">apply.profile_dir</span> (
              <span className="font-mono break-all">{status.dirRejected}</span>) points outside the
              career-ops folder, so it was not used. The profile must stay inside the project, which
              is what keeps it separate from your everyday browser profile. Using the default below.
            </p>
          )}
          <p className="mt-2 break-all font-mono text-[11px] text-faint">{status.dir}</p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </section>
  );
}
