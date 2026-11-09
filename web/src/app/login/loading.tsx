import { Skeleton } from "@/components/ui/skeleton";

export default function LoginLoading() {
  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:py-20" aria-label="Loading sign in">
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <section>
          <div className="flex items-center gap-3"><Skeleton className="size-[38px] rounded-md" /><Skeleton className="h-9 w-40" /></div>
          <Skeleton className="mt-8 h-16 w-full max-w-2xl" />
          <Skeleton className="mt-5 h-5 w-full max-w-xl" />
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-4">
                <Skeleton className="mb-3 size-5 rounded-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-4/5" />
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xl sm:p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-3 h-4 w-full" />
          <div className="mt-6 space-y-4">
            <div><Skeleton className="mb-1.5 h-4 w-16" /><Skeleton className="h-12 w-full rounded-lg" /></div>
            <div><Skeleton className="mb-1.5 h-4 w-20" /><Skeleton className="h-12 w-full rounded-lg" /></div>
            <Skeleton className="h-11 w-full rounded-full" />
            <Skeleton className="h-11 w-full rounded-full" />
            <Skeleton className="mx-auto h-4 w-40" />
          </div>
        </section>
      </div>
    </main>
  );
}
