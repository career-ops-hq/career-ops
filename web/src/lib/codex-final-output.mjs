import fs from "node:fs";

const ROLE_OPEN = "<<role-resume-json>>";
const ROLE_CLOSE = "<</role-resume-json>>";
const normalizedText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();
const stableJson = (value) => Array.isArray(value) ? value.map(stableJson) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])])) : value;

/** Extract one complete role envelope for merge comparison; never chooses among multiples. */
export function inspectRoleResumeEnvelope(value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  const openers = [...text.matchAll(/^<<role-resume-json>>[ \t]*$/gm)];
  if (openers.length !== 1) return { complete: false, openerCount: openers.length };
  const after = text.slice(openers[0].index + openers[0][0].length);
  const closers = [...after.matchAll(/^<<\/role-resume-json>>[ \t]*$/gm)];
  if (closers.length !== 1) return { complete: false, openerCount: 1 };
  let payload;
  try { payload = JSON.parse(after.slice(0, closers[0].index).trim()); } catch { return { complete: false, openerCount: 1 }; }
  const verdict = text.trim().split(/\r?\n/).at(-1)?.trim() || "";
  return { complete: true, openerCount: 1, canonicalPayload: JSON.stringify(stableJson(payload)), normalizedVerdict: verdict.replace(/\s+/g, " ") };
}

/** Merge Codex's two final-output channels without weakening the strict parser. */
export function mergeRoleResumeFinalOutput(capturedText, finalText) {
  const captured = String(capturedText ?? "");
  const final = String(finalText ?? "");
  if (!final.trim()) return { effectiveText: captured, addition: "", duplicate: false, replaced: false, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: false };
  const normalizedCaptured = normalizedText(captured);
  const normalizedFinal = normalizedText(final);
  const normalizedSuffixEqual = normalizedCaptured === normalizedFinal || normalizedCaptured.endsWith(`\n${normalizedFinal}`);
  if (normalizedSuffixEqual) return { effectiveText: captured, addition: "", duplicate: true, replaced: false, conflict: false, normalizedSuffixEqual: true, envelopesEquivalent: false };
  const left = inspectRoleResumeEnvelope(captured);
  const right = inspectRoleResumeEnvelope(final);
  if (left.complete && right.complete) {
    const envelopesEquivalent = left.canonicalPayload === right.canonicalPayload && left.normalizedVerdict === right.normalizedVerdict;
    if (envelopesEquivalent) return { effectiveText: captured, addition: "", duplicate: true, replaced: false, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: true };
    return { effectiveText: captured, addition: "", duplicate: false, replaced: false, conflict: true, normalizedSuffixEqual: false, envelopesEquivalent: false, error: "Codex JSONL and terminal output contained conflicting role-resume content." };
  }
  if (right.complete && !left.complete) return { effectiveText: final, addition: "", duplicate: false, replaced: true, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: false };
  return { effectiveText: `${captured}${captured && final ? "\n" : ""}${final}`, addition: final, duplicate: false, replaced: false, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: false };
}

/** Inspect Codex's terminal response without exposing its body to diagnostics. */
export function inspectCodexFinalOutput(file, capturedText = "", options = {}) {
  if (!file) return { text: "", addition: "", effectiveText: String(capturedText), byteCount: 0, containsOpenMark: false, containsVerdict: false, looksMarkdown: false, duplicate: false, replaced: false, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: false, error: undefined };
  try {
    const finalText = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
    const roleMerge = options.kind === "role-resume" ? mergeRoleResumeFinalOutput(capturedText, finalText) : null;
    const duplicate = roleMerge ? roleMerge.duplicate : !!finalText && String(capturedText).includes(finalText);
    return {
      text: finalText,
      addition: roleMerge ? roleMerge.addition : finalText && !duplicate ? finalText : "",
      effectiveText: roleMerge ? roleMerge.effectiveText : `${capturedText}${finalText && !duplicate ? `${capturedText ? "\n" : ""}${finalText}` : ""}`,
      byteCount: Buffer.byteLength(finalText, "utf8"),
      containsOpenMark: finalText.includes(options.kind === "role-resume" ? ROLE_OPEN : "<<cv-html"),
      containsVerdict: /VERDICT:/.test(finalText),
      looksMarkdown: /(?:^|\n)#\s+\S|\*\*[^*]+\*\*/.test(finalText),
      duplicate,
      replaced: roleMerge?.replaced || false,
      conflict: roleMerge?.conflict || false,
      error: roleMerge?.error,
      normalizedSuffixEqual: roleMerge?.normalizedSuffixEqual || false,
      envelopesEquivalent: roleMerge?.envelopesEquivalent || false,
    };
  } catch {
    return { text: "", addition: "", effectiveText: String(capturedText), byteCount: 0, containsOpenMark: false, containsVerdict: false, looksMarkdown: false, duplicate: false, replaced: false, conflict: false, normalizedSuffixEqual: false, envelopesEquivalent: false, error: undefined };
  }
}

/** Read only the non-duplicate terminal content for the shared stream merger. */
export function recoverCodexFinalOutput(file, capturedText = "") {
  return inspectCodexFinalOutput(file, capturedText).addition;
}
