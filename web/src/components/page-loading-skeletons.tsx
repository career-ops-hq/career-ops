import { Skeleton } from "@/components/ui/skeleton";

export function FollowupsDueSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="mt-10" aria-label="Loading follow-ups due">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-64 max-w-[50vw]" />
      </div>
      <div className="grid gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface/40 px-3.5 py-3">
            <div className="flex min-w-0 flex-[1_1_55%] items-center gap-3">
              <Skeleton className="size-[22px] shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Skeleton className="h-7 w-28 rounded-md" />
              <Skeleton className="size-6 rounded" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PipelineTableRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          </td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-12 rounded-full" /></td>
          <td className="whitespace-nowrap px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-1.5 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </td>
          <td className="whitespace-nowrap px-4 py-3"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
  );
}

export function PipelinePageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24" aria-label="Loading pipeline">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-64 max-w-[40vw] rounded-md" />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-8 rounded-sm" style={{ width: `${56 + (i % 4) * 12}px` }} />
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              {Array.from({ length: 5 }).map((_, i) => (
                <th key={i} className="px-4 py-2.5">
                  <Skeleton className="h-3" style={{ width: `${48 + (i % 3) * 20}px` }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <PipelineTableRowsSkeleton />
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FollowupsTableRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          <td className="px-2 py-3"><Skeleton className="size-4 rounded-sm" /></td>
          <td className="px-2.5 py-3"><div className="flex items-center gap-2.5"><Skeleton className="size-5 rounded-full" /><Skeleton className="h-4 w-24" /></div></td>
          <td className="px-2.5 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-5 w-12 rounded-full" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-5 w-20 rounded-md" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-4 w-8" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-4 w-16" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-4 w-8" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-4 w-8" /></td>
          <td className="px-2.5 py-3"><Skeleton className="h-6 w-20 rounded-md" /></td>
        </tr>
      ))}
    </>
  );
}

export function FollowupsPageSkeleton() {
  return (
    <div className="mx-auto max-w-none px-6 py-8" aria-label="Loading follow-ups">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
          <Skeleton className="mt-3 h-3 w-full max-w-3xl" />
          <Skeleton className="mt-1 h-3 w-4/5 max-w-2xl" />
        </div>
        <Skeleton className="h-9 w-56 max-w-[35vw] rounded-md" />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-sm" />)}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="w-8 px-2 py-2.5"><Skeleton className="h-3 w-3" /></th>
              {Array.from({ length: 10 }).map((_, i) => (
                <th key={i} className="px-2.5 py-2.5"><Skeleton className="h-3" style={{ width: `${40 + (i % 3) * 18}px` }} /></th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <FollowupsTableRowsSkeleton />
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AnalyticsPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10" aria-label="Loading analytics">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-64" />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface/50 p-4">
            <Skeleton className="h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>

      {Array.from({ length: 3 }).map((_, section) => (
        <section key={section} className="mt-10">
          <Skeleton className="h-3 w-36" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: section === 2 ? 5 : 9 }).map((__, row) => (
              <div key={row} className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.8fr)_auto] items-center gap-3">
                <Skeleton className="h-4 w-24 max-w-full" />
                <Skeleton className="h-2 rounded-full" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
