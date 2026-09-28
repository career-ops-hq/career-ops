"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { shouldShowBackToTop, scrollBehaviorFor } from "@/lib/scroll-to-top.mjs";

// Floating control that returns the window to the top of long pages. Rendered
// once from the app shell. The window is the scroll container here (main has no
// own overflow-y), so it listens on window scroll and calls window.scrollTo.
//
// It sits one row above the assistant launcher, which owns bottom-5 right-5, so
// the two never overlap; a lower z-index lets an open assistant panel cover it
// cleanly. When hidden it's also removed from the tab order and hidden from
// assistive tech, so there's nothing to land on until it's actually usable.
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(shouldShowBackToTop(window.scrollY));
    onScroll(); // sync once in case we mount already scrolled (restored position)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toTop = () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: scrollBehaviorFor(prefersReducedMotion) });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "fixed bottom-20 right-5 z-40 flex size-11 items-center justify-center rounded-full",
        "border border-border bg-surface/90 text-muted shadow-lg backdrop-blur",
        "transition-[opacity,transform,color,background-color] duration-200",
        "hover:bg-surface-hover hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        visible ? "opacity-100 translate-y-0" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
