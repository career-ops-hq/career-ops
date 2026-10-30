"use client";

import { Suspense } from "react";
import { RouteProgress } from "@/components/route-progress";

export function RouteProgressHost() {
  return (
    <Suspense fallback={null}>
      <RouteProgress />
    </Suspense>
  );
}
