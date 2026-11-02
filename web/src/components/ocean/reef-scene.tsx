"use client";

import { useVisualTheme } from "@/components/visual-theme-provider";

export function ReefScene() {
  const { visual } = useVisualTheme();
  if (visual !== "ocean") return null;
  return (
    <div aria-hidden="true" className="reef-scene">
      <svg viewBox="0 0 900 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full ">
        <g className="reef-fish"><path d="M0 20c18-17 48-17 65 0-17 17-47 17-65 0Zm65 0 18-14v28Z" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="var(--surface)"/></g>
        <g className="reef-fish reef-fish-two"><path d="M0 14c14-13 38-13 52 0-14 13-38 13-52 0Zm52 0 14-11v22Z" fill="currentColor"/></g>
        <g className="reef-fish reef-fish-three"><path d="M0 12c12-11 34-11 46 0-12 11-34 11-46 0Zm46 0 12-9v18Z" fill="currentColor"/></g>
        <g fill="none" stroke="currentColor" strokeWidth="2"><path className="reef-kelp" d="M70 300Q50 240 75 190t-5-90"/><path className="reef-kelp reef-kelp-two" d="M100 300q30-50 5-100t14-80"/><path className="reef-kelp reef-kelp-three" d="M830 300q-24-55 6-105t-8-90"/></g>
        <g className="reef-jelly" fill="currentColor"><path d="M0 25a28 28 0 0 1 56 0c-7-6-12 6-19 0s-12 6-19 0-12 6-18 0Z"/><path d="M9 27v28m12-26v35m13-35v31m12-34v25" fill="none" stroke="currentColor" strokeWidth="2"/></g>
      </svg>
      <i className="reef-bubble bubble-one"/><i className="reef-bubble bubble-two"/><i className="reef-bubble bubble-three"/><i className="reef-bubble bubble-four"/>
    </div>
  );
}
