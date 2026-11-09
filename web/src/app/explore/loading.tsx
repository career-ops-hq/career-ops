import { Skeleton } from "@/components/ui/skeleton";

export default function ExploreLoading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8" aria-label="Loading job discovery">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-xl sm:ml-auto sm:w-48" />
        </div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-5/6 max-w-xl" />
        </div>
      </header>

      <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
        <div className="space-y-4">
          <div>
            <Skeleton className="mb-2 h-4 w-28" />
            <Skeleton className="h-[42px] w-full rounded-xl" />
          </div>
          <div>
            <Skeleton className="mb-2 h-4 w-20" />
            <Skeleton className="h-[42px] w-full rounded-xl" />
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <Skeleton className="mb-2 h-4 w-28" />
              <Skeleton className="h-8 w-44 rounded-lg" />
            </div>
            <div>
              <Skeleton className="mb-2 h-4 w-20" />
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-16 rounded-full" />)}
              </div>
            </div>
          </div>
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-36 rounded-xl" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
