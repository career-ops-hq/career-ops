/**
 * Role → search keyword expansions for Explore's "Add by role" control.
 * Profile roles from config/profile.yml are merged in at runtime.
 */

export type RolePreset = {
  id: string;
  label: string;
  keywords: string[];
};

/** Built-in presets — profile.yml roles with the same label reuse these keywords. */
export const BUILTIN_ROLE_PRESETS: RolePreset[] = [
  {
    id: "ai-product-manager",
    label: "AI Product Manager",
    keywords: ["AI Product Manager", "Product Manager", "GenAI", "LLM", "AI PM", "ML Product"],
  },
  {
    id: "solutions-consultant",
    label: "Solutions Consultant",
    keywords: ["Solutions Consultant", "Solutions Architect", "Solutions Engineer", "Pre-sales", "Customer Engineer"],
  },
  {
    id: "ai-transformation",
    label: "AI Transformation Consultant",
    keywords: ["AI Transformation", "Transformation Consultant", "GenAI", "Automation", "AI Consultant"],
  },
  {
    id: "technical-pm",
    label: "Technical Product Manager",
    keywords: ["Technical Product Manager", "Technical PM", "Platform PM", "AI Product"],
  },
  {
    id: "solutions-architect",
    label: "Solutions Architect",
    keywords: ["Solutions Architect", "Cloud Architect", "Enterprise Architect", "Pre-sales Architect"],
  },
  {
    id: "forward-deployed",
    label: "Forward Deployed Engineer",
    keywords: ["Forward Deployed", "Deployed Engineer", "Field Engineer", "Solutions Engineer"],
  },
  {
    id: "ml-engineer",
    label: "ML Engineer",
    keywords: ["ML Engineer", "Machine Learning Engineer", "MLOps", "LLM Engineer"],
  },
  {
    id: "ai-engineer",
    label: "AI Engineer",
    keywords: ["AI Engineer", "LLM", "GenAI", "Agent", "RAG"],
  },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Keywords to add when the user picks or types a role label. */
export function keywordsForRole(label: string, extraPresets: RolePreset[] = []): string[] {
  const trimmed = label.trim();
  if (!trimmed) return [];
  const n = norm(trimmed);
  const all = [...BUILTIN_ROLE_PRESETS, ...extraPresets];
  const exact = all.find((p) => norm(p.label) === n || p.id === trimmed);
  if (exact) return [...exact.keywords];
  const partial = all.find((p) => norm(p.label).includes(n) || n.includes(norm(p.label)));
  if (partial) return [...partial.keywords];
  return [trimmed];
}

/** Profile target roles + builtins, deduped by label. */
export function mergeRolePresets(profileRoles: string[]): RolePreset[] {
  const byLabel = new Map<string, RolePreset>();
  for (const p of BUILTIN_ROLE_PRESETS) byLabel.set(norm(p.label), p);
  for (const raw of profileRoles) {
    const label = String(raw).trim();
    if (!label) continue;
    const key = norm(label);
    if (byLabel.has(key)) continue;
    byLabel.set(key, {
      id: `profile-${key.replace(/\s+/g, "-")}`,
      label,
      keywords: keywordsForRole(label),
    });
  }
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}
