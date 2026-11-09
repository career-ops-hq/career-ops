import { Radar } from "lucide-react";
import path from "node:path";
import { PortalsView } from "@/components/portals-view";
import { PortalMonitors } from "@/components/portal-monitors";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { loadPortalsDocument, watchedCompanies, type WatchedCompany } from "@/lib/portals-config.mjs";

export const dynamic = "force-dynamic";

function readWatched(): { watched: WatchedCompany[]; missing: boolean; error: string | null } {
  const root = careerOpsRoot();
  try {
    // The template ships with the code, which a data-only CAREER_OPS_ROOT does not hold.
    const template = path.join(resolveCodeRoot(process.cwd(), process.env), "templates", "portals.example.yml");
    const { doc, seeded } = loadPortalsDocument(portalsConfigPath(root), template);
    return { watched: seeded ? [] : watchedCompanies(doc), missing: seeded, error: null };
  } catch (e) {
    return { watched: [], missing: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default function PortalsPage() {
  const { watched, missing, error } = readWatched();
  // Name the file the page reads, which CAREER_OPS_PORTALS can move.
  const target = process.env.CAREER_OPS_PORTALS?.trim() ? portalsConfigPath(careerOpsRoot()) : "portals.yml";
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand-text" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portals</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        View source health and manage saved websites. Add URLs and run or schedule searches from Explore.
      </p>
      <div className="mt-7"><PortalMonitors /></div>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
          Could not read <code>portals.yml</code>: {error}
        </p>
      )}
      <div className="mt-6">
        <PortalsView watched={watched} missing={missing} target={target} />
      </div>
    </div>
  );
}
