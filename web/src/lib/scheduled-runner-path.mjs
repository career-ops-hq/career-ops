import path from "node:path";

// This is the single resolver shared by the web app and local scheduler runner.
// It stays under web/ because the app pins Turbopack's root there for the
// Windows worker stability workaround.
export function scheduledStorePath(root, configuredPath = process.env.CAREER_OPS_SCHEDULED_JOBS_PATH) {
  if (configuredPath) return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(root, configuredPath);
  return path.join(root, "data", "scheduled-jobs.json");
}

export function scheduledRunnerResourcePath(storePath) {
  return `${storePath}.runner`;
}
