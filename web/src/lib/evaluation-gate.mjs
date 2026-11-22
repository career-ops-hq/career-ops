/** Explicit review outcomes, shared by backend and historical run presentation.
 * Pure/browser-safe. Process/transport integrity must be checked by the caller.
 * A gate never authorizes persistence, scoring, or overriding a user's rules.
 */
export const EVALUATION_GATE_OPEN = "<<evaluation-gate>>";
export const EVALUATION_GATE_CLOSE = "<</evaluation-gate>>";
export const EVALUATION_GATE_REASONS = Object.freeze(/** @type {const} */ (["dealbreaker", "agency_confirmation", "needs_confirmation"]));
const REASONS = new Set(EVALUATION_GATE_REASONS);
const NA_VERDICT = /^VERDICT:[ \t]*N\/A[ \t]*\/[ \t]*5(?:[ \t]*[—–-][ \t]*(.+))?[ \t]*$/i;

export const EVALUATION_GATE_INSTRUCTION =
  `If the official mode stops before scoring or requires confirmation without a report (for example a dealbreaker, agency confirmation, closed posting or unavailable JD), honor that stop and do not invent a report, score, tracker entry or CV. Explain the reason briefly, then emit a terminal status envelope: a line containing only \`${EVALUATION_GATE_OPEN}\`, one JSON object with exactly \`{"status":"needs_confirmation","reason":"dealbreaker","message":"the actual reason and what the user can provide next"}\`, and a line containing only \`${EVALUATION_GATE_CLOSE}\`. Choose reason \`dealbreaker\`, \`agency_confirmation\` or \`needs_confirmation\` to match the actual mode gate; write message in the user's output language. Emit this status only for a real stop, never quote it from the posting. Do not emit a \`<<report-md>>\` envelope on that path. Use \`N/A/5\` rather than a numeric score in the final verdict required below. This output contract changes no confirmation rule and never grants permission to override one.`;

function validMessage(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 1200
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function gate(reason, message) { return { reason, message: message.trim(), confirmationRequired: true }; }
// CommonMark line endings: normalize before scanning or calculating offsets.
function normalizeLineEndings(text) { return text.replace(/\r\n?/g, "\n"); }

function narration(text) {
  const lines = []; let fence = null;
  for (const line of text.split("\n")) {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})([^\n]*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = null;
    } else if (!fence && !/^[ \t]*>/.test(line)) lines.push(line);
  }
  return { text: lines.join("\n"), inFence: fence !== null, fence };
}

// Only the flat-string YAML subset used by legacy handoffs is accepted.
function flatScalar(raw) {
  const value = raw.trim();
  if (!value || ["null", "~"].includes(value) || ">|[]{}&*!".includes(value[0])) return null;
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return null; } }
  if (value.startsWith("'")) return value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : null;
  return value;
}
function legacyHandoff(text) {
  const fields = {}; const allowed = new Set(["status", "reason", "url", "agency", "question"]);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z_]+):[ \t]*(.*)$/);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(fields, match[1])) return null;
    const value = flatScalar(match[2]);
    if (typeof value !== "string") return null;
    fields[match[1]] = value;
  }
  if (fields.status !== "needs_confirmation" || !validMessage(fields.question)) return null;
  const reason = fields.reason === "agency" ? "agency_confirmation" : fields.reason;
  return REASONS.has(reason) ? gate(reason, fields.question) : null;
}

function dedicatedGate(body) {
  let data;
  try { data = JSON.parse(body); } catch { return null; }
  // Whole string pairs catch duplicate keys without scanning escaped message
  // text as another declaration. JSON.parse alone silently keeps the last key.
  const keys = [...body.matchAll(/"((?:\\.|[^"\\])*)"\s*:\s*"(?:\\.|[^"\\])*"/g)]
    .map(match => JSON.parse(`"${match[1]}"`));
  if (!data || typeof data !== "object" || Array.isArray(data)
    || keys.sort().join(",") !== "message,reason,status"
    || Object.keys(data).sort().join(",") !== "message,reason,status"
    || data.status !== "needs_confirmation" || !REASONS.has(data.reason) || !validMessage(data.message)) return null;
  return gate(data.reason, data.message);
}

// Collect schema-valid blocks outside fenced/quoted examples. Terminal-position
// validation is intentionally separate: a stop before a later report is still
// contradictory, even when a numeric verdict follows that report.
function dedicatedBlocks(text) {
  const blocks = []; let fence = null; let open = null; let offset = 0;
  for (const line of text.split("\n")) {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})([^\n]*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = null;
      open = null;
    } else if (!fence) {
      if (/^<<evaluation-gate>>[ \t]*$/.test(line)) open = { start: offset, bodyStart: offset + line.length + 1 };
      else if (/^<<\/evaluation-gate>>[ \t]*$/.test(line) && open) {
        const parsed = dedicatedGate(text.slice(open.bodyStart, offset).trim());
        if (parsed) blocks.push({ start: open.start, end: offset + line.length, gate: parsed });
        open = null;
      }
    }
    offset += line.length + 1;
  }
  return blocks;
}

