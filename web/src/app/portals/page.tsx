import { Radar } from "lucide-react";
import { PortalsView } from "@/components/portals-view";

export const dynamic = "force-dynamic";

export default function PortalsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portals</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        ATS health for <code className="text-muted">tracked_companies</code> — catch broken Greenhouse / Ashby / Lever
        links before they silently drop out of scans. Job boards in <code className="text-muted">job_boards</code>{" "}
        (Instahyre, Wellfound, We Work Remotely, …) are scanned from Pipeline → Portal scan, not this page.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        Backed by <code className="text-muted">portals.yml</code> — edit it directly or ask the assistant.
      </p>
      <div className="mt-6">
        <PortalsView />
      </div>
    </div>
  );
}
