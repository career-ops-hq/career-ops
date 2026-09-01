/**
 * report-envelope.mjs — the evaluate-mode agent's output channel.
 *
 * evaluate used to hand the agent Write/Bash so it could reserve a report
 * number, write reports/, write a tracker TSV, and run merge-tracker.mjs.
 * Tool grants are tool-name-only, not path-scoped, so a prompt injection in
 * the posting (AGENTS.md Untrusted External Content) could redirect a write
 * at cv.md or a shell at `.env`. Rather than fence those writes, evaluate no
 * longer grants them: the agent emits the report inline in a `<<report-md>>`
 * envelope and the BACKEND persists it — the same arc #2185 used for pdf.
 *
 * Plain .mjs so this can be unit-tested with `node --test`, no TypeScript
 * build step. Fail-closed: markers only count on a line of their own, the
 * FIRST closer wins, more than one envelope is refused rather than guessed.
 */
export const OPEN_MARK = "<<report-md>>";
export const CLOSE_MARK = "<</report-md>>";

const OPENER_SRC = String.raw`^<<report-md>>[ \t]*$`;
const CLOSER_SRC = String.raw`^<<\/report-md>>[ \t]*$`;
const OPENER = new RegExp(OPENER_SRC, "gm");
const CLOSER = new RegExp(CLOSER_SRC, "m");
const CLOSER_ALL = new RegExp(CLOSER_SRC, "gm");

/**
 * The envelope contract, as the agent is told it. Lives here beside the parser
 * so the two cannot drift; run-prompts.mjs interpolates it into the evaluate
 * prompt.
 *
 * Markers are described MID-LINE (inside backticks) rather than shown on their
 * own lines: `codex exec` echoes its prompt to stdout, and a line-start marker
 * in that echo parses as a second envelope, failing the run.
 *
 * It says "do not save" rather than "you have no write tools": that claim is
 * only true on Claude Code. The six CLIs invoked via clis.ts's bare args keep
 * their own default tool access (#2507), and telling an agent something false
 * about its own capabilities invites it to test the claim.
 */
export const REPORT_ENVELOPE_INSTRUCTION =
  `Do NOT save or edit any file, and do not run reserve-report-num.mjs or merge-tracker.mjs — the platform persists your output for you. Instead OUTPUT the finished report markdown inline, between two marker lines. The first line contains only \`${OPEN_MARK}\`, then the complete report (header, Machine Summary YAML fence, blocks A–G), then a final line containing only \`${CLOSE_MARK}\`. Each marker appears exactly once. Emit the WHOLE report — never abbreviate, summarize, or write "unchanged"; the platform writes exactly these bytes to reports/.`;

/**
 * @typedef {Object} ReportEnvelope
 * @property {true} ok
 * @property {string} markdown - The evaluation report, byte-exact as emitted.
 */

/**
 * Extract the evaluation report from an agent's full output.
 *
 * @param {string} text - Everything the agent emitted, concatenated.
 * @returns {ReportEnvelope | {ok: false, error: string}}
 */
export function parseReportEnvelope(text) {
  if (typeof text !== "string") {
    return { ok: false, error: "No agent output to read a report envelope from." };
  }
  const normalized = text.replace(/\r\n/g, "\n");

  const openers = [...normalized.matchAll(OPENER)];
  if (openers.length === 0) {
    return { ok: false, error: "The agent emitted no <<report-md>> envelope, so there is no report to save." };
  }
  if (openers.length > 1) {
    return { ok: false, error: `Found ${openers.length} <<report-md>> envelopes; refusing to guess which is the real report.` };
  }

  const opener = openers[0];
  const afterOpener = normalized.slice(opener.index + opener[0].length);
  const closer = CLOSER.exec(afterOpener);
  if (!closer) {
    return { ok: false, error: "The <<report-md>> envelope was never closed — the report output is incomplete." };
  }

  const markdown = afterOpener.slice(0, closer.index).replace(/^\n/, "").replace(/\n$/, "");
  if (!markdown.trim()) {
    return { ok: false, error: "The <<report-md>> envelope was empty — no report was written." };
  }
  if (!/^#\s/m.test(markdown)) {
    return { ok: false, error: "The report has no markdown title — the output is incomplete." };
  }
  if (!/##\s*Machine Summary/i.test(markdown)) {
    return { ok: false, error: "The report has no Machine Summary — the tracker row cannot be built from it." };
  }

  return { ok: true, markdown };
}

/**
 * Could `line` still become a marker once more characters arrive?
 * @param {string} line
 * @returns {boolean}
 */
function couldBecomeMarker(line) {
  return (
    OPEN_MARK.startsWith(line) || CLOSE_MARK.startsWith(line) ||
    line.startsWith(OPEN_MARK) || line.startsWith(CLOSE_MARK)
  );
}

/**
 * First match of `re` in `s` whose line is terminated by a newline.
 * @param {RegExp} re
 * @param {string} s
 * @returns {{start: number, end: number} | null}
 */
function completeMarker(re, s) {
  for (const m of s.matchAll(re)) {
    const after = m.index + m[0].length;
    if (s[after] === "\n") return { start: m.index, end: after + 1 };
  }
  return null;
}

/**
 * Streaming companion to parseReportEnvelope: accumulates the agent's full
 * output for parsing while keeping the envelope body out of the run log.
 *
 * @returns {{push: (chunk: string) => string, flush: () => string, result: () => (ReportEnvelope | {ok: false, error: string})}}
 */
export function createReportEnvelopeFilter() {
  let raw = "";
  let pending = "";
  let carry = "";
  let inBody = false;

  return {
    push(chunk) {
      const text = String(chunk ?? "");
      raw += text;
      const withCarry = carry + text;
      carry = withCarry.endsWith("\r") ? "\r" : "";
      pending += (carry ? withCarry.slice(0, -1) : withCarry).replace(/\r\n/g, "\n");
      let display = "";
      for (;;) {
        if (!inBody) {
          const opener = completeMarker(OPENER, pending);
          if (opener) {
            display += pending.slice(0, opener.start);
            pending = pending.slice(opener.end);
            inBody = true;
            continue;
          }
          const tailStart = pending.lastIndexOf("\n") + 1;
          const cut = couldBecomeMarker(pending.slice(tailStart)) ? tailStart : pending.length;
          display += pending.slice(0, cut);
          pending = pending.slice(cut);
          return display;
        }
        const closer = completeMarker(CLOSER_ALL, pending);
        if (closer) {
          pending = pending.slice(closer.end);
          inBody = false;
          continue;
        }
        const tailStart = pending.lastIndexOf("\n") + 1;
        pending = pending.slice(tailStart);
        return display;
      }
    },

    flush() {
      const held = inBody ? "" : pending + carry;
      pending = "";
      carry = "";
      return held;
    },

    result() {
      return parseReportEnvelope(raw);
    },
  };
}
