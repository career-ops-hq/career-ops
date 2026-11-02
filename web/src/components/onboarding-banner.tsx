"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Settings } from "lucide-react";
import { SETUP_BANNER_KEY, bannerStaysDismissed, setupBannerDismissKey } from "@/lib/home/setup-banner.mjs";

type Doctor = { available: boolean; onboardingNeeded: boolean; missing: string[]; warnings: string[] };

function hasCli(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId;
  } catch {
    return false;
  }
}

const LABELS: Record<string, string> = {
  "cv.md": "your CV",
  "config/profile.yml": "your profile — target roles, comp, location",
  "modes/_profile.md": "your personalization",
  "portals.yml": "the companies to scan",
};

// Detect (via the core's doctor.mjs) whether setup is incomplete, and offer to
// finish it CONVERSATIONALLY — the assistant asks in plain language and writes
// the canonical files (no YAML to edit). This is the #1 adoption barrier.
export function OnboardingBanner() {
  const [d, setD] = useState<Doctor | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cli, setCli] = useState(true); // assume until read (avoid CTA flash)

  useEffect(() => {
    setCli(hasCli());
    // Re-read after setup changes. router.refresh() keeps this component's
    // state, so a dismissal for the old missing set would otherwise stick.
    const refresh = () => {
      fetch("/api/doctor")
        .then((r) => r.json())
        .then((doctor: Doctor) => {
          setD(doctor);
          try {
            setDismissed(bannerStaysDismissed(localStorage.getItem(SETUP_BANNER_KEY), doctor.missing));
          } catch {
            // A blocked storage read just shows the banner again.
            setDismissed(false);
          }
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("co-onboarding-changed", refresh);
    return () => window.removeEventListener("co-onboarding-changed", refresh);
  }, []);

  if (dismissed || !d || !d.onboardingNeeded) return null;
  const items = d.missing.map((m) => LABELS[m] ?? m);
  const kickoff =
    `Help me finish setting up career-ops. I still need to add ${items.join(", ")} — walk me through just those, conversationally, and write the files for me. Don't ask me for anything that's already set up (for example, don't ask for my CV if it's already saved).`;

  return (
    <div className="dot-bg relative mb-6 overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 via-surface/40 to-transparent p-5">
      <button
        onClick={() => {
          try {
            localStorage.setItem(SETUP_BANNER_KEY, setupBannerDismissKey(d.missing));
          } catch {
            // Dismiss still hides the banner for this visit.
          }
          setDismissed(true);
        }}
        className="absolute right-3 top-3 text-faint transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
      <h2 className="font-display text-xl text-landing">Let&apos;s finish setting you up</h2>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        career-ops works best when it knows you. We still need {items.join(", ")}.{" "}
        <span className="text-foreground">No YAML to edit</span> — answer in plain language and the assistant writes it
        for you.
      </p>
      {cli ? (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message: kickoff } }))}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Sparkles className="size-4" /> Set me up with the assistant
        </button>
      ) : (
        // The assistant needs a CLI to run — without one the kickoff would silently
        // drop. Send them to connect one first.
        <Link
          href="/config"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Settings className="size-4" /> Connect your AI CLI to get started
        </Link>
      )}
    </div>
  );
}
