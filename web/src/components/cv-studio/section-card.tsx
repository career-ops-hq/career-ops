"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, TriangleAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { arrange } from "@/lib/cv-studio/html-blocks.mjs";
import { bulletShown, wordDiff, type StudioAction, type StudioBullet, type StudioEdits, type StudioItem, type StudioSection } from "@/lib/cv-studio/studio.mjs";

type Dispatch = (a: StudioAction) => void;

// Below this overlap a word diff is mostly red and green; the original reads better as its own line.
const REWRITE_FLOOR = 0.45;
type Common = { n: string; edits: StudioEdits; hidden: Set<string>; dispatch: Dispatch };

const iconButton = "inline-flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-30 max-sm:size-11";

function MoveButtons({ parent, id, siblings, first, last, dispatch, label }: { parent: string; id: string; siblings: string[]; first: boolean; last: boolean; dispatch: Dispatch; label: string }) {
  return (
    <>
      <button className={iconButton} disabled={first} aria-label={`Move ${label} up`} onClick={() => dispatch({ type: "move", parent, id, by: -1, siblings })}>
        <ArrowUp className="size-3.5" />
      </button>
      <button className={iconButton} disabled={last} aria-label={`Move ${label} down`} onClick={() => dispatch({ type: "move", parent, id, by: 1, siblings })}>
        <ArrowDown className="size-3.5" />
      </button>
    </>
  );
}

function HideButton({ id, hidden, dispatch, label }: { id: string; hidden: boolean; dispatch: Dispatch; label: string }) {
  return (
    <button className={iconButton} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} aria-pressed={hidden} onClick={() => dispatch({ type: "toggle", id })}>
      {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </button>
  );
}

