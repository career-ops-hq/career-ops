const DEFAULT_RUN_TIMEOUT_MS = 285_000;
const LONG_RUN_TIMEOUT_MS = 600_000;

export function prepareRunArgs(cliId, args) {
  return cliId === "kimi" ? [...args, "--output-format", "stream-json"] : args;
}

export function prepareAssistantArgs(cliId, args) {
  if (cliId === "kimi") return prepareRunArgs(cliId, args);
  if (cliId === "codex" && args[0] === "exec") {
    return ["exec", "--ephemeral", "--json", ...args.slice(1)];
  }
  return args;
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

export function parseCodexStreamLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== "item.completed" || event.item?.type !== "agent_message") return null;
  return typeof event.item.text === "string" ? event.item.text : null;
}

export function noOutputMessage({ cliName, timedOut, code, stderr = "" }) {
  if (timedOut) {
    return `${cliName} needed more than 4 minutes for this reply. Try again with a shorter request.`;
  }
  if (/quota|rate.?limit|too many requests|insufficient.?credits/i.test(stderr)) {
    return `${cliName} reported a quota or rate-limit error. Check that provider's usage, then try again.`;
  }
  if (/unauthorized|forbidden|not authenticated|login|credential|api.?key/i.test(stderr)) {
    return `${cliName} is installed but not authenticated. Run it once in a terminal and sign in.`;
  }
  if (code !== 0) {
    return `${cliName} exited with code ${code ?? "unknown"} before returning a reply.`;
  }
  return `${cliName} finished without returning a reply.`;
}
