"use client";
import { useEffect } from "react";
import { initAppearance } from "@/lib/appearance";

export function FontApplier() {
  useEffect(() => {
    void initAppearance();
  }, []);
  return null;
}
