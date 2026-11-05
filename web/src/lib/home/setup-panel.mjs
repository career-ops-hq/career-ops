// What Today does with the setup checklist.
//
// Required setup is the four files doctor already tracks. The evaluation
// sections are optional once those files exist. A finished setup does not
// keep a "4/12" panel under the queue. Leftover optional sections collapse
// to one link.

import { PREREQS, onboardingChecklist } from "./onboarding-checklist.mjs";

/**
 * @param {{ missing?: string[], sections?: { heading: string, state: string }[], compact?: boolean }} input
 * @returns {{ mode: "hidden" | "link" | "checklist", remaining: number, showSections: boolean, done: number, total: number, asks: string[] }}
 */
export function setupPanelMode({ missing, sections, compact = false }) {
  const missingList = Array.isArray(missing) ? missing : [];
  const checklist = onboardingChecklist({
    missing: missingList,
    sections: Array.isArray(sections) ? sections : [],
    compact,
  });
  const requiredOpen = PREREQS.some((item) => missingList.includes(item.key));
  const remaining = Math.max(0, checklist.total - checklist.done);
  let mode = "checklist";
  if (remaining === 0) mode = "hidden";
  else if (!requiredOpen) mode = "link";
  return { mode, remaining, ...checklist };
}

/** The collapsed control. It never prints a done/total fraction. */
export function setupPanelLabel(panel) {
  if (!panel || panel.mode !== "link") return "";
  const left = panel.remaining === 1 ? "1 left" : `${panel.remaining} left`;
  return `Optional profile details (${left})`;
}
