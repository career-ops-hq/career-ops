"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

// The CV templates the core resolves, each shown filled with a fictional resume
// so the design is visible before it is chosen. Choosing one writes cv.template
// in config/profile.yml, the key the CLI reads, so web and CLI agree.

type Template = { name: string; displayName: string; isDefault: boolean };

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const THUMB_WIDTH = 200;

export function TemplatesSection() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/templates")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setTemplates(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const choose = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch("/api/templates/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof j.error === "string" ? j.error : "Could not save.");
      else setTemplates((prev) => prev && prev.map((t) => ({ ...t, isDefault: t.name === name })));
    } catch {
      setError("Could not save.");
    }
    setBusy(null);
  };

  return (
    <section aria-labelledby="templates-heading" className="mt-8">
      <h2 id="templates-heading" className="text-base font-semibold">
        CV templates
      </h2>
      <p className="mt-1 text-sm text-muted">
        Previews use a made-up resume, not yours. The default is used for new CVs.
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
              <Thumb name={t.name} title={`${t.displayName} preview`} />
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
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}

// One template filled with the sample resume. The page is fetched and handed to
// the frame as srcDoc (as the CV Studio preview does) rather than loaded by URL,
// and only once the card scrolls into view, since each preview is a render.
function Thumb({ name, title }: { name: string; title: string }) {
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
    fetch(`/api/templates/preview?name=${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((h) => live && setHtml(h))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [visible, name]);

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
