"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MapPin, X } from "lucide-react";
import { cn } from "@/lib/cn";

// Country/city name only — no bare abbreviation duplicates (dropped "USA",
// "UAE", "KSA": each is a pure synonym of the full name already in this list,
// so keeping both just meant two checkboxes for one real-world region).
const REGION_OPTIONS = [
  "Remote",
  "United States",
  "India",
  "Bengaluru",
  "United Kingdom",
  "London",
  "Europe",
  "Germany",
  "France",
  "Canada",
  "Australia",
  "United Arab Emirates",
  "Dubai",
  "Abu Dhabi",
  "Saudi Arabia",
  "Riyadh",
  "Singapore",
  "Japan",
  "Brazil",
];

function MultiSelectDropdown({ 
  value, 
  onChange, 
  options, 
  placeholder 
}: { 
  value: string[], 
  onChange: (val: string[]) => void, 
  options: string[], 
  placeholder: string 
}) {
  const [open, setOpen] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter(v => v !== opt));
    else onChange([...value, opt]);
  };

  const addCustom = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && customVal.trim()) {
      e.preventDefault();
      const val = customVal.trim();
      if (!value.includes(val)) onChange([...value, val]);
      setCustomVal("");
    }
  };

  return (
    <div
      className="relative mt-1.5 w-full max-w-sm"
      tabIndex={0}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors cursor-pointer hover:border-brand/50 max-sm:min-h-[44px]"
      >
        {value.length === 0 && <span className="text-faint">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-xs text-foreground border border-border">
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(v); }}
              aria-label={`Remove ${v}`}
              className="inline-flex items-center justify-center text-muted transition-colors hover:text-red-400 max-sm:min-h-[44px] max-sm:min-w-[24px]"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg">
          <div className="p-2 border-b border-border sticky top-0 bg-surface z-20">
             <input
               type="text"
               value={customVal}
               onChange={e => setCustomVal(e.target.value)}
               onKeyDown={addCustom}
               onClick={e => e.stopPropagation()}
               placeholder="Type custom region and press Enter..."
               className="w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-xs outline-none focus:border-brand/50"
             />
          </div>
          {options.map(opt => (
            <label
              key={opt}
              role="option"
              aria-selected={value.includes(opt)}
              className="flex min-h-[38px] items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover cursor-pointer max-sm:min-h-[44px]"
            >
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
                className="size-4 shrink-0 rounded border-border bg-surface text-brand focus:ring-brand accent-brand"
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function LocationSettings() {
  const [searchRegions, setSearchRegions] = useState<string[]>([]);
  const [blockRegions, setBlockRegions] = useState<string[]>([]);
  const [alwaysAllowRegions, setAlwaysAllowRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const portalsRes = await fetch("/api/portals");
      
      if (portalsRes.ok) {
        const portals = await portalsRes.json();
        if (Array.isArray(portals.location)) {
          setSearchRegions(portals.location);
        }
        if (Array.isArray(portals.block)) {
          setBlockRegions(portals.block);
        }
        if (Array.isArray(portals.always_allow)) {
          setAlwaysAllowRegions(portals.always_allow);
        }
      }
    } catch {
      setError("Failed to load current location settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const portalsRes = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          location: searchRegions.filter(Boolean),
          block: blockRegions.filter(Boolean),
          always_allow: alwaysAllowRegions.filter(Boolean)
        })
      });
      
      if (!portalsRes.ok) {
        setError("Could not save one or more settings.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Could not save location settings.");
    }
    setSaving(false);
  };

  return (
    <div className="mt-8">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Location & Region
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint mb-4">
          Where the scanner should look for roles (<span className="font-mono text-muted">portals.yml</span>). This setting also automatically overrides any default geographic terms in the AI's Google searches.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted" /> Search Regions
              </span>
              <span className="mt-0.5 block text-xs text-faint">Select regions to scan for (e.g. "India", "Remote"). This replaces US/Europe in web queries.</span>
              <MultiSelectDropdown 
                value={searchRegions}
                onChange={setSearchRegions}
                options={REGION_OPTIONS}
                placeholder="Target countries or regions"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted" /> Block Regions
              </span>
              <span className="mt-0.5 block text-xs text-faint">Select regions to exclude (e.g. "US", "Remote US")</span>
              <MultiSelectDropdown 
                value={blockRegions}
                onChange={setBlockRegions}
                options={REGION_OPTIONS}
                placeholder="Target countries to block"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted" /> Always Allow Regions
              </span>
              <span className="mt-0.5 block text-xs text-faint">Overrides the block list (e.g. if you block US but always allow your specific city)</span>
              <MultiSelectDropdown 
                value={alwaysAllowRegions}
                onChange={setAlwaysAllowRegions}
                options={REGION_OPTIONS}
                placeholder="Regions that bypass blocks"
              />
            </label>

            {error && <p className="text-xs text-red-500">{error}</p>}
            
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
              {saved ? "Saved" : "Save location settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
