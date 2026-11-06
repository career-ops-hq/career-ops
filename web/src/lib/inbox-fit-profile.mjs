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
