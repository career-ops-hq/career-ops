import { Skeleton } from "@/components/ui/skeleton";

export default function ApplyLoading() {
  return (
    <div className="relative min-h-screen" aria-label="Loading application assistant">
      <div className="relative z-10 mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-center gap-3">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <Skeleton className="mt-2 h-4 w-5/6 max-w-xl" />

        <div className="mt-6 flex max-w-2xl items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-5 flex-1" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}
