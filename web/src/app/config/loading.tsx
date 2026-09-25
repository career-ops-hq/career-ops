import { Skeleton } from "@/components/ui/skeleton";

export default function ConfigLoading() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10" aria-label="Loading configuration">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />

      <Skeleton className="mb-2 mt-8 h-3 w-24" />
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface/40 p-4">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-5">
        <div>
          <Skeleton className="mb-1 h-4 w-80 max-w-full" />
          <Skeleton className="mb-3 h-3 w-72 max-w-full" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3">
                <Skeleton className="size-4 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="ml-auto h-3 w-28" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-14 w-full rounded-xl" />
        </div>
      </div>

      <Skeleton className="mb-2 mt-8 h-3 w-24" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="mt-8 flex items-center gap-3">
        <Skeleton className="h-10 w-28 rounded-full" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}
