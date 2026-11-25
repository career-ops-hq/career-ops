import { Skeleton } from "@/components/ui/skeleton";

export default function ReportLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24" aria-label="Loading report">
      <Skeleton className="h-4 w-28" />
      <header className="mt-5">
        <Skeleton className="h-3 w-12" />
        <div className="mt-2 flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-10 w-64 max-w-[70%]" />
        </div>
        <Skeleton className="mt-2 h-4 w-48" />
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-3 w-72 max-w-full" />
      </header>

      <div className="mt-8 max-w-4xl">
        <div className="rounded-2xl border border-brand/25 bg-brand-soft/50 px-5 py-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
        </div>
        <div className="mt-6 space-y-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mt-3 overflow-hidden rounded-xl border border-border bg-surface/30">
            <div className="flex min-h-[44px] items-center gap-2 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto size-4 rounded-full" />
            </div>
          </div>
        ))}
        <div className="mt-6 flex items-center gap-3"><Skeleton className="h-px flex-1" /><Skeleton className="h-3 w-36" /><Skeleton className="h-px flex-1" /></div>
        <Skeleton className="mt-4 h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
