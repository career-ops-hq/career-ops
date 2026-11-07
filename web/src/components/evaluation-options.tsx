"use client";

import { useEffect, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { EVALUATION_OPTIONS, ESSENTIAL_EVALUATION, FULL_EVALUATION, EVALUATION_STORAGE_KEY, parseEvaluationOptions } from "@/lib/evaluation-options.mjs";

export function useEvaluationOptions() {
  const [sections, setSections] = useState<string[]>([...FULL_EVALUATION]);
  useEffect(() => {
    const load = () => {
      try {
        const saved = localStorage.getItem(EVALUATION_STORAGE_KEY);
        const parsed = parseEvaluationOptions(saved === null ? undefined : JSON.parse(saved));
        if (parsed.ok && parsed.sections) setSections(parsed.sections);
      } catch { /* Keep the full preset if storage is unavailable. */ }
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener(EVALUATION_STORAGE_KEY, load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(EVALUATION_STORAGE_KEY, load);
    };
  }, []);
  const update = (next: string[]) => {
    const parsed = parseEvaluationOptions(next);
    if (!parsed.ok || !parsed.sections) return;
    setSections(parsed.sections);
    try { localStorage.setItem(EVALUATION_STORAGE_KEY, JSON.stringify(parsed.sections)); window.dispatchEvent(new Event(EVALUATION_STORAGE_KEY)); } catch { /* The current choice still applies. */ }
  };
  return { sections, setSections: update };
}

export function EvaluationOptions({ sections, onChange }: { sections: string[]; onChange: (next: string[]) => void }) {
  const full = sections.length === FULL_EVALUATION.length;
  return (
    <fieldset className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium"><SlidersHorizontal className="size-4 text-brand-text" /> Evaluation sections</legend>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" aria-pressed={sections.length === 1 && sections[0] === "summary"} onClick={() => onChange([...ESSENTIAL_EVALUATION])} className="rounded-full border border-border px-3 py-1.5 text-xs aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text">Essentials</button>
        <button type="button" aria-pressed={full} onClick={() => onChange([...FULL_EVALUATION])} className="rounded-full border border-border px-3 py-1.5 text-xs aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text">Full evaluation</button>
      </div>
      <p className="mb-3 flex items-start gap-2 text-xs text-muted"><Check className="mt-0.5 size-3.5 shrink-0 text-brand-text" /> Always included: fit score, key requirements and gaps, evidence confidence, and basic posting checks.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {EVALUATION_OPTIONS.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-surface-hover">
            <input type="checkbox" checked={sections.includes(option.id)} onChange={(event) => onChange(event.target.checked ? [...sections, option.id] : sections.filter((id) => id !== option.id))} className="mt-0.5 size-4 shrink-0 accent-brand" />
            <span><span className="block text-xs font-medium">{option.label}</span><span className="mt-0.5 block text-[11px] text-muted">{option.description}</span></span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">Your choice is remembered on this browser. Unchecked work is excluded from the AI request. Fewer sections usually use fewer tokens; reading the posting and your profile still has a cost.</p>
      {!sections.includes("research") && <p className="mt-2 text-[11px] text-muted">Salary and company research is off. The score will flag evidence it could not verify.</p>}
    </fieldset>
  );
}
