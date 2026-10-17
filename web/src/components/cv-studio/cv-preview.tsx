"use client";

import { useEffect, useRef, useState } from "react";

const PAGE_WIDTH = 816;

export function CvPreview({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.7);
  const [height, setHeight] = useState(1056);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / PAGE_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(1056, doc.documentElement.scrollHeight));
  };

  return (
    <section aria-label="Live preview" className="rounded-2xl border border-border bg-surface/40 p-3">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted">
        <span>Live preview</span>
        <span>{Math.max(1, Math.ceil(height / 1056))} page{height > 1056 ? "s" : ""} (estimate)</span>
      </div>
      <div ref={box} className="max-h-[80vh] overflow-auto rounded-lg bg-white shadow-sm">
        <div style={{ height: height * scale }}>
          <iframe
            ref={frame}
            title="Tailored CV preview"
            srcDoc={html}
            onLoad={measure}
            sandbox="allow-same-origin"
            style={{ width: PAGE_WIDTH, height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
          />
        </div>
      </div>
    </section>
  );
}
