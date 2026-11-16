"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";

export function PortalMonitorNotice() {
  const [notice, setNotice] = useState<{ count: number; ids: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/portals/monitors", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (alive) setNotice({ count: data.unreadCount, ids: data.notices.filter((n: { read: boolean }) => !n.read).map((n: { id: string }) => n.id) });
      } catch { /* Portals shows persistent read errors; do not interrupt other pages. */ }
    };
    void load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("portal-monitors-changed", load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("portal-monitors-changed", load); };
  }, []);

  async function dismiss() {
    try {
      const response = await fetch("/api/portals/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", ids: notice?.ids || [] }) });
      if (response.ok) { setNotice(null); window.dispatchEvent(new Event("portal-monitors-changed")); }
    } catch { /* Keep the notice visible until acknowledgement succeeds. */ }
  }
  if (!notice?.count) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-brand/25 bg-brand-soft px-6 py-3 text-sm text-brand-text">
      <Bell className="size-4 shrink-0" />
      <span>{notice.count} newly found {notice.count === 1 ? "job" : "jobs"} from your monitored websites.</span>
      <Link href="/pipeline?tab=INBOX" className="ml-auto shrink-0 font-medium underline underline-offset-4">Open inbox</Link>
      <Link href="/portals" className="hidden shrink-0 underline underline-offset-4 sm:inline">View checks</Link>
      <button onClick={dismiss} aria-label="Dismiss new job notification" className="rounded p-1.5 hover:bg-surface-hover"><X className="size-4" /></button>
    </div>
  );
}
