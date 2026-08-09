const DEFAULT_RUN_TIMEOUT_MS = 285_000;
const LONG_RUN_TIMEOUT_MS = 600_000;

export function prepareRunArgs(cliId, args) {
  return cliId === "kimi" ? [...args, "--output-format", "stream-json"] : args;
}

export function runTimeoutMs(kind, cliId) {
  return kind === "pdf" || (kind === "evaluate" && cliId === "kimi") ? LONG_RUN_TIMEOUT_MS : DEFAULT_RUN_TIMEOUT_MS;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function parseKimiStreamLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || event.role !== "assistant") return null;

  const tools = Array.isArray(event.tool_calls)
    ? event.tool_calls
        .map((call) => call?.function?.name || call?.name)
        .filter((name) => typeof name === "string" && name.trim())
    : [];

  return { text: contentText(event.content), tools };
}
