"use client";

import { useEffect, useRef, type RefObject, type ReactNode } from "react";
import { cycleFocusIndex } from "@/lib/scheduled-overlay-focus.mjs";

export function ScheduledOverlay({
  isOpen,
  onClose,
  titleId,
  initialFocusRef,
  children,
  panelClassName = "",
  overlayClassName = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  panelClassName?: string;
  overlayClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef?.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || []);
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = cycleFocusIndex(current < 0 ? (event.shiftKey ? 0 : focusable.length - 1) : current, focusable.length, event.shiftKey);
      event.preventDefault();
      focusable[next]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md transition-opacity ${overlayClassName}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl ${panelClassName}`}>
        {children}
      </div>
    </div>
  );
}
