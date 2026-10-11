import { Skeleton } from "@/components/ui/skeleton";

export default function InternshipsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-6 rounded" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      </div>
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${60 + (i % 3) * 16}px` }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 mb-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
