// Server-only: read a user-state JSON file. Missing file -> `fallback`; any other
// failure (permission, broken JSON) throws, so a damaged user file is surfaced to
// the user instead of being silently replaced (web/AGENTS.md: a missing file is
// not a malformed file). Writes go through atomicWrite in lib/core/safe-write.ts.
import fs from "node:fs";

export function readJsonFile(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return fallback;
    throw error;
  }
  return JSON.parse(text);
}
