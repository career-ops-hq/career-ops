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
        The companies career-ops watches for new roles. Run a health check to catch company boards that have quietly
        broken — a broken link means that company silently disappears from every future scan.
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
