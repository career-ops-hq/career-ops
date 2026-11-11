"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  ROLES, DEFAULTS, applyAppearance, loadAppearance, loadAppearanceFromServer, saveAppearance,
  type Appearance, type FontChoice, type RoleId,
} from "@/lib/appearance";
import { normalizeAppearance } from "@/lib/appearance-schema.mjs";

const COMMON = ["Segoe UI", "Arial", "Verdana", "Tahoma", "Calibri", "Georgia", "Cambria", "Trebuchet MS", "Consolas", "Courier New"];
const opt = { background: "var(--bg)", color: "var(--fg)" };
const label = "mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted";
const btn = "rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground";

export function FontSettings() {
  const [a, setA] = useState<Appearance>(DEFAULTS);
  const [fonts, setFonts] = useState<string[]>(COMMON);
  const [msg, setMsg] = useState("");

  // Controls stay disabled until the saved copy has loaded, so an edit never
  // writes a stale cache over settings changed in another browser.
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setA(loadAppearance());
    const onChange = () => setA(loadAppearance());
    window.addEventListener("appearancechange", onChange);
    loadAppearanceFromServer()
      .then((s) => {
        if (s) setA(s);
      })
      .catch(() => {})
      .finally(() => setReady(true));
    return () => window.removeEventListener("appearancechange", onChange);
  }, []);

  // Apply at once; save after the user pauses (sliders fire on every step, and
  // the saved file can hold large font data).
  const update = (raw: Appearance) => {
    const next = normalizeAppearance(raw) as Appearance;
    applyAppearance(next);
    setA(next);
    setMsg("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveAppearance(next).then((ok) => {
        if (!ok) setMsg("Could not save to your data folder. The setting applies now but will be lost on reload (font file too large?).");
      });
    }, 400);
  };
  const setFont = (id: RoleId, f: FontChoice | null) => {
    const fonts = { ...a.fonts };
    if (f) fonts[id] = f;
    else delete fonts[id];
    update({ ...a, fonts });
  };

  async function detect() {
    try {
      // Chromium-only; asks permission to read installed fonts.
      const list = await (window as any).queryLocalFonts();
      setFonts([...new Set<string>(list.map((f: any) => f.family))].sort());
    } catch {
      setMsg("Your browser cannot list system fonts. Pick from the common list instead.");
    }
  }
  function upload(id: RoleId, file: File) {
    const r = new FileReader();
    r.onload = () => setFont(id, { kind: "upload", family: `UserFont-${id}`, data: String(r.result) });
    r.readAsDataURL(file);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pb-16">
      <h2 className="font-display text-xl tracking-tight text-landing">Appearance</h2>
      <p className="mt-1 text-sm text-muted">Fonts, text size and page width. Saved in your career-ops data folder (config/ui-appearance.json), so they follow you across browsers.</p>

      <fieldset disabled={!ready} className="contents">
      <span className={cn(label, "mt-8")}>Page width</span>
      <div className="flex gap-2">
        {([["small", "Small", "Centered, narrow"], ["medium", "Medium", "Wider, still centered"], ["full", "Full", "Uses the whole window"]] as const).map(([w, name, hint]) => (
          <button key={w} onClick={() => update({ ...a, width: w })}
            className={cn("flex-1 rounded-xl border px-3 py-2 text-left",
              a.width === w ? "border-brand/40 bg-brand-soft text-brand-text" : "border-border bg-surface/30 text-muted hover:bg-surface-hover")}>
            <span className="block text-sm">{name}</span>
            <span className="block text-xs text-faint">{hint}</span>
          </button>
        ))}
      </div>

      <span className={cn(label, "mt-8")}>Fonts</span>
      <div className="space-y-2">
        {ROLES.map((r) => {
          const cur = a.fonts[r.id];
          return (
            <div key={r.id} className="rounded-xl border border-border bg-surface/30 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-foreground">{r.label}</span>
                <span className="truncate text-xs text-faint">{cur ? (cur.kind === "upload" ? "uploaded file" : cur.family) : "default"}</span>
              </div>
              <p className="mb-2 text-xs text-faint">{r.hint}</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`${r.label} font`}
                  className="rounded-md border border-border px-2 py-1.5 text-xs"
                  style={opt}
                  value={cur?.kind === "system" ? cur.family : ""}
                  onChange={(e) => setFont(r.id, e.target.value ? { kind: "system", family: e.target.value } : null)}
                >
                  <option value="" style={opt}>Default</option>
                  {fonts.map((f) => (
                    <option key={f} value={f} style={{ ...opt, fontFamily: f }}>{f}</option>
                  ))}
                </select>
                <label className={cn(btn, "cursor-pointer")}>
                  Upload font
                  <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden"
                    onChange={(e) => e.target.files?.[0] && upload(r.id, e.target.files[0])} />
                </label>
                {cur && <button className={btn} onClick={() => setFont(r.id, null)}>Reset</button>}
              </div>
            </div>
          );
        })}
      </div>
      <button className={cn(btn, "mt-2")} onClick={detect}>Load all fonts installed on this computer</button>
      <p className="mt-2 text-xs text-faint">Only upload fonts you have the right to use. They are stored only in your own data folder.</p>

      <span className={cn(label, "mt-8")}>Text size</span>
      <div className="space-y-3 rounded-xl border border-border bg-surface/30 p-3">
        {([["uiSize", "Interface", 80, 140], ["previewSize", "Preview text", 80, 160]] as const).map(([k, name, min, max]) => (
          <div key={k} className="flex items-center gap-3 text-sm">
            <span className="w-28 text-foreground">{name}</span>
            <input type="range" aria-label={`${name} text size`} min={min} max={max} step={5} value={a[k]} className="flex-1 accent-[var(--color-brand)]"
              onChange={(e) => update({ ...a, [k]: Number(e.target.value) })} />
            <span className="w-12 text-right text-xs text-muted">{a[k]}%</span>
          </div>
        ))}
        <button className={btn} onClick={() => update(DEFAULTS)}>Reset everything to defaults</button>
      </div>
      </fieldset>
      {msg && <p role="alert" className="mt-2 text-xs text-red-500">{msg}</p>}
    </div>
  );
}
