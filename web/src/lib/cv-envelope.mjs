/**
 * cv-envelope.mjs — the pdf-mode agent's output channel (#2185).
 *
 * pdf mode used to hand the agent `Write`/`Edit` so it could save the tailored
 * CV itself. Tool grants are tool-name-only, not path-scoped, so a prompt
 * injection in a job posting or an evaluation report — both of which enter that
 * agent's context — could redirect a write to cv.md, data/applications.md or
 * .env. Rather than fence those writes, pdf mode no longer grants them: the
 * agent emits the tailored HTML inline in a `<<cv-html …>>` envelope and the
 * BACKEND persists it. That completes the arc #2182 started, which moved
 * rendering out of the agent for the same reason.
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / pdf-render.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step.
 *
 * The envelope's rules are all fail-closed, because the alternative to a clean
 * failure is the backend building from attacker-influenced input and reporting
 * success: markers only count on a line of their own, the FIRST closer wins (an
 * injected closer truncates instead of escaping), and more than one envelope is
 * refused outright rather than guessed at.
 */
import { PAGE_FORMATS, DEFAULT_PAGE_FORMAT } from "./page-formats.mjs";

// Markers must own their line — otherwise an agent merely *mentioning* the
// syntax in its prose (or a CLI echoing the prompt, as `codex exec` does) would
// open or close an envelope.
// The marker spellings are exported so the PROMPT that asks for them, the parser
// that reads them, and any guard that checks them all derive from one string.
// Restating them by hand in the prompt is how you get a rename that breaks every
// pdf run at runtime with the whole suite still green.
export const OPEN_MARK = "<<cv-html";
export const CLOSE_MARK = "<</cv-html>>";

// One pattern source per marker. The closer needs two compiled flavours because
// `exec` on a global regex advances `lastIndex` between calls, so the single-shot
// lookup and the scanning one must not share an object; the opener is only ever
// scanned with `matchAll`, which clones and needs just the one.
const OPENER_SRC = String.raw`^<<cv-html(?:[ \t]+format="([^"\n]*)")?>>[ \t]*$`;
const CLOSER_SRC = String.raw`^<<\/cv-html>>[ \t]*$`;
const OPENER = new RegExp(OPENER_SRC, "gm");
const CLOSER = new RegExp(CLOSER_SRC, "m");
const CLOSER_ALL = new RegExp(CLOSER_SRC, "gm");

/**
 * The envelope contract, as the agent is told it. Lives here beside the parser so
 * the two cannot drift; route.ts interpolates it into the pdf prompt.
 *
 * The markers are deliberately described MID-LINE (inside backticks) rather than
 * shown on their own lines: `codex exec` echoes its prompt to stdout, and a
 * line-start marker in that echo parses as a second envelope, failing the run.
 *
 * The page formats are spelled out literally rather than interpolated from
 * DEFAULT_PAGE_FORMAT: that constant is the parser's fallback for an agent that
 * declares NOTHING, which is a different question from what the agent should
 * choose. Tying them together once produced "choose letter … otherwise letter".
 *
 * It says "do not save" rather than "you have no write tools": that claim is only
 * true on Claude Code. The six CLIs invoked via clis.ts's bare args keep their own
 * default tool access, and telling an agent something false about its own
 * capabilities invites it to test the claim.
 */
export const CV_ENVELOPE_INSTRUCTION =
  `Do NOT save or edit any file — the platform persists your output for you. Instead OUTPUT the finished HTML inline, between two marker lines. The first line contains only the opening marker carrying your chosen page format — \`${OPEN_MARK} format="a4">>\` or \`${OPEN_MARK} format="letter">>\`, and nothing else on that line. Choose letter for a US/Canada company, otherwise a4. Then the complete HTML document, then a final line containing only \`${CLOSE_MARK}\`. Each marker appears exactly once. Emit the WHOLE document from <!DOCTYPE html> to </html> — never abbreviate, summarize, or write "unchanged"; the platform renders exactly these bytes and nothing else.`;

/**
 * @typedef {Object} CvEnvelope
 * @property {true} ok
 * @property {string} html - The tailored CV HTML, byte-exact as emitted.
 * @property {"a4"|"letter"} format - Page format for generate-pdf.mjs.
 * @property {string[]} warnings - Non-fatal issues to surface in the run log.
 */

/**
 * Extract the tailored CV HTML and page format from an agent's full output.
 *
 * Returns a result rather than throwing so the caller (the /api/run close
 * handler) can route the failure through the same honesty gate as every other
 * "this run produced nothing usable" case.
 *
 * @param {string} text - Everything the agent emitted, concatenated.
 * @returns {CvEnvelope | {ok: false, error: string}}
 */
