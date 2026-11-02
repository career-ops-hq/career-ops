"use client";

export function CurrentBar({ value, max, label, tone = "brand" }: { value: number; max: number; label: string; tone?: "brand" | "secondary" }) {
  const safeMax = Math.max(0, max);
  const safeValue = Math.max(0, Math.min(value, safeMax));
  const percent = safeMax === 0 ? 0 : (safeValue / safeMax) * 100;
  return (
    <div className="grid grid-cols-[minmax(7.5rem,auto)_minmax(4rem,1fr)_auto] items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={safeValue} className="current-track">
        <div className={`current-bar current-bar-${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular-nums">{safeValue}/{safeMax}</span>
    </div>
  );
}
