import { notFound } from "next/navigation";
import { readReport, findApplication, trackerCanDelete, type SortKey } from "@/lib/career-ops";
import { ReportView } from "@/components/report-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const paramsObj = await searchParams;
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();

  // Extract filter params from URL
  const tab = typeof paramsObj.tab === "string" ? paramsObj.tab.toUpperCase() : undefined;
  const min = paramsObj.min ? parseFloat(paramsObj.min as string) : undefined;
  const q = typeof paramsObj.q === "string" ? paramsObj.q : undefined;
  const sortKey = (typeof paramsObj.sort === "string" && ["company", "role", "score", "status", "date"].includes(paramsObj.sort) ? paramsObj.sort : "score") as SortKey;
  const sortDir = (paramsObj.dir === "1" ? 1 : -1) as 1 | -1;

  return (
    <ReportView
      id={id}
      app={app}
      report={report?.content ?? null}
      file={report?.file ?? null}
      canDelete={trackerCanDelete()}
      filterParams={{ tab, min, searchQuery: q, sort: { key: sortKey, dir: sortDir } }}
    />
  );
}
