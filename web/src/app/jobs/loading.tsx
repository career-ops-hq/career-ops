import { Skeleton } from "@/components/ui/skeleton";

export default function JobsLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10" aria-label="Loading workers">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-0">
            <Skeleton className="size-4 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-10 rounded-md" />
            <Skeleton className="hidden h-3 w-14 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
