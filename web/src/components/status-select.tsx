"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { CANONICAL_STATES, statusDot } from "@/lib/format";
import { cn } from "@/lib/cn";
import { saveStatus } from "@/lib/pipeline-status.mjs";
import { appliedWriteAllowed, statusEditAction } from "@/lib/applied-confirm.mjs";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Reverts on failure; confirms with the
// terminal-popup animation.
type StatusSelectProps = {
  n: string;
  current: string;
  inline?: boolean;
  applicationLabel?: string;
  onSaved?: (status: string, restoreFocus: boolean) => void;
  // Set when this row unmounted during an earlier save. Pending keeps the
  // chosen status on screen. Failed is the error the unmounted editor could
  // not show.
  heldSave?: { phase: "pending"; status: string } | { phase: "failed"; error: string };
  onHeldSave?: (event: { type: "start"; status: string } | { type: "fail"; error: string } | { type: "clear" }) => void;
};

export function StatusSelect(props: StatusSelectProps) {
  return <StatusEditor key={props.n} {...props} />;
}

function StatusEditor({ n, current, inline = false, applicationLabel, onSaved, heldSave, onHeldSave }: StatusSelectProps) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pendingApplied, setPendingApplied] = useState(false);
  const pendingFrom = useRef("");
  const saving = useRef(false);
  const mounted = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  const id = useId();
  const label = applicationLabel ?? `application #${n}`;

  useEffect(() => {
    if (!saving.current) {
      setStatus(current);
      setPendingApplied(false);
    }
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

  const heldPending = heldSave?.phase === "pending" ? heldSave.status : "";
  const heldError = heldSave?.phase === "failed" ? heldSave.error : "";
  const savingNow = busy || heldPending !== "";
  const errorShown = error || heldError;

  function cancel() {
    if (saving.current || heldPending) return;
    setPendingApplied(false);
    setStatus(current);
    setEditing(false);
    setError("");
    requestAnimationFrame(() => pencil.current?.focus());
  }

  function declineApplied() {
    if (saving.current || heldPending) return;
    setPendingApplied(false);
    setStatus(pendingFrom.current || current);
    setError("");
  }

  async function commitChange(next: string, prev: string, hadFocus: boolean) {
    saving.current = true;
    setStatus(next);
    setBusy(true);
    setSaved(false);
    setError("");
    // Record the attempt before the request, so a scroll that unmounts this
    // editor still has the chosen status and can show a later failure.
    onHeldSave?.({ type: "start", status: next });
    try {
      const confirmed = await saveStatus(n, prev, next);
      if (!confirmed) {
        onHeldSave?.({ type: "clear" });
        return;
      }
      // A filter or the row window may unmount this editor while the write is
      // in flight. Still refresh; the parent's callback captures identity,
      // never row position. Disabling a focused select can move focus to body.
      // Restore it only if the user has not moved to search, tabs or another
      // row meanwhile.
      const restoreFocus = hadFocus && (document.activeElement === document.body || document.activeElement === select.current);
      if (onSaved) onSaved(confirmed, restoreFocus);
      else router.refresh();
      onHeldSave?.({ type: "clear" });
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
      const message = cause instanceof Error ? cause.message : "Could not save status. Please try again.";
      onHeldSave?.({ type: "fail", error: message });
      if (!mounted.current) return;
      setStatus(prev); // revert on failure
      setError(message);
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = pendingApplied ? pendingFrom.current : (inline ? current : status);
    if (saving.current || heldPending) return;
    const action = statusEditAction(next, prev);
    if (action === "keep") {
      setPendingApplied(false);
      setStatus(current);
      return;
    }
    if (action === "ask") {
      pendingFrom.current = prev;
      setStatus(next);
      setPendingApplied(true);
      setError("");
      return;
    }
    setPendingApplied(false);
    await commitChange(next, prev, document.activeElement === select.current);
  }

  async function confirmApplied() {
    if (!pendingApplied || saving.current || heldPending) return;
    const prev = pendingFrom.current;
    const active = document.activeElement;
    const hadFocus = active === select.current
      || (active instanceof HTMLElement && Boolean(active.closest("[data-status-editor]")));
    setPendingApplied(false);
    await commitChange("Applied", prev, hadFocus);
  }

  const shown = heldPending ? heldPending : pendingApplied ? status : inline && !busy ? current : status;
  const appliedAsk = appliedWriteAllowed({ status: "Applied", confirmed: false });
  const known = (CANONICAL_STATES as readonly string[]).includes(shown);
  const buttonClass = "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50 max-sm:size-11";
  const control = (
    <select
      ref={select}
      id={id}
      aria-label={inline ? `Status for ${label}` : undefined}
      aria-invalid={errorShown ? true : undefined}
      aria-describedby={errorShown ? `${id}-error` : undefined}
      value={shown}
      onChange={onChange}
      onKeyDown={(event) => {
        if (inline && event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      disabled={savingNow}
      className={cn(
        "rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 max-sm:min-h-[44px]",
        inline && "min-w-0 max-w-[calc(100%-2.5rem)]",
      )}
    >
      {!known && <option value={shown}>{shown}</option>}
      {CANONICAL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
  return (
    <span className={cn("flex-wrap items-center gap-2", inline ? "flex w-full min-w-0" : "inline-flex")} aria-busy={savingNow} data-status-editor="">
      {/* Flex wraps a line before it shrinks items, so min-w-0 on the label
          cannot keep the edit button beside a long status. This group does
          not wrap. The confirmation stays outside it and takes the next line. */}
      <span className={inline ? "flex min-w-0 max-w-full flex-nowrap items-center gap-2" : "contents"}>
        {inline ? (editing || heldPending !== "") ? (
          <>
            {control}
            <button type="button" aria-label={`Cancel editing status for ${label}`} title="Cancel" onClick={cancel} disabled={savingNow} className={buttonClass}>
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", statusDot(shown))} />
              <span className="min-w-0 truncate" title={shown}>{shown}</span>
            </span>
            <button ref={pencil} type="button" aria-label={`Edit status for ${label}`} title="Edit status" onClick={() => { setError(""); onHeldSave?.({ type: "clear" }); setEditing(true); }} className={buttonClass}>
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : (
          <>
            <label htmlFor={id} className="text-xs text-faint">status</label>
            {control}
          </>
        )}
        {inline && savingNow && <span role="status" className="shrink-0 text-xs text-faint">saving…</span>}
        {inline && saved && (
          <span role="status" className="inline-flex shrink-0 animate-terminal-popup items-center gap-1 text-xs font-medium text-brand-text">
            <Check aria-hidden="true" className="size-3" /> saved
          </span>
        )}
      </span>
      {pendingApplied && (
        <span data-status-confirm="" className={cn("items-center gap-2", inline ? "flex basis-full whitespace-normal" : "inline-flex")}>
          <span className="text-xs text-foreground">{appliedAsk.prompt}</span>
          <button type="button" onClick={() => void confirmApplied()} disabled={savingNow} className="text-xs font-medium text-brand-text disabled:opacity-60">
            {appliedAsk.yesLabel}
          </button>
          <button type="button" onClick={declineApplied} disabled={savingNow} className="text-xs text-muted hover:text-foreground disabled:opacity-60">
            Not yet
          </button>
        </span>
      )}
      {!inline && savingNow && <span role="status" className="text-xs text-faint">saving…</span>}
      {!inline && saved && (
        <span role="status" className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand-text">
          <Check aria-hidden="true" className="size-3" /> saved
        </span>
      )}
      {errorShown && <span id={`${id}-error`} role="alert" className="basis-full whitespace-normal text-xs text-red-700 dark:text-red-400">{errorShown}</span>}
    </span>
  );
}
