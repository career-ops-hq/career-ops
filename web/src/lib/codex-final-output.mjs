import fs from "node:fs";

/** Read Codex's authoritative terminal assistant message without duplicating JSONL text. */
export function recoverCodexFinalOutput(file, capturedText = "") {
  if (!file) return "";
  try {
    const finalText = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
    return finalText && !String(capturedText).includes(finalText) ? finalText : "";
  } catch {
    return "";
  }
}
