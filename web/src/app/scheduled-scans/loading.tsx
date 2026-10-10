import { Skeleton } from "@/components/ui/skeleton";

// Mirrors scheduled-jobs-view.tsx: max-w-5xl container, a serif title, a
// four-up summary row, then the job cards.
//
// Added because tests/lib/route-loading-coverage.test.mjs caught this route
// shipping without one — which is the case that guard exists for: the route
// itself works, and the only symptom is a navigation that leaves the previous
// page on screen with no feedback.
export default function ScheduledScansLoading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8" aria-label="Loading scheduled scans">
      <Skeleton className="h-9 w-60" />
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      <div className="mt-6 grid gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
