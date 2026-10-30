// Structured personalization for modes/_profile.md — the pure logic behind
// /api/personalization and the setPersonalization action.
//
// Why this exists: doctorState() lists four user-layer prerequisites, and the
// web could already write three of them (cv.md via the CV editor,
// config/profile.yml + portals.yml via the confirm-gated setProfile). The
// fourth, modes/_profile.md, only ever received appended "web notes" — its
// eight structured sections (archetypes, framing, narrative, comp, location…)
// stayed identical to the shipped template, so doctor kept warning that
// "evaluations score against the template author's targeting, not yours".
// This module fills exactly those sections, by heading, and nothing else.
//
// Contract with the rest of the file: every `## Your …` section the template
// ships is addressed by its heading; a write replaces ONLY the body of the
// sections it was given, keeps every other byte (other sections, the
// `<!-- co-web-notes -->` block the assistant appends to, anything the CLI
// intake mode or the user wrote by hand), and appends a section whose heading
// is missing rather than reordering the file. Plain .mjs so tests import it.
//
// This half is also imported by the action registry, which runs in the browser:
// it must stay free of node:fs. The merge and the file access live in
// personalization-file.mjs.

/** The eight template sections, in template order. `id` is the API/JSON key. */
export const SECTIONS = [
  { id: "targetRoles", heading: "## Your Target Roles" },
  { id: "adaptiveFraming", heading: "## Your Adaptive Framing" },
  { id: "exitNarrative", heading: "## Your Exit Narrative" },
  { id: "crossCuttingAdvantage", heading: "## Your Cross-cutting Advantage" },
  { id: "portfolio", heading: "## Your Portfolio / Demo" },
  { id: "compTargets", heading: "## Your Comp Targets" },
  { id: "negotiationScripts", heading: "## Your Negotiation Scripts" },
  { id: "locationPolicy", heading: "## Your Location Policy" },
];

const str = (v, max = 600) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);
const strList = (v, max = 8) =>
  Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : undefined;
// Markdown table cells cannot contain a pipe or a newline; scrub rather than reject.
const cell = (v) => (str(v, 200) ?? "").replace(/\|/g, "/");

/**
 * Hand-validate a raw setPersonalization payload (house style: no zod; keep
 * only well-formed fields). Unknown keys are dropped, junk rows are dropped,
 * and an empty result means "nothing to write".
 */
export function coercePersonalization(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};

  if (Array.isArray(raw.targetRoles)) {
    const rows = raw.targetRoles
      .map((r) => (r && typeof r === "object" ? { archetype: str(r.archetype, 80), axes: str(r.axes, 200), buys: str(r.buys, 200) } : null))
      .filter((r) => r && r.archetype)
      .slice(0, 8);
    if (rows.length) out.targetRoles = rows;
  }
  if (Array.isArray(raw.adaptiveFraming)) {
    const rows = raw.adaptiveFraming
      .map((r) => (r && typeof r === "object" ? { role: str(r.role, 80), emphasize: str(r.emphasize, 200), proof: str(r.proof, 160) } : null))
      .filter((r) => r && r.role && r.emphasize)
      .slice(0, 8);
    if (rows.length) out.adaptiveFraming = rows;
  }
  const exit = str(raw.exitNarrative, 1200);
  if (exit) out.exitNarrative = exit;
  const cross = str(raw.crossCuttingAdvantage, 600);
  if (cross) out.crossCuttingAdvantage = cross;
  if (raw.portfolio && typeof raw.portfolio === "object") {
    const url = str(raw.portfolio.url, 300);
    if (url && /^https?:\/\//i.test(url)) {
      out.portfolio = { url, description: str(raw.portfolio.description, 300), whenToShare: str(raw.portfolio.whenToShare, 200) };
    }
  }
  const comp = str(raw.compTargets, 800);
  if (comp) out.compTargets = comp;
  const scripts = strList(raw.negotiationScripts, 6);
  if (scripts?.length) out.negotiationScripts = scripts;
  const loc = strList(raw.locationPolicy, 8);
  if (loc?.length) out.locationPolicy = loc;
  return out;
}

/** Render one section body (no heading) from its coerced value. */
export function renderSection(id, value) {
  switch (id) {
    case "targetRoles":
      return [
        "| Archetype | Thematic axes | What they buy |",
        "|-----------|---------------|---------------|",
        ...value.map((r) => `| **${cell(r.archetype)}** | ${cell(r.axes)} | ${cell(r.buys)} |`),
      ].join("\n");
    case "adaptiveFraming":
      return [
        "| If the role is... | Emphasize about you... | Proof point sources |",
        "|-------------------|------------------------|---------------------|",
        ...value.map((r) => `| ${cell(r.role)} | ${cell(r.emphasize)} | ${cell(r.proof) || "cv.md"} |`),
      ].join("\n");
    case "exitNarrative":
    case "crossCuttingAdvantage":
    case "compTargets":
      // Prose passthrough — but never let a body open with its own `## `: the
      // merge finds sections by heading, so that would silently start a new
      // section instead of filling this one.
      return String(value).replace(/^\s*#{1,6}\s+/, "");
    case "portfolio":
      return [
        `- url: ${value.url}`,
        value.description ? `- what: ${value.description}` : null,
        value.whenToShare ? `- when_to_share: ${value.whenToShare}` : null,
      ].filter(Boolean).join("\n");
    case "negotiationScripts":
      return value.map((s) => `> "${s.replace(/^["“]|["”]$/g, "")}"`).join("\n\n");
    case "locationPolicy":
      return value.map((l) => `- ${l}`).join("\n");
    default:
      return "";
  }
}

