"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { CANONICAL_STATES, statusDot } from "@/lib/format";
import { cn } from "@/lib/cn";
import { saveStatus } from "@/lib/pipeline-status.mjs";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Reverts on failure; confirms with the
// terminal-popup animation.
type StatusSelectProps = {
  n: string;
  current: string;
  inline?: boolean;
  applicationLabel?: string;
  onSaved?: (status: string, restoreFocus: boolean) => void;
};

export function StatusSelect(props: StatusSelectProps) {
  return <StatusEditor key={props.n} {...props} />;
}

function StatusEditor({ n, current, inline = false, applicationLabel, onSaved }: StatusSelectProps) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const mounted = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  const id = useId();
  const label = applicationLabel ?? `application #${n}`;

  useEffect(() => {
    if (!saving.current) setStatus(current);
  }, [current]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (editing && inline) select.current?.focus();
  }, [editing, inline]);

  function cancel() {
    if (saving.current) return;
    setStatus(current);
    setEditing(false);
    setError("");
    requestAnimationFrame(() => pencil.current?.focus());
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = inline ? current : status;
    if (saving.current || next === prev) return;
    const hadFocus = document.activeElement === select.current;
    saving.current = true;
    setStatus(next);
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const confirmed = await saveStatus(n, prev, next);
      if (!confirmed) return;
      // A filter may unmount this editor while the write is in flight. Still
      // refresh; the parent's callback captures identity, never row position.
      // Disabling a focused select can move focus to body. Restore it only
      // if the user has not moved to search, tabs or another row meanwhile.
      const restoreFocus = hadFocus && (document.activeElement === document.body || document.activeElement === select.current);
      if (onSaved) onSaved(confirmed, restoreFocus);
      else router.refresh();
      if (!mounted.current) return;
      setStatus(confirmed);
      setEditing(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
      if (inline && restoreFocus) {
        requestAnimationFrame(() => pencil.current?.focus());
      }
    } catch (cause) {
      if (!mounted.current) return;
      setStatus(prev); // revert on failure
      setError(cause instanceof Error ? cause.message : "Could not save status. Please try again.");
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const shown = inline && !busy ? current : status;
  const known = (CANONICAL_STATES as readonly string[]).includes(shown);
  const buttonClass = "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-brand focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50 max-sm:size-11";
  const control = (
    <select
      ref={select}
      id={id}
      aria-label={inline ? `Status for ${label}` : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      value={shown}
      onChange={onChange}
      onKeyDown={(event) => {
        if (inline && event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      disabled={busy}
      className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 max-sm:min-h-[44px]"
    >
      {!known && <option value={shown}>{shown}</option>}
      {CANONICAL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2" aria-busy={busy}>
      {inline ? editing ? (
        <>
          {control}
          <button type="button" aria-label={`Cancel editing status for ${label}`} title="Cancel" onClick={cancel} disabled={busy} className={buttonClass}>
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", statusDot(shown))} />
            {shown}
          </span>
          <button ref={pencil} type="button" aria-label={`Edit status for ${label}`} title="Edit status" onClick={() => { setError(""); setEditing(true); }} className={buttonClass}>
            <Pencil aria-hidden="true" className="size-4" />
          </button>
        </>
      ) : (
        <>
          <label htmlFor={id} className="text-xs text-faint">status</label>
          {control}
        </>
      )}
      {busy && <span role="status" className="text-xs text-faint">saving…</span>}
      {saved && (
        <span role="status" className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check aria-hidden="true" className="size-3" /> saved
        </span>
      )}
      {error && <span id={`${id}-error`} role="alert" className="basis-full whitespace-normal text-xs text-red-600">{error}</span>}
    </span>
  );
}
