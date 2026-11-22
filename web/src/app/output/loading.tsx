import { Skeleton } from "@/components/ui/skeleton";

export default function PreparationLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4 p-4" aria-label="Loading preparation files">
      <div className="w-72 shrink-0 space-y-2 rounded border border-border bg-surface/30 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
      <div className="min-w-0 flex-1 rounded border border-border p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
    </div>
  );
}
