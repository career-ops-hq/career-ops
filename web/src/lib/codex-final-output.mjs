import fs from "node:fs";

/** Inspect Codex's terminal response without exposing its body to diagnostics. */
export function inspectCodexFinalOutput(file, capturedText = "") {
  if (!file) return { text: "", addition: "", byteCount: 0, containsOpenMark: false, containsVerdict: false, looksMarkdown: false, duplicate: false };
  try {
    const finalText = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
    const duplicate = !!finalText && String(capturedText).includes(finalText);
    return {
      text: finalText,
      addition: finalText && !duplicate ? finalText : "",
      byteCount: Buffer.byteLength(finalText, "utf8"),
      containsOpenMark: finalText.includes("<<cv-html"),
      containsVerdict: /VERDICT:/.test(finalText),
      looksMarkdown: /(?:^|\n)#\s+\S|\*\*[^*]+\*\*/.test(finalText),
      duplicate,
    };
  } catch {
    return { text: "", addition: "", byteCount: 0, containsOpenMark: false, containsVerdict: false, looksMarkdown: false, duplicate: false };
  }
}

/** Read only the non-duplicate terminal content for the shared stream merger. */
export function recoverCodexFinalOutput(file, capturedText = "") {
  return inspectCodexFinalOutput(file, capturedText).addition;
}
