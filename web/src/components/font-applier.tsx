"use client";
import { useEffect } from "react";
import { applyAppearance, loadAppearance, loadAppearanceFromServer } from "@/lib/appearance";

export function FontApplier() {
  useEffect(() => {
    applyAppearance(loadAppearance());
    loadAppearanceFromServer()
      .then((a) => {
        if (!a) return;
        applyAppearance(a);
        window.dispatchEvent(new Event("appearancechange"));
      })
      .catch(() => {});
  }, []);
  return null;
}
