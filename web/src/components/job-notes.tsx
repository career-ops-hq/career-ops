"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquare, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { splitJobNotes } from "@/lib/job-notes.mjs";

type Props = { n: string; status: string; notes: string; label: string };

export function JobNotes({ n, status, notes, label }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(notes);
  useEffect(() => { setText(notes); }, [notes]);
  const close = useCallback(() => setOpen(false), []);
  const count = splitJobNotes(text).length;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={`Notes for ${label}`} title={count ? splitJobNotes(text).join(" · ") : "Add a note"} className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-11">
      <MessageSquare className="size-3.5" />{count ? `${count} ${count === 1 ? "note" : "notes"}` : "Add note"}
    </button>
    {open && <NotesEditor n={n} status={status} notes={text} label={label} onClose={close} onSaved={setText} />}
  </>;
}

function NotesEditor({ n, status, notes, label, onClose, onSaved }: Props & { onClose: () => void; onSaved: (notes: string) => void }) {
  const [draft, setDraft] = useState("");
  const [previous, setPrevious] = useState<{ text: string; index: number; notes: string } | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [deleted, setDeleted] = useState<string | undefined>();
  const saving = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const id = useId();
  const close = useCallback(() => { if (!saving.current) onClose(); }, [onClose]);
  const entries = splitJobNotes(notes);

  async function persist(payload: object) {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const response = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n, status, ...payload }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true || typeof result.notes !== "string") throw new Error(result.error || "Could not update the note.");
      onSaved(result.notes);
      router.refresh();
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update the note."); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (await persist({ note: draft, ...(previous !== undefined ? { replaceNote: previous.text, noteIndex: previous.index, expectedNotes: previous.notes } : {}) })) {
      setDraft(""); setPrevious(undefined); setDeleted(undefined); setFeedback("Note saved");
      requestAnimationFrame(() => field.current?.focus());
    }
  }
  async function remove(note: string) {
    if (await persist({ removeNote: note, expectedNotes: notes })) {
      setDeleted(entries.filter(entry => entry === note).length > 1 ? undefined : note); setFeedback("Note deleted");
      if (previous?.text === note) { setPrevious(undefined); setDraft(""); }
      requestAnimationFrame(() => field.current?.focus());
    }
  }
  async function undo() {
    if (deleted !== undefined && await persist({ note: deleted })) {
      setDeleted(undefined); setFeedback("Note restored");
    }
  }

  return <Modal isOpen onClose={close} labelledBy={`${id}-title`} initialFocusRef={field} panelClassName="max-w-xl">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={`${id}-title`} className="font-display text-2xl text-landing">Job notes</h2><p className="mt-1 break-words text-sm text-muted">{label}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close notes" onClick={close} disabled={busy}><X className="size-4" /></Button></div>
    {entries.length ? <ul className="mt-5 max-h-64 space-y-2 overflow-y-auto" aria-label="Saved notes">{entries.map((note, index) => <li key={`${index}:${note}`} className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3"><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{note}</p><button type="button" aria-label={`Edit note ${index + 1}`} disabled={busy} onClick={() => { setDraft(note); setPrevious({ text: note, index, notes }); setError(""); setFeedback(""); field.current?.focus(); }} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-brand-text disabled:opacity-50"><Pencil className="size-3.5" /></button><button type="button" aria-label={`Delete note ${index + 1}`} title="Delete note" disabled={busy} onClick={() => void remove(note)} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400 disabled:opacity-50"><Trash2 className="size-3.5" /></button></li>)}</ul> : <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted">No notes yet. Keep a reminder, contact detail, or next step here.</p>}
    <form onSubmit={save} className="mt-5 border-t border-border pt-4"><label htmlFor={`${id}-draft`} className="mb-2 block text-sm font-medium">{previous !== undefined ? "Edit note" : "New note"}</label><textarea ref={field} id={`${id}-draft`} value={draft} onChange={event => { setDraft(event.target.value); setFeedback(""); }} rows={3} maxLength={4000} disabled={busy} placeholder="e.g. Ask Alex about an internal referral before applying." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50" />
      {error && <div className="mt-2"><p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p><button type="button" className="mt-1 text-xs text-brand-text" onClick={() => router.refresh()}>Refresh job</button></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span role="status" className="inline-flex items-center gap-1 text-xs text-muted">{feedback && <><Check className="size-3" />{feedback}</>}</span><div className="flex flex-wrap justify-end gap-2">{deleted !== undefined && <Button type="button" variant="ghost" disabled={busy} onClick={() => void undo()}><Undo2 className="size-3.5" />Undo delete</Button>}{previous !== undefined && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDraft(""); setPrevious(undefined); setError(""); }}>Cancel editing</Button>}<Button type="submit" disabled={busy || !draft.trim()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{busy ? "Saving…" : previous !== undefined ? "Save note" : "Add note"}</Button></div></div>
    </form>
  </Modal>;
}
