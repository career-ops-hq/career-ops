"use client";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";

// Edit the body of one of your own templates. Saving goes through the server,
// which accepts the edit only when the template still resolves and answers with
// the resolver's reason when it does not, so a bad save never reaches the file.

type Props = {
  kind: "cv" | "cover";
  name: string;
  title: string;
  onClose: () => void;
  onSaved: () => void;
};

export function TemplateEditor({ kind, name, title, onClose, onSaved }: Props) {
  const fieldId = useId();
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/templates/file?kind=${kind}&name=${encodeURIComponent(name)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not open the template.");
        return j as { text: string; version: string };
      })
      .then((j) => {
        if (!live) return;
        setText(j.text);
        setSaved(j.text);
        setVersion(j.version);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind, name]);

  const save = async () => {
    if (text === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/templates/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, text, version }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof j.error === "string" ? j.error : "Could not save.");
      else {
        setVersion(j.version);
        setSaved(text);
        onSaved();
      }
    } catch {
      setError("Could not save.");
    }
    setBusy(false);
  };

  const dirty = text !== null && text !== saved;

  return (
    <section aria-label={`Edit ${title}`} className="mt-4 rounded-xl border border-border bg-surface/40 p-3">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {title} (HTML)
      </label>
      {text === null && !error ? (
        <Loader2 className="mt-2 size-4 animate-spin text-muted" aria-label="Opening template" />
      ) : (
        <textarea
          id={fieldId}
          value={text ?? ""}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          disabled={text === null}
          className="mt-2 h-96 w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs"
        />
      )}
      {error && (
        <p role="alert" className="mt-2 whitespace-pre-wrap text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-surface disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="text-xs underline">
          {dirty ? "Discard and close" : "Close"}
        </button>
        {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
      </div>
    </section>
  );
}
