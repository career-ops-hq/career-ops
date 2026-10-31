"use client";

import { useEffect, useRef, useState } from "react";
import { contentHeightPx, frameHeightAfterProbe, frameHeightPx, PREVIEW_PAGE_PX, previewPageCount } from "@/lib/cv-studio/page-estimate.mjs";

const PAGE_WIDTH = 816;

export function CvPreview({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.7);
  const [contentPx, setContentPx] = useState(0);
  const [framePx, setFramePx] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / PAGE_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = () => {
    const frameEl = frame.current;
    const doc = frameEl?.contentDocument;
    if (!frameEl || !doc) return;
    // A .page rule of min-height: 100vh follows this iframe. Measuring at the
    // previous content height makes the next load taller. One page is stable.
    frameEl.style.height = `${PREVIEW_PAGE_PX}px`;
    const content = contentHeightPx(doc);
    const nextFrame = frameHeightPx(doc);
    // Set the measured height on the iframe itself. If the numbers did not
    // change, React skips the state update and would leave the probe height.
    frameEl.style.height = `${frameHeightAfterProbe(nextFrame, frameHeight)}px`;
    if (content > 0) setContentPx(content);
    if (nextFrame > 0) setFramePx(nextFrame);
  };

  const frameHeight = framePx > 0 ? framePx : PREVIEW_PAGE_PX;
  const pages = previewPageCount(contentPx);

  return (
    <section aria-label="Live preview" className="rounded-2xl border border-border bg-surface/40 p-3">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted">
        <span>Live preview</span>
        <span>{pages} page{pages === 1 ? "" : "s"} (estimate)</span>
      </div>
      <div ref={box} className="max-h-[80vh] overflow-auto rounded-lg bg-white shadow-sm">
        <div style={{ height: frameHeight * scale }}>
          <iframe
            ref={frame}
            title="Tailored CV preview"
            srcDoc={html}
            onLoad={measure}
            sandbox="allow-same-origin"
            style={{ width: PAGE_WIDTH, height: frameHeight, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
          />
        </div>
      </div>
    </section>
  );
}
