import { CvStudio } from "@/components/cv-studio/cv-studio";

export const dynamic = "force-dynamic";

export default async function CvStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CvStudio n={id} />;
}
