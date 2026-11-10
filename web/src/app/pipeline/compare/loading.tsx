import { Skeleton } from "@/components/ui/skeleton";

export default function CompareLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24" role="status">
      <span className="sr-only">Loading comparison…</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-5 h-8 w-36" />
      <div className="mt-6 space-y-3 rounded-2xl border border-border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
