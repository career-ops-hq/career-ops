import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("data", "profile-state.json");

export function readProfileState(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), "utf8"));
    if (Number.isInteger(value?.version) && value.version >= 0 && typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt))) {
      return { version: value.version, updatedAt: value.updatedAt };
    }
  } catch { /* no approved web profile update yet */ }
  return { version: 0, updatedAt: null };
}

export function advanceProfileState(root, now = new Date()) {
  const current = readProfileState(root);
  const next = { version: current.version + 1, updatedAt: now.toISOString() };
  const file = path.join(root, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, file);
  return next;
}

export function classifyResumeFreshness(metadata, profileState) {
  if (!profileState?.version || !profileState.updatedAt) return "current";
  if (Number.isInteger(metadata?.profileVersion)) return metadata.profileVersion < profileState.version ? "stale" : "current";
  const created = typeof metadata?.createdAt === "string" ? Date.parse(metadata.createdAt) : Number.NaN;
  const updated = Date.parse(profileState.updatedAt);
  if (!Number.isNaN(created) && !Number.isNaN(updated)) return created < updated ? "stale" : "current";
  return "unknown";
}

export function profileMetadata(root) {
  const state = readProfileState(root);
  return { profileVersion: state.version, profileUpdatedAt: state.updatedAt };
}
