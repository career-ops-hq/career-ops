import { Suspense } from "react";
import { UploadsView } from "@/components/uploads/uploads-view";

export const dynamic = "force-dynamic";

export default function UploadsPage() {
  return (
    <Suspense>
      <UploadsView />
    </Suspense>
  );
}
