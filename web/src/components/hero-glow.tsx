"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The career-ops-docs home signature: an animated grain-gradient glow. Deferred
// to browser idle, skipped on reduced-motion, ssr:false → zero LCP cost. Renders
// grain in the corners (transparent center) so the dot-grid shows through.
const GrainGradient = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.GrainGradient),
  { ssr: false },
);

export function HeroGlow() {
  const [show, setShow] = useState(false);
  const [dark, setDark] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const readTheme = () => setDark(document.documentElement.classList.contains("dark"));
    readTheme();
    window.addEventListener("themechange", readTheme);

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout?: number }) => number;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(() => setShow(true), { timeout: 2000 });
    } else {
      timer = setTimeout(() => setShow(true), 400);
    }

    return () => {
      window.removeEventListener("themechange", readTheme);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <GrainGradient
      className="absolute inset-0 z-0 animate-fade-in-delayed"
      colors={dark ? ["#D5742E", "#9c2f05", "#7A2A0000"] : ["#f6c89a", "#e8a35f", "#D5742E00"]}
      colorBack="#00000000"
      softness={1}
      intensity={dark ? 0.42 : 0.26}
      noise={0.32}
      speed={0.45}
      shape="corners"
      minPixelRatio={1}
      maxPixelCount={1920 * 1080}
    />
  );
}
