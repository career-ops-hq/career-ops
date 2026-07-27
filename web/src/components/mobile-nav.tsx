"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CoMark } from "@/components/co-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { UsageMeter } from "@/components/usage-meter";
import { instrumentSerif } from "@/lib/fonts";
import { NAV_ITEMS, isActivePath } from "@/lib/nav-items";
import { useJobs } from "@/components/jobs/job-store";

// Mobile navigation (< md): a glass top bar + a right-side slide-over drawer that
// mirrors the desktop sidebar (nav + workers + usage + theme). Premium details:
// spring slide, scrim blur, swipe-to-close, body scroll-lock, Escape, focus move,
// safe-area insets (notch / home bar), worker pulse, reduced-motion aware.
// Motion/inset CSS is co-located (env() insets + the Tailwind v4 stale-CSS HMR gotcha).
const STYLE = `
/* Solid bg == the page bg == the theme-color meta, so Safari's top bar / status
   strip / Dynamic Island and the header read as ONE continuous surface (seamless
   on iOS, esp. dark). Top padding = the notch inset PLUS a comfortable base, so
   the title never sits flush/cramped at the top (env() is 0 in browser mode). */
.co-mnav{position:sticky;top:0;z-index:30;background:var(--bg);padding-top:calc(env(safe-area-inset-top) + .8rem)}
.co-mscrim{position:fixed;inset:0;z-index:60;background:rgba(8,8,12,.45);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .3s ease}
.co-mscrim.open{opacity:1;pointer-events:auto}
.co-mdrawer{position:fixed;top:0;right:0;bottom:0;z-index:61;width:min(20rem,86vw);display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;transform:translateX(102%);transition:transform .34s cubic-bezier(.32,.72,0,1);will-change:transform;box-shadow:-16px 0 48px -16px rgba(0,0,0,.4);padding-top:calc(env(safe-area-inset-top) + .25rem)}
.co-mdrawer.open{transform:translateX(0)}
.co-msafe{padding-bottom:calc(1rem + env(safe-area-inset-bottom))}
.co-pulse{animation:co-pulse 1.6s ease-in-out infinite}
@keyframes co-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.co-mdrawer,.co-mscrim{transition:none}.co-pulse{animation:none}}
`;

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { jobs } = useJobs();
  const running = jobs.filter((j) => j.status === "running").length;

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Scroll-lock + Escape + move focus into the drawer while open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // Trap Tab focus within the drawer while open.
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("a, button")?.focus(), 60);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  // Swipe-right-to-close.
  const drag = useRef({ x0: 0, dx: 0, active: false });
  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = { x0: e.touches[0].clientX, dx: 0, active: true };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current.active || !panelRef.current) return;
    const dx = Math.max(0, e.touches[0].clientX - drag.current.x0);
    drag.current.dx = dx;
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateX(${dx}px)`;
  };
  const onTouchEnd = () => {
    if (!panelRef.current) return;
    panelRef.current.style.transition = "";
    panelRef.current.style.transform = "";
    if (drag.current.dx > 90) setOpen(false);
    drag.current.active = false;
  };

  return (
    <>
      <style>{STYLE}</style>

      <header className="co-mnav flex items-center gap-2 border-b border-border px-4 pb-3 md:hidden">
        <Link href="/" className="flex min-h-[44px] items-center gap-2" aria-label="career-ops home">
          <CoMark size={26} />
          <span className={`${instrumentSerif.className} relative -top-px text-xl text-landing`}>career-ops</span>
        </Link>
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Menu className="size-5" />
            {running > 0 && <span aria-hidden className="co-pulse absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" />}
          </button>
        </div>
      </header>

      <div className={cn("co-mscrim md:hidden", open && "open")} onClick={() => setOpen(false)} aria-hidden />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        inert={!open}
        className={cn("co-mdrawer border-l border-border bg-surface md:hidden", open && "open")}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className={`${instrumentSerif.className} text-lg text-landing`}>Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon, chip }) => {
            const active = isActivePath(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] transition-colors",
                  active ? "bg-brand-soft text-brand-text" : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
                {chip && (
                  <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                    {chip}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3">
          <WorkerPills />
        </div>

        <div className="co-msafe mt-auto space-y-3 border-t border-border px-4 pt-4">
          <UsageMeter />
          <div className="flex items-center justify-between">
            <span className={`${instrumentSerif.className} text-sm text-faint`}>local-first · v0</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
