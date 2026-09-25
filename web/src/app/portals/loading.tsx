import { Skeleton } from "@/components/ui/skeleton";

export default function PortalsLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8" aria-label="Loading portals">
      <div className="flex items-center gap-3">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-5/6 max-w-xl" />
      <Skeleton className="mt-3 h-3 w-64" />
      <div className="mt-6 flex items-center gap-3">
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}
