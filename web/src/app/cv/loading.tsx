import { Skeleton } from "@/components/ui/skeleton";

export default function CvLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8" aria-label="Loading CV editor">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-24 rounded-full" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="min-h-[60vh] rounded-2xl border border-border bg-surface/50 p-4">
          <div className="space-y-3">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <article className="report-prose min-h-[60vh] overflow-hidden rounded-2xl border border-border bg-surface/30 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-5/6" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-8 h-5 w-1/2" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-4/5" />
        </article>
      </div>
    </div>
  );
}
