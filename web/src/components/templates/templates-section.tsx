"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { TemplateEditor } from "@/components/templates/template-editor";

// The CV templates the core resolves, each shown filled with a fictional resume
// so the design is visible before it is chosen. Choosing one writes cv.template
// in config/profile.yml, the key the CLI reads, so web and CLI agree.

type Template = { name: string; displayName: string; layer: "user" | "system"; isDefault: boolean };
type Pending = { name: string; mode: "duplicate" | "rename" | "delete" };

// Matches isValidTemplateName() on the server, which stays the authority.
const NAME_HINT = "Lowercase letters and digits, joined by single hyphens.";

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const THUMB_WIDTH = 200;

const COPY = {
  cv: { id: "cv-templates-heading", title: "CV templates", note: "Previews use a made-up resume, not yours. The default is used for new CVs." },
  cover: { id: "cover-templates-heading", title: "Cover letter templates", note: "Previews use a made-up letter, not yours. The default is used for new cover letters." },
} as const;

export function TemplatesSection({ kind = "cv" }: { kind?: "cv" | "cover" }) {
  const copy = COPY[kind];
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped after a save so the card previews fetch the edited template.
  const [rev, setRev] = useState(0);

  const load = useCallback(() => {
    setLoadError(false);
    fetch(`/api/templates?kind=${kind}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setTemplates(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => setLoadError(true));
  }, [kind]);
  useEffect(load, [load]);

  const choose = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch("/api/templates/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof j.error === "string" ? j.error : "Could not save.");
      else setTemplates((prev) => prev && prev.map((t) => ({ ...t, isDefault: t.name === name })));
    } catch {
      setError("Could not save.");
    }
    setBusy(null);
  };

  // Duplicate, rename and delete share one round trip: post, then reload the list
  // so the card set, defaults and layers all come from the server.
  const manage = async () => {
    if (!pending) return;
    setBusy(pending.name);
    setError(null);
    const body =
      pending.mode === "duplicate" ? { kind, from: pending.name, name: draft.trim() }
      : pending.mode === "rename" ? { kind, name: pending.name, to: draft.trim() }
      : { kind, name: pending.name };
    try {
      const res = await fetch(`/api/templates/${pending.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof j.error === "string" ? j.error : "Could not save.");
      else {
        setPending(null);
        setDraft("");
      }
      if (res.ok || res.status === 409) load();
    } catch {
      setError("Could not save.");
    }
    setBusy(null);
  };

  const ask = (name: string, mode: Pending["mode"]) => {
    setError(null);
    setPending({ name, mode });
    setDraft("");
  };

  return (
    <section aria-labelledby={copy.id} className="mt-8">
      <h2 id={copy.id} className="text-base font-semibold">
        {copy.title}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.note}</p>
      <p id={`${copy.id}-hint`} className="sr-only">
        {NAME_HINT}
      </p>

      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-red-500">
          Could not load the templates.{" "}
          <button type="button" className="underline" onClick={load}>
            Retry
          </button>
        </p>
      ) : templates === null ? (
        <Loader2 className="mt-3 size-4 animate-spin text-muted" aria-label="Loading templates" />
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {templates.map((t) => (
            <li key={t.name} className="rounded-xl border border-border bg-surface/40 p-3">
              <Thumb key={`${t.name}-${rev}`} kind={kind} name={t.name} title={`${t.displayName} preview`} />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{t.displayName}</span>
                {t.isDefault ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Check className="size-3" aria-hidden /> Default
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => choose(t.name)}
                    className={cn("rounded-md border border-border px-2 py-1 text-xs hover:bg-surface", busy !== null && "opacity-60")}
                  >
                    {busy === t.name ? "Saving…" : "Make default"}
                  </button>
                )}
              </div>
              {pending?.name === t.name ? (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void manage();
                  }}
                >
                  {pending.mode === "delete" ? (
                    <p className="text-xs">Delete {t.displayName}? This removes its file.</p>
                  ) : (
                    <input
                      autoFocus
                      disabled={busy !== null}
                      aria-label={pending.mode === "rename" ? "New name" : "Name for the copy"}
                      aria-describedby={`${copy.id}-hint`}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setError(null);
                      }}
                      placeholder={pending.mode === "rename" ? "new-name" : "copy-name"}
                      className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs"
                    />
                  )}
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy !== null} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface">
                      {busy === t.name ? "Working…" : pending.mode === "delete" ? "Delete" : pending.mode === "rename" ? "Rename" : "Duplicate"}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setPending(null);
                        setError(null);
                      }}
                      className="rounded-md px-2 py-1 text-xs underline disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-2 flex gap-3 text-xs">
                  <button type="button" disabled={busy !== null} onClick={() => ask(t.name, "duplicate")} className="underline">
                    Duplicate
                  </button>
                  {t.layer === "user" && (
                    <>
                      <button type="button" disabled={busy !== null} onClick={() => setEditing(t.name)} className="underline">
                        Edit
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => ask(t.name, "rename")} className="underline">
                        Rename
                      </button>
                      <button type="button" disabled={busy !== null || t.isDefault} title={t.isDefault ? "Make another template the default first" : undefined} onClick={() => ask(t.name, "delete")} className="underline">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}
      {editing && templates?.some((t) => t.name === editing) && (
        <TemplateEditor
          key={editing}
          kind={kind}
          name={editing}
          title={templates.find((t) => t.name === editing)?.displayName ?? editing}
          onClose={() => setEditing(null)}
          onSaved={() => setRev((n) => n + 1)}
        />
      )}
    </section>
  );
}

// One template filled with the sample resume. The page is fetched and handed to
// the frame as srcDoc (as the CV Studio preview does) rather than loaded by URL,
// and only once the card scrolls into view, since each preview is a render.
function Thumb({ kind, name, title }: { kind: "cv" | "cover"; name: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetch(`/api/templates/preview?kind=${kind}&name=${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((h) => live && setHtml(h))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [visible, kind, name]);

  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-md bg-white shadow-sm"
      style={{ width: THUMB_WIDTH, height: (PAGE_HEIGHT * THUMB_WIDTH) / PAGE_WIDTH }}
    >
      {failed && <p className="p-3 text-xs text-neutral-500">Preview unavailable.</p>}
      {html !== null && (
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          style={{
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            border: 0,
            transform: `scale(${THUMB_WIDTH / PAGE_WIDTH})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
