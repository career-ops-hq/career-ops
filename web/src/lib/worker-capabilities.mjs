/**
 * worker-capabilities.mjs — what a headless worker NEEDS, stated once, in terms
 * no CLI owns (#2507).
 *
 * The permission model has two axes, and they were previously fused. Claude
 * expresses permission as a tool allow/deny list; Codex expresses it as an OS
 * sandbox (Seatbelt/Landlock). Those are not translatable into each other — but
 * the question they both answer is the same one: may this worker write, and does
 * it need the network? That question lives here; each CLI module translates the
 * answer into its own vocabulary.
 *
 * Keeping it here rather than in claude-invocation.mjs is deliberate. The set of
 * writing kinds used to be a private Set in that module, so a second CLI could
 * only copy it — and the next kind added would then be classified twice, in two
 * files, with nothing comparing the answers. This repo already carries that
 * failure three times over: clis.ts KNOWN, rank-pipeline.mjs CLI_CANDIDATES and
 * doctor.mjs VALID_CLIS are hand-maintained lists of the same CLIs that have
 * drifted apart (differing entries, differing names for the same binary). One
 * source, many translations — never many sources.
 */

/**
 * @typedef {Object} Capabilities
 * @property {boolean} writes - May the worker modify files?
 * @property {boolean} network - Does the worker need to reach the network?
 */

/**
 * The three records any call site needs, named so a reader sees the intent
 * rather than two booleans. Frozen: these are shared singletons, and a caller
 * mutating one would silently re-permission every other call site using it.
 *
 * @type {{localReadOnly: Capabilities, networkReadOnly: Capabilities, workspaceWrite: Capabilities}}
 */
export const CAPS = Object.freeze({
  /** Reads local files only. The strictest record, and the fallback for anything unrecognized. */
  localReadOnly: Object.freeze({ writes: false, network: false }),
  /** Reads and fetches, but must not write. */
  networkReadOnly: Object.freeze({ writes: false, network: true }),
  /** Writes canonical artifacts and fetches — the evaluation/repair workers. */
  workspaceWrite: Object.freeze({ writes: true, network: true }),
});

/**
 * Every kind /api/run dispatches. Exported so guards iterate this rather than a
 * hand-written list — a list silently stops gating whatever kind is added next.
 * Unknown kinds still resolve (least-capable, see capabilitiesFor); this is the
 * set a test can enumerate, not a validity check.
 *
 * Lives here rather than in claude-invocation.mjs because it is a fact about the
 * run route's workers, not about Claude. Re-exported there for existing importers.
 */
export const KNOWN_KINDS = Object.freeze(["pdf", "research", "evaluate", "fix-portal"]);

/**
 * What each run-route kind needs. Derived from what its prompt actually does
 * (see run-prompts.mjs), not from what its tool list happens to allow:
 *
 * - pdf       reads cv.md/profile/report/template and returns the CV inline in an
 *             envelope the backend persists — no write, and no fetch.
 * - research  "use WebFetch for URLs" — fetches, reports, never writes.
 * - evaluate  "Use WebFetch to read the posting", then writes the report and merges
 *             the tracker.
 * - fix-portal rewrites one portals.yml entry after finding a working ATS URL.
 */
const KIND_CAPABILITIES = Object.freeze({
  pdf: CAPS.localReadOnly,
  research: CAPS.networkReadOnly,
  evaluate: CAPS.workspaceWrite,
  "fix-portal": CAPS.workspaceWrite,
});

/**
 * Resolve what a worker kind needs.
 *
 * An unrecognized kind gets the least-capable record. Granting write access to a
 * kind nobody has reviewed is the one unrecoverable default — the same reasoning
 * toolScopeFor already applies on Claude's side.
 *
 * @param {string} kind - Worker kind ("pdf", "research", "evaluate", …).
 * @returns {Capabilities}
 */
export function capabilitiesFor(kind) {
  // Object.hasOwn, not `?? fallback`: a bare lookup resolves inherited
  // Object.prototype members, so a kind of "constructor" or "toString" returns a
  // truthy non-record instead of falling back to the least-capable default.
  return Object.hasOwn(KIND_CAPABILITIES, kind) ? KIND_CAPABILITIES[kind] : CAPS.localReadOnly;
}
