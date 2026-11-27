import fs from "node:fs";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { fitTargetsFromProfile } from "@/lib/core/inbox-rank.mjs";

/** Profile floors for inbox fit. A missing profile ranks nothing. A broken one throws. */
export function loadFitTargets() {
  let text;
  try {
    text = fs.readFileSync(getProfilePath(careerOpsRoot()), "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return fitTargetsFromProfile(null);
    throw err;
  }
  return fitTargetsFromProfile(yaml.load(text));
}

/**
 * @template T
 * @param {T[]} jobs
 * @param {() => object} load
 * @param {(job: T, targets: object) => T} rank
 * @returns {{ jobs: T[], error: string | null }}
 */
export function applyInboxFit(jobs, load, rank) {
  try {
    const targets = load();
    return { jobs: jobs.map((job) => rank(job, targets)), error: null };
  } catch (err) {
    const detail = err && typeof err === "object" && typeof err.message === "string" ? err.message.trim() : "";
    return {
      jobs,
      error: detail ? `config/profile.yml: ${detail}` : "config/profile.yml could not be read.",
    };
  }
}
