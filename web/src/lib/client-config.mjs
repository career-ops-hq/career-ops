export const CONFIG_KEY = "career-ops:config";
export const CONFIG_CHANGED_EVENT = "career-ops:config-changed";

export function parseClientConfig(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readConfiguredCli(raw) {
  const cliId = parseClientConfig(raw).cliId;
  return typeof cliId === "string" && cliId.trim() ? cliId : null;
}

export function patchClientConfig(raw, patch) {
  return JSON.stringify({ ...parseClientConfig(raw), ...patch });
}
