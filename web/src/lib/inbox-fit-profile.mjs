import fs from "node:fs";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { fitTargetsFromProfile } from "@/lib/core/inbox-rank.mjs";

/** Profile floors for inbox fit. A missing or broken profile ranks nothing. */
export function loadFitTargets() {
  try {
    const doc = yaml.load(fs.readFileSync(getProfilePath(careerOpsRoot()), "utf8"));
    return fitTargetsFromProfile(doc);
  } catch {
    return fitTargetsFromProfile(null);
  }
}
