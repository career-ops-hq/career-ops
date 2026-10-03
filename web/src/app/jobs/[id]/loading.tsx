import { Skeleton } from "@/components/ui/skeleton";

export default function JobLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8" aria-label="Loading worker">
      <div className="flex items-center gap-2"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-4 w-20" /></div>
      <section className="dot-bg relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface/40 px-6 py-7">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-8 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/2" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-12 rounded-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </section>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-border bg-surface/40 p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-5/6" />
        <Skeleton className="mt-3 h-4 w-4/5" />
      </div>
    </div>
  );
}
