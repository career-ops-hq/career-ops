import { Skeleton } from "@/components/ui/skeleton";

export default function CvStudioLoading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6" aria-label="Loading the CV Studio">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-5 h-3 w-16" />
      <Skeleton className="mt-2 h-9 w-56" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-[70vh] w-full rounded-2xl" />
      </div>
    </div>
  );
}
