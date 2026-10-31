"use client";

import { useEffect, useEffectEvent, useRef, type RefObject, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { cycleFocusIndex, recoverFocusIndex, tabMovesInsideControl } from "@/lib/modal-focus.mjs";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  labelledBy,
  initialFocusRef,
  children,
  panelClassName,
  overlayClassName,
}: {
  isOpen: boolean;
  onClose: () => void;
  labelledBy: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  panelClassName?: string;
  overlayClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (initialFocusRef?.current ?? focusable()[0])?.focus();
    let shiftTab = false;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      shiftTab = event.shiftKey;
      // The date field uses Tab for month, day, and year. Let the browser
      // handle it. focusin pulls focus back if that Tab leaves the dialog.
      if (tabMovesInsideControl(document.activeElement)) return;
      const items = focusable();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = cycleFocusIndex(current < 0 ? (event.shiftKey ? 0 : items.length - 1) : current, items.length, event.shiftKey);
      event.preventDefault();
      items[next]?.focus();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel?.isConnected) return;
      const target = event.target;
      const items = focusable();
      const index = recoverFocusIndex({
        stayedOnControl: false,
        stillInside: target instanceof Node && panel.contains(target),
        count: items.length,
        backwards: shiftTab,
      });
      if (index < 0) return;
      items[index]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [initialFocusRef, isOpen]);

  if (!isOpen) return null;
  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md transition-opacity", overlayClassName)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn("relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl", panelClassName)}
      >
        {children}
      </div>
    </div>
  );
}
