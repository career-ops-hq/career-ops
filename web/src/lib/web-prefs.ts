import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { FALLBACK_PIPELINE_TAB, normalizePipelineTab, type PipelineTab } from "@/lib/pipeline-tabs.mjs";

// Web-only view preferences, stored in config/profile.yml under `web:` — the
// same USER-LAYER file every other persisted setting uses (apply.signed_in_profile,
// followup_cadence). localStorage was the other candidate and is wrong here: the
// Pipeline page is server-rendered, so a browser-only default would paint INBOX
// first and swap tabs after hydration, and the preference would silently reset in
// a different browser. Read on the server → the first paint is already correct.

export type WebPrefs = { defaultPipelineTab: PipelineTab };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function profilePath(): string {
  return path.join(careerOpsRoot(), "config", "profile.yml");
}

/** The profile as an object — `{}` for absent/malformed (reads are best-effort). */
function readProfile(): Record<string, unknown> {
  try {
    const parsed = yaml.load(fs.readFileSync(profilePath(), "utf8"));
    return isObj(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The tab the Pipeline page opens on: `web.default_pipeline_tab` from the
 * profile, or INBOX. An unrecognized value (a hand-edited typo, a tab removed by
 * a later version) degrades to the fallback rather than rendering an empty page.
 */
export function readDefaultPipelineTab(): PipelineTab {
  const web = readProfile().web;
  const stored = isObj(web) ? web.default_pipeline_tab : undefined;
  return normalizePipelineTab(stored) ?? FALLBACK_PIPELINE_TAB;
}

/**
 * Persist the default tab, merging into whatever else the profile holds.
 *
 * Same DATA-LOSS GUARD as /api/apply/profile and /api/followups/cadence: a
 * profile.yml that EXISTS but does not parse is never overwritten — replacing a
 * user's targeting, comp and narrative with a one-key file to store a tab name
 * would be an absurd trade. Throws instead, and the route reports it.
 */
export function writeDefaultPipelineTab(tab: PipelineTab): void {
  const file = profilePath();
  let base: Record<string, unknown> = {};
  let header = "";
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch {
      throw new Error("config/profile.yml exists but could not be read as YAML, so it was left untouched.");
    }
    base = isObj(parsed) ? parsed : {};
    // yaml.dump drops every comment; carrying the leading block across keeps the
    // file's own title and explanation (mirrors the apply/profile writer).
    const lead: string[] = [];
    for (const line of raw.split("\n")) {
      if (/^\s*#/.test(line) || line.trim() === "") lead.push(line);
      else break;
    }
    if (lead.some((l) => l.trim())) header = `${lead.join("\n").replace(/\s+$/, "")}\n`;
  }
  const web = isObj(base.web) ? base.web : {};
  const merged = { ...base, web: { ...web, default_pipeline_tab: tab } };
  atomicWriteWithBackup(file, header + yaml.dump(merged, { lineWidth: 100, noRefs: true }));
}
