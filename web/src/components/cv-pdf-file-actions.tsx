"use client";

import { useState } from "react";
import { pdfDownloadHref, pdfRevealHref } from "@/lib/cv-pdf-query.mjs";

export function CvPdfFileActions({ viewHref, className }: { viewHref: string; className: string }) {
  const [error, setError] = useState("");

  async function reveal() {
    setError("");
    try {
      const res = await fetch(pdfRevealHref(viewHref), { method: "POST" });
      if (!res.ok) {
        const text = (await res.text()).trim();
        setError(text || "Could not reveal the file.");
      }
    } catch {
      setError("Could not reveal the file.");
    }
  }

  return (
    <>
      <a href={pdfDownloadHref(viewHref)} className={className}>
        Download PDF
      </a>
      <button type="button" className={className} title="Reveal the file" onClick={reveal}>
        Show in Finder
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </>
  );
}
