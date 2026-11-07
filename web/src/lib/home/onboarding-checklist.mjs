// The setup checklist's counts and the assistant prompt, kept apart from the
// component so node --test can check them.

/**
 * The same four keys /api/doctor reports in `missing`, so the panel cannot
 * count itself done while doctor still says onboarding is incomplete.
 * modes/_profile.md has no `ask` in the full list: when it is absent its eight
 * sections are all "missing", and the personalization line asks for them.
 * Compact mode hides those sections, so it asks for the file by name.
 */
export const PREREQS = [
  { key: "cv.md", label: "Your CV", ask: "my CV" },
  { key: "config/profile.yml", label: "Profile — target roles, comp, location", ask: "my profile (target roles, comp, location)" },
  { key: "modes/_profile.md", label: "Personalization file", compactAsk: "my personalization file (modes/_profile.md)" },
  { key: "portals.yml", label: "Companies and roles to scan", ask: "the roles and companies to scan" },
];

/**
 * @param {{ missing: string[], sections: { heading: string, state: string }[], compact?: boolean }} input
 * @returns {{ showSections: boolean, done: number, total: number, asks: string[] }}
 */
export function onboardingChecklist({ missing, sections, compact = false }) {
  const missingSet = new Set(missing);
  const showSections = !compact;
  const generic = sections.filter((s) => s.state !== "filled");
  const prereqDone = PREREQS.filter((p) => !missingSet.has(p.key)).length;
  const sectionTotal = showSections ? sections.length : 0;
  const sectionDone = showSections ? sections.length - generic.length : 0;
  const asks = [
    ...PREREQS.filter((p) => missingSet.has(p.key)).flatMap((p) => {
      const ask = p.ask ?? (showSections ? undefined : p.compactAsk);
      return ask ? [ask] : [];
    }),
    ...(showSections && generic.length
      ? [`my personalization (${generic.map((s) => s.heading.replace(/^## Your /, "").toLowerCase()).join(", ")})`]
      : []),
  ];
  return { showSections, done: prereqDone + sectionDone, total: PREREQS.length + sectionTotal, asks };
}