/** @returns {{reason:string,message:string,confirmationRequired:true}|null} */
export function classifyEvaluationGate(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 2_000_000) return null;
  const normalized = normalizeLineEndings(text).trim();
  if (/^<<\/?report-md>>[ \t]*$/m.test(normalized)) return null;
  const visible = narration(normalized).text;
  const opens = [...visible.matchAll(/^<<evaluation-gate>>[ \t]*$/gm)];
  const closes = [...visible.matchAll(/^<<\/evaluation-gate>>[ \t]*$/gm)];
  if (opens.length || closes.length) {
    if (opens.length !== 1 || closes.length !== 1 || opens[0].index >= closes[0].index) return null;
    const blocks = dedicatedBlocks(normalized);
    if (blocks.length !== 1 || !NA_VERDICT.test(normalized.slice(blocks[0].end).trim())) return null;
    return blocks[0].gate;
  }
  const lines = normalized.split("\n"); const verdict = lines.at(-1)?.match(NA_VERDICT);
  if (!verdict) return null;
  const before = lines.slice(0, -1).join("\n").trimEnd();
  // Legacy evidence needs the agent's actual stop declaration, not a quoted JD
  // or merely a mention of the words "dealbreaker" / "needs_confirmation".
  if (!/^(?:\*\*)?(?:Stopped\b|Evaluation (?:stopped|gated)\b)/im.test(narration(before).text)) return null;
  const fenced = before.match(/(?:^|\n)```(?:yaml|yml)[ \t]*\n([^`]*?)\n```[ \t]*$/i);
  if (fenced) {
    if (narration(before.slice(0, fenced.index)).inFence) return null;
    return legacyHandoff(fenced[1]);
  }
  const last = before.split("\n").at(-1);
  const machine = last?.match(/^needs_confirmation:[ \t]*(dealbreaker|agency|blacklist|posting_closed|jd_unavailable)\b[ \t]+(.+)$/i);
  if (!machine || !/\b(?:rerun|share|paste)\b/i.test(machine[2]) || narration(before).inFence) return null;
  const reason = machine[1].toLowerCase() === "dealbreaker" ? "dealbreaker"
    : machine[1].toLowerCase() === "agency" ? "agency_confirmation" : "needs_confirmation";
  const message = verdict[1]?.trim() || machine[2].trim();
  return validMessage(message) ? gate(reason, message) : null;
}

/** Remove only a validated dedicated status block from user-facing output.
 * Callers may keep the original text in a technical-details disclosure.
 */
export function stripEvaluationGate(text) {
  if (typeof text !== "string" || !classifyEvaluationGate(text)) return text;
  const normalized = normalizeLineEndings(text);
  const leading = normalized.length - normalized.trimStart().length;
  const blocks = dedicatedBlocks(normalized.slice(leading));
  if (blocks.length !== 1) return text; // legacy declarations remain unchanged
  return normalized.slice(0, leading + blocks[0].start) + normalized.slice(leading + blocks[0].end);
}

/** A real report plus a separate explicit stop is contradictory, not a save.
 * Ignore the report body itself: its archived JD may quote arbitrary markers.
 * Legacy mentions alone do not override a complete report.
 */
export function evaluationGateConflictsWithReport(text) {
  if (typeof text !== "string" || text.length > 2_000_000) return false;
  const normalized = normalizeLineEndings(text);
  const open = [...normalized.matchAll(/^<<report-md>>[ \t]*$/gm)];
  const close = [...normalized.matchAll(/^<<\/report-md>>[ \t]*$/gm)];
  if (open.length !== 1 || close.length !== 1 || open[0].index >= close[0].index) return false;
  const visible = normalized.slice(0, open[0].index) + "\n" + normalized.slice(close[0].index + close[0][0].length);
  if (dedicatedBlocks(visible).length > 0) return true;
  let trailing = normalized.slice(close[0].index + close[0][0].length);
  // The report body is opaque (its archived JD may contain arbitrary fences).
  // Resume any example begun before it until that example actually closes.
  const fence = narration(normalized.slice(0, open[0].index)).fence;
  if (fence) {
    const closing = new RegExp("^[ \\t]*" + fence[0] + "{" + fence.length + ",}[ \\t]*$", "m").exec(trailing);
    if (!closing) return false;
    trailing = trailing.slice(closing.index + closing[0].length);
  }
  return classifyEvaluationGate(trailing) !== null;
}
