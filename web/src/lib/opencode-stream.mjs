// opencode-stream.mjs — opencode's NDJSON worker stream, in one testable place.
//
// Shapes below are measured, not guessed (`opencode run --format json`): one JSON
// object per line, with top-level types step_start | text | tool_use | step_finish.
//
//   {"type":"text","part":{"type":"text","text":"OK"}}
//   {"type":"tool_use","part":{"type":"tool","tool":"read","state":{...}}}
//   {"type":"step_finish","part":{"reason":"stop",
//       "tokens":{"total":11352,"input":9410,"output":3,"reasoning":0,
//                  "cache":{"write":0,"read":1939}},"cost":0}}
//
// Two measured facts drive the design:
//   1. `step_finish` is emitted PER MODEL STEP, and each step's `total` is that
//      step's own delta (input+output+reasoning+cache.read), NOT a running sum. A
//      2-step run emitted 10278 then 11352; the true run total is 21630. Taking
//      the last event under-reports every real multi-step evaluation.
//   2. `cost` is 0 for an unreported cost, so a cost display would read "$0.00"
//      for a run that may well have been paid for.

/**
 * @typedef {{decision: "unavailable", reason: string, wallMs?: number}} OStreamUnavailable
 * @typedef {{decision: "available", score: number, hasCoreSkills: boolean, band: string,
 *            provider: string, model: string, httpMs: number, wallMs: number,
 *            inputTokens: number|null, outputTokens: number|null, costUsd: number|null}} OStreamAvailable
 */

/**
 * Which surface is asking. opencode is opt-in for the WORKER card ONLY. The chat
 * assistant and the CV-ingest route keep raw stdout, and cv/ingest additionally
 * uses `!usesStreamJson(cliId)` as its "can this CLI read a PDF from /tmp?"
 * capability gate — which opencode cannot, because buildCliEnv's headless
 * permission block rejects paths outside the workspace. Scoping the opt-in is
 * what keeps that gate's behaviour unchanged.
 *
 * @param {string} cliId
 * @param {"default"|"worker"} [surface]
 */
export function usesOpencodeNdjson(cliId, surface = "default") {
  return cliId === "opencode" && surface === "worker";
}

/** @param {string} prompt @returns {string[]} */
export function opencodeWorkerArgs(prompt) {
  return ["run", prompt, "--format", "json"];
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {string|null}
 */
export function opencodeStreamText(obj) {
  if (obj.type !== "text") return null;
  const part = /** @type {{text?: string}|undefined} */ (obj.part);
  return typeof part?.text === "string" ? part.text : null;
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {{tokens?: number, tokensMode?: "replace"|"delta", costUsd?: number, toolName?: string}|null}
 */
export function opencodeStreamMeta(obj) {
  // Raw tool name ("read", "bash") for chip parity with claude. The friendlier
  // part.state.title is deliberately unused: it can carry file paths, and the
  // card already renders claude's bare tool name.
  if (obj.type === "tool_use") {
    const part = /** @type {{tool?: string}|undefined} */ (obj.part);
    return part?.tool ? { toolName: part.tool } : null;
  }
  if (obj.type === "step_finish") {
    const part = /** @type {{tokens?: {total?: number}, cost?: number}|undefined} */ (obj.part);
    const total = part?.tokens?.total;
    /** @type {{tokens?: number, tokensMode?: "replace"|"delta", costUsd?: number}} */
    const meta = {};
    if (typeof total === "number") {
      meta.tokens = total;
      meta.tokensMode = "delta";
    }
    if (typeof part?.cost === "number" && part.cost > 0) meta.costUsd = part.cost;
    return Object.keys(meta).length > 0 ? meta : null;
  }
  // step_start fires PER STEP, not once at init, so mapping it to a status event
  // would put a duplicate "Agent ready" chip on the card every turn.
  return null;
}
