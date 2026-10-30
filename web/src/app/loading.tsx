import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24" aria-label="Loading today">
      <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <div className="relative z-10">
          <Skeleton className="h-3 w-44" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-10 w-full max-w-4xl md:h-12" />
            <Skeleton className="h-10 w-4/5 max-w-3xl md:h-12" />
          </div>
          <div className="mt-5 space-y-2">
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-4 w-5/6 max-w-lg" />
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Skeleton className="h-10 w-36 rounded-full" />
            <Skeleton className="h-10 w-32 rounded-full" />
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="hidden h-3 w-64 sm:block" />
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface/40 p-3.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-5 h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
