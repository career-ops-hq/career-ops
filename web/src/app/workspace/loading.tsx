import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10" role="status">
      <span className="sr-only">Loading workspace...</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      <div className="mt-8 space-y-3 rounded-xl border border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}