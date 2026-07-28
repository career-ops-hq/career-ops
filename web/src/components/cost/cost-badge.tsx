import { Leaf, Coins, Sparkles } from "lucide-react";
import { COST_META, type CostClass } from "@/lib/explore-cost";

// One primitive, four variants — the app's cost color-semantics (career-ops-ux
// lock, for DESIGN_SYSTEM.md): GREEN = free/positive (celebrate); NEUTRAL/muted
// (+ coin icon) = spend ("Uses tokens") — it INFORMS, it must not alarm nor
// celebrate, and crucially it must NOT be brand-orange: orange is reserved for
// the primary action (e.g. "Run your first FREE scan"), so an orange spend badge
// would collide ("go/free" vs "costs") and shout louder than the action itself.
// Muted spend AA-verified in both themes. Styles live in globals.css (.co-cost).

export function CostBadge({ kind, size = "sm", className = "" }: { kind: CostClass; size?: "xs" | "sm"; className?: string }) {
  const tone = kind === "spend" ? "spend" : "free";
  const Icon = kind === "spend" ? Coins : kind === "free-gemini" ? Sparkles : Leaf;
  const meta = COST_META[kind];
  return (
    <span className={`co-cost ${className}`} data-tone={tone} data-size={size} title={meta.tip}>
      <Icon aria-hidden />
      {meta.label}
    </span>
  );
}