export function parseCvEnvelope(text) {
  if (typeof text !== "string") {
    return { ok: false, error: "No agent output to read a CV envelope from." };
  }
  // Normalize CRLF once so the line-anchored markers match on a Windows stream
  // and no stray \r rides into the HTML handed to the renderer.
  const normalized = text.replace(/\r\n/g, "\n");

  const openers = [...normalized.matchAll(OPENER)];
  if (openers.length === 0) {
    return { ok: false, error: "The agent emitted no <<cv-html>> envelope, so there is no CV to render." };
  }
  if (openers.length > 1) {
    // Choosing one would be choosing blind — an injected envelope looks exactly
    // like the real one from here.
    return { ok: false, error: `Found ${openers.length} <<cv-html>> envelopes; refusing to guess which is the real CV.` };
  }

  const opener = openers[0];
  const afterOpener = normalized.slice(opener.index + opener[0].length);
  const closer = CLOSER.exec(afterOpener);
  if (!closer) {
    return { ok: false, error: "The <<cv-html>> envelope was never closed — the CV output is incomplete." };
  }

  // The opener match stops before its newline and the closer starts on its own
  // line, so exactly one delimiting newline sits on each side of the body.
  const html = afterOpener.slice(0, closer.index).replace(/^\n/, "").replace(/\n$/, "");
  if (!html.trim()) {
    return { ok: false, error: "The <<cv-html>> envelope was empty — no CV was tailored." };
  }
  // A closing </html> is what distinguishes a whole document from one the agent
  // cut off mid-emission — the realistic failure when emitting 15-25 KB inline.
  // This belongs here, not in the caller: the caller reports THIS error string, so
  // splitting the rule out would leave the user with a generic message.
  if (!/<\/html\s*>/i.test(html)) {
    return { ok: false, error: "The CV was cut off before its closing </html> tag — the output is incomplete." };
  }

  const warnings = [];
  const declared = opener[1];
  let format = DEFAULT_PAGE_FORMAT;
  if (declared === undefined) {
    warnings.push(`The agent declared no page format; defaulting to ${DEFAULT_PAGE_FORMAT}.`);
  } else {
    const lower = declared.trim().toLowerCase();
    if (PAGE_FORMATS.has(lower)) format = lower;
    else warnings.push(`Unrecognized page format "${declared}"; defaulting to ${DEFAULT_PAGE_FORMAT}.`);
  }

  return { ok: true, html, format, warnings };
}

/**
 * Could `line` still become a marker once more characters arrive?
 *
 * True both while the text is a prefix of a marker (`<`, `<<c`) and once it has
 * passed one (`<<cv-html format="a4"` is still growing towards `>>`).
 *
 * @param {string} line - The unterminated final line.
 * @returns {boolean}
 */
function couldBecomeMarker(line) {
  return (
    // Still growing into a marker (`<`, `<<c`)...
    OPEN_MARK.startsWith(line) || CLOSE_MARK.startsWith(line) ||
    // ...or already past it and still growing towards `>>`.
    line.startsWith(OPEN_MARK) || line.startsWith(CLOSE_MARK)
  );
}

/**
 * First match of `re` in `s` whose line is terminated by a newline.
 *
 * An unterminated match is deliberately ignored: more characters could still
 * arrive on that line, and acting early is how a half-written marker leaks into
 * the rendered log (the flicker act-envelope.mjs documents).
 *
 * @param {RegExp} re - Line-anchored marker pattern; must carry the `g` flag.
 * @param {string} s
 * @returns {{start: number, end: number} | null} `end` consumes the newline.
 */
function completeMarker(re, s) {
  for (const m of s.matchAll(re)) {
    const after = m.index + m[0].length;
    if (s[after] === "\n") return { start: m.index, end: after + 1 };
  }
  return null;
}

/**
 * Streaming companion to parseCvEnvelope: accumulates the agent's full output
 * for parsing while keeping the envelope body out of the user's run log.
 *
 * Both halves are needed at once. The route must see every byte to reconstruct
 * the CV, but streaming 15-25 KB of raw HTML into the log would bury the agent's
 * actual narration. Chunk boundaries fall wherever the transport likes, so the
 * markers are matched across pushes rather than per chunk.
 *
 * @returns {{push: (chunk: string) => string, flush: () => string, result: () => (CvEnvelope | {ok: false, error: string})}}
 *   `push` returns the text safe to display, `flush` releases anything still
 *   held at end of stream, `result` parses everything pushed so far.
 */
export function createCvEnvelopeFilter() {
  let raw = "";       // everything pushed, verbatim — what result() parses
  let pending = "";   // display work buffer (CRLF-normalized so lines match)
  let carry = "";     // a trailing "\r" whose "\n" may be in the next chunk
  let inBody = false;

  return {
    push(chunk) {
      const text = String(chunk ?? "");
      raw += text;
      // Normalizing per chunk is not enough: a CRLF split across two pushes would
      // leave a lone \r that `[ \t]*$` can never match, so no marker is ever
      // recognized and the ENTIRE body streams into the run log with ok:true and
      // no signal. Hold back a trailing \r until its partner arrives.
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
          // Everything up to the unterminated final line is settled: a marker in
          // it would already have matched. Hold that line only if it might grow
          // into a marker.
          const tailStart = pending.lastIndexOf("\n") + 1;
          const cut = couldBecomeMarker(pending.slice(tailStart)) ? tailStart : pending.length;
          display += pending.slice(0, cut);
          pending = pending.slice(cut);
          return display;
        }
        const closer = completeMarker(CLOSER_ALL, pending);
        if (closer) {
          // The body itself is never displayed — only skipped past.
          pending = pending.slice(closer.end);
          inBody = false;
          continue;
        }
        // Settled body lines are never displayed, so drop them; keep only the
        // unterminated final line, which may be a closer still being written.
        // (`raw` retains every byte for parsing — this buffer is display-only.)
        const tailStart = pending.lastIndexOf("\n") + 1;
        pending = pending.slice(tailStart);
        return display;
      }
    },

    flush() {
      // Held text that never became a marker is prose, and dropping it would
      // silently lose the tail of the log. Body leftovers are already discarded.
      const held = inBody ? "" : pending + carry;
      pending = "";
      carry = "";
      return held;
    },

    result() {
      return parseCvEnvelope(raw);
    },
  };
}
