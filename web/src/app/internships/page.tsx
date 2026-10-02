import { Suspense } from "react";
import { InternshipsView } from "@/components/internships/internships-view";

export const dynamic = "force-dynamic";

export default function InternshipsPage() {
  return (
    <Suspense>
      <InternshipsView />
    </Suspense>
  );
}
