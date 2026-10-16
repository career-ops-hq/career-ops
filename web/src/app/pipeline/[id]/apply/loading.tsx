import { Skeleton } from "@/components/ui/skeleton";

export default function ApplyLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8" aria-label="Loading apply checklist">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-5 h-3 w-24" />
      <Skeleton className="mt-3 h-10 w-64 max-w-[70%]" />
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
