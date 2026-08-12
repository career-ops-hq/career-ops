import { CvTailoringWorkspace } from "@/components/cv-tailoring/cv-tailoring-workspace";

export const dynamic = "force-dynamic";

export default async function CvTailorJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <CvTailoringWorkspace jobId={jobId} />;
}
