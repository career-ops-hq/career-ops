import { Send } from "lucide-react";
import { ApplyView } from "@/components/apply-view";
import { ApplyBackdropMount } from "@/components/apply/apply-backdrop-mount";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return (
    <div className="relative min-h-screen">
      {/* full-viewport blurred form wallpaper (behind everything) */}
      <ApplyBackdropMount />
      <div className="relative z-10 mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-center gap-3">
          <Send className="size-6 text-brand" />
          <h1 className="font-display text-2xl tracking-tight text-landing">Apply</h1>
        </div>
        <p className="mt-1.5 max-w-xl text-sm text-muted">
          career-ops reads the real application form on your machine and re-renders it here in plain language, pre-filled
          from your CV. You verify every answer — then it fills the real form behind the scenes and you submit it yourself.
          It never submits for you.
        </p>
        <div className="mt-6">
          <ApplyView />
        </div>
      </div>
    </div>
  );
}
