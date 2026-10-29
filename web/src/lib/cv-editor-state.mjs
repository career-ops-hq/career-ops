/** @typedef {'loading' | 'ready' | 'load-error'} EditorPhase */

/**
 * @typedef {object} EditorState
 * @property {EditorPhase} phase
 * @property {string} content
 * @property {string} saved
 * @property {string | null} inflight
 * @property {string | null} error
 * @property {boolean} exists
 * @property {boolean} snapshotPrior
 * @property {boolean} conflict
 */

/**
 * @typedef {{ base: string, content: string, inflight?: string } | null} CvDraft
 */

/** @returns {EditorState} */
export function initialEditor() {
  return {
    phase: "loading",
    content: "",
    saved: "",
    inflight: null,
    error: null,
    exists: false,
    snapshotPrior: true,
    conflict: false,
  };
}

/**
 * @param {EditorState} state
 * @param {{ type: 'loaded', content: string, exists: boolean, draft: CvDraft }
 *   | { type: 'load-failed', error: string }
 *   | { type: 'edit', content: string }
 *   | { type: 'save-start', content: string }
 *   | { type: 'save-ok', content: string }
 *   | { type: 'save-failed', content: string, error: string, conflict?: boolean }} action
 * @returns {EditorState}
 */
export function editorReducer(state, action) {
  switch (action.type) {
    case "loaded": {
      const server = typeof action.content === "string" ? action.content : "";
      const draft = action.draft;
      const bases = [];
      if (draft && typeof draft.base === "string") bases.push(draft.base);
      if (draft && typeof draft.inflight === "string" && !bases.includes(draft.inflight)) bases.push(draft.inflight);
      const restore =
        !!draft &&
        typeof draft.content === "string" &&
        bases.includes(server) &&
        draft.content !== server;
      return {
        phase: "ready",
        content: restore ? draft.content : server,
        saved: server,
        inflight: null,
        error: null,
        exists: action.exists === true || server.length > 0,
        snapshotPrior: true,
        conflict: false,
      };
    }
    case "load-failed":
      return { ...initialEditor(), phase: "load-error", error: action.error };
    case "edit":
      if (state.phase !== "ready") return state;
      return {
        ...state,
        content: action.content,
        error: state.conflict ? state.error : null,
        snapshotPrior: state.content === state.saved ? true : state.snapshotPrior,
      };
    case "save-start":
      if (state.phase !== "ready") return state;
      if (state.inflight !== null) return state;
      if (action.content !== state.content || action.content === state.saved) return state;
      return { ...state, inflight: action.content };
    case "save-ok":
      if (action.content !== state.inflight) return state;
      return { ...state, inflight: null, saved: action.content, exists: true, error: null, snapshotPrior: false, conflict: false };
    case "save-failed":
      if (action.content !== state.inflight) return state;
      // A conflict means the file on disk is not the text this edit started
      // from. Keep the draft, including text typed while the save was in flight.
      if (action.conflict) return { ...state, inflight: null, conflict: true, error: action.error };
      // The failed text is the one that was sent. An edit that landed while
      // that request was in flight is a different draft and can still save.
      return { ...state, inflight: null, error: state.content === action.content ? action.error : null };
    default:
      return state;
  }
}

/** @param {EditorState} state */
export function editorStatus(state) {
  if (state.phase === "loading") return { label: "Loading", canSave: false };
  if (state.phase !== "ready") return { label: "Could not load", canSave: false };
  if (state.inflight !== null && state.inflight !== state.content && state.content === state.saved) {
    return { label: "Saving", canSave: false };
  }
  if (state.content !== state.saved) {
    if (state.inflight === state.content) return { label: "Saving", canSave: false };
    return { label: "Unsaved", canSave: state.inflight === null && !state.conflict };
  }
  // The file changed underneath. Matching the last save this tab made is not
  // the same as the file still holding that text.
  if (state.conflict) return { label: "Unsaved", canSave: false };
  if (!state.exists) return { label: "No file yet", canSave: false };
  return { label: "Saved", canSave: false };
}

/**
 * Whether autosave should run. Not after a failed save: retrying on a timer
 * would repeat the POST, and its backup, until the next keystroke. Typing
 * clears the error, and the Save button and the exit flush still work.
 *
 * @param {EditorState} state
 */
export function shouldSave(state) {
  return state.phase === "ready" && state.error === null && !state.conflict && state.content !== state.saved && state.inflight !== state.content;
}

/**
 * The next save after `written` lands. The reducer has not re-rendered, so
 * `state.saved` is still the older text. The follow-up must expect `written`.
 *
 * @param {EditorState} state
 * @param {string} written
 * @returns {{ text: string, expected: { content: string, exists: boolean } } | null}
 */
export function saveFollowUp(state, written) {
  if (state.phase !== "ready" || state.inflight !== written || state.content === written) return null;
  return { text: state.content, expected: { content: written, exists: true } };
}

/**
 * What to do with the stored draft. Undefined leaves it alone: until the CV
 * has loaded there is nothing to compare it with, and a failed load must not
 * erase the draft the next reload would restore. Null removes it.
 *
 * @param {EditorState} state
 * @returns {CvDraft | undefined}
 */
export function draftChange(state) {
  if (state.phase !== "ready") return undefined;
  return draftToStore(state);
}

/**
 * Read a draft that was stored as JSON. `inflight` is the text still being
 * written when the page was closed. Dropping it makes a reload reject the
 * draft once that text has reached the file.
 *
 * @param {unknown} raw
 * @returns {CvDraft}
 */
export function draftFromStore(raw) {
  if (!raw || typeof raw !== "object") return null;
  const draft = /** @type {{ base?: unknown, content?: unknown, inflight?: unknown }} */ (raw);
  if (typeof draft.base !== "string" || typeof draft.content !== "string") return null;
  const parsed = { base: draft.base, content: draft.content };
  if (typeof draft.inflight === "string") parsed.inflight = draft.inflight;
  return parsed;
}

/** @param {EditorState} state @returns {CvDraft} */
export function draftToStore(state) {
  if (state.phase !== "ready") return null;
  const inflight = typeof state.inflight === "string" && state.inflight !== state.saved ? state.inflight : null;
  if (state.content === state.saved && inflight === null && !state.conflict) return null;
  const draft = { base: state.saved, content: state.content };
  if (inflight !== null) draft.inflight = inflight;
  return draft;
}