export function SectionCard({ section, siblings, first, last, ...common }: Common & { section: StudioSection; siblings: string[]; first: boolean; last: boolean }) {
  const { hidden, dispatch, edits } = common;
  const isHidden = hidden.has(section.id);
  const items = arrange(section.items, edits.order[section.id]);
  return (
    <section aria-label={section.title} className={cn("rounded-2xl border border-border bg-surface/40 px-4 py-3 transition-opacity", isHidden && "opacity-50")}>
      <header className="flex items-center gap-1">
        <h2 className="flex-1 font-mono text-xs uppercase tracking-[0.16em] text-faint">{section.title || "Section"}</h2>
        <MoveButtons parent="root" id={section.id} siblings={siblings} first={first} last={last} dispatch={dispatch} label={`${section.title} section`} />
        <HideButton id={section.id} hidden={isHidden} dispatch={dispatch} label={`${section.title} section`} />
      </header>
      {!isHidden && section.kind === "competencies" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((t) => (
            <button
              key={t.id}
              aria-pressed={!hidden.has(t.id)}
              onClick={() => dispatch({ type: "toggle", id: t.id })}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", hidden.has(t.id) ? "border-dashed border-border text-faint line-through" : "border-brand/30 bg-brand-soft text-brand")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!isHidden && section.kind !== "competencies" && (
        <div className="mt-1 divide-y divide-border/60">
          {items.map((item, k) => (
            <ItemBlock key={item.id} item={item} section={section} siblings={items.map((i) => i.id)} first={k === 0} last={k === items.length - 1} {...common} />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemBlock({ item, section, siblings, first, last, ...common }: Common & { item: StudioItem; section: StudioSection; siblings: string[]; first: boolean; last: boolean }) {
  const { hidden, dispatch, edits } = common;
  const isHidden = hidden.has(item.id);
  const bullets = arrange(item.bullets, edits.order[item.id]);
  const restored = edits.restored[item.id] ?? [];
  const showHeader = item.kind === "entry";
  return (
    <div className={cn("py-2", isHidden && "opacity-50")}>
      {showHeader && (
        <div className="flex items-center gap-1">
          <p className="flex-1 truncate text-sm font-medium text-foreground">{item.label}</p>
          {section.items.length > 1 && <MoveButtons parent={section.id} id={item.id} siblings={siblings} first={first} last={last} dispatch={dispatch} label={item.label} />}
          <HideButton id={item.id} hidden={isHidden} dispatch={dispatch} label={item.label} />
        </div>
      )}
      {!isHidden && (
        <ul className="mt-1 space-y-1.5">
          {bullets.map((b, k) => (
            <BulletRow key={b.id} bullet={b} parent={item.id} siblings={bullets.map((x) => x.id)} first={k === 0} last={k === bullets.length - 1} movable={item.kind === "entry"} {...common} />
          ))}
          {item.restorable.map((r, idx) =>
            restored.includes(idx) ? (
              <li key={`r${idx}`} className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                <span className="flex-1 text-foreground">{r.text}</span>
                <button className={iconButton} aria-label="Remove the added-back bullet" onClick={() => dispatch({ type: "unrestore", item: item.id, index: idx })}>
                  <Undo2 className="size-3.5" />
                </button>
              </li>
            ) : (
              <li key={`r${idx}`} className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-faint">
                <span className="flex-1">
                  <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide">Dropped by the tailor</span>
                  {r.text}
                </span>
                <button className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-brand/40 hover:text-brand" onClick={() => dispatch({ type: "restore", item: item.id, index: idx })}>
                  <Plus className="size-3" /> Add back
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function BulletRow({ n, bullet, parent, siblings, first, last, movable, edits, hidden, dispatch }: Common & { bullet: StudioBullet; parent: string; siblings: string[]; first: boolean; last: boolean; movable: boolean }) {
  const shown = bulletShown(bullet, edits);
  const isHidden = hidden.has(bullet.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown.text);
  const [busy, setBusy] = useState(false);

  const saveDraft = async () => {
    if (busy) return;
    const text = draft.trim();
    if (!text || text === shown.text) return setEditing(false);
    setBusy(true);
    const keywords = await fetch(`/api/cv-studio/${encodeURIComponent(n)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "keywords", text }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ keywords: string[] }>) : { keywords: [] }))
      .then((b) => b.keywords, () => []);
    dispatch({ type: "use", id: bullet.id, use: { kind: "custom", text, keywords } });
    setBusy(false);
    setEditing(false);
  };

  return (
    <li data-bullet={bullet.id} className={cn("group rounded-lg border px-3 py-2 text-sm transition-colors", isHidden ? "border-dashed border-border opacity-50" : "border-transparent hover:border-border")}>
      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft();
              if (e.key === "Escape") setEditing(false);
            }}
            rows={3}
            aria-label="Edit bullet"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-brand focus:outline-none"
          />
          <div className="mt-1.5 flex gap-2">
            <button disabled={busy} onClick={saveDraft} className="rounded-full bg-brand px-3 py-0.5 text-xs font-medium text-brand-foreground disabled:opacity-60">
              Use this wording
            </button>
            <button onClick={() => setEditing(false)} className="rounded-full px-3 py-0.5 text-xs text-muted hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={cn("leading-relaxed", isHidden ? "text-faint line-through" : "text-foreground")}>
          {shown.source === "tailored" && bullet.change === "edited" && bullet.base !== null && bullet.similarity >= REWRITE_FLOOR ? <Diff before={bullet.base} after={bullet.tailored} /> : shown.text}
        </p>
      )}
      {!editing && shown.source === "tailored" && bullet.change === "edited" && bullet.base !== null && bullet.similarity < REWRITE_FLOOR && (
        <p className="mt-1 text-xs text-faint">
          <span className="font-medium uppercase tracking-wide">Rewritten from</span> {bullet.base}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {bullet.change === "new" && shown.source === "tailored" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" title="No matching bullet in cv.md. Make sure it is true before you send it.">
            <TriangleAlert className="size-3" /> Not in your base CV
          </span>
        )}
        {shown.source === "tailored" &&
          bullet.drivenBy.map((k) => (
            <span key={k} className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand" title="Job keyword this rewrite added">
              +{k}
            </span>
          ))}
        {shown.source === "custom" && <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-muted">Your wording</span>}
        <span className="flex-1" />
        {bullet.base !== null && bullet.change !== "same" && (
          <div role="radiogroup" aria-label="Wording" className="inline-flex rounded-full border border-border p-0.5 text-[11px]">
            {(["tailored", "base"] as const).map((kind) => (
              <button
                key={kind}
                role="radio"
                aria-checked={shown.source === kind}
                onClick={() => dispatch({ type: "use", id: bullet.id, use: { kind } })}
                className={cn("rounded-full px-2 py-0.5 transition-colors", shown.source === kind ? "bg-brand-soft font-medium text-brand" : "text-muted hover:text-foreground")}
              >
                {kind === "tailored" ? "Tailored" : "Original"}
              </button>
            ))}
          </div>
        )}
        <button
          className={iconButton}
          aria-label="Edit wording"
          onClick={() => {
            setDraft(shown.text);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </button>
        {movable && <MoveButtons parent={parent} id={bullet.id} siblings={siblings} first={first} last={last} dispatch={dispatch} label="bullet" />}
        {movable && <HideButton id={bullet.id} hidden={isHidden} dispatch={dispatch} label="bullet" />}
      </div>
    </li>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <>
      {wordDiff(before, after).map((part, k) =>
        part.op === "same" ? (
          <span key={k}>{part.text}</span>
        ) : part.op === "del" ? (
          <del key={k} className="rounded bg-red-500/10 text-red-700 decoration-red-400/70 dark:text-red-300">{part.text}</del>
        ) : (
          <ins key={k} className="rounded bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300">{part.text}</ins>
        ),
      )}
    </>
  );
}
