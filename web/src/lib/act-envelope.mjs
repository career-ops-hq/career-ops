// Pure JS helper for the assistant console's <<act:ID {json}>> envelope parser
// (assistant-console.tsx). No TypeScript types so it can be imported by both the
// component and tests/lib/act-envelope.test.mjs (which can't import .tsx
// without a runner).
//
// parseEnvelopes only hides an incomplete envelope once the opener regex
// `<<act:([a-zA-Z]+)[ \t]+` fully matches — i.e. `<<act:`, the id letters, AND
// the trailing space are all present. While a chunk boundary leaves the opener
// short of that (`<<`, `<<act`, `<<act:save` with no space yet), nothing hides
// it, so the half-written marker flickers into the rendered chat bubble on every
// action the assistant takes. This finds where such a trailing partial opener
// begins so the caller can hide it too — the same "buffer a split opener, never
// render garbage" invariant the AI-search parser holds (stream-parse.mjs).

const OPEN = "<<act:";

/**
 * Start index of a trailing partial `<<act:` opener in `acc` that the main
 * `<<act:([a-zA-Z]+)[ \t]+` regex can't match yet, or -1 if none.
 *
 * Anchored to the end of `acc`, so a completed envelope earlier in the string
 * (which is followed by its `>>`, not by end-of-buffer) is never matched.
 *
 * @param {string} acc - Accumulated assistant text so far.
 * @returns {number} Index where the trailing partial opener starts, else -1.
 */
export function pendingActOpenerStart(acc) {
  // `<<act:` plus any id letters, but no trailing space yet → regex can't fire.
  const withColon = /<<act:[a-zA-Z]*$/.exec(acc);
  if (withColon) return withColon.index;
  // A proper prefix of the literal `<<act:` at the very end (`<` … `<<act`).
  for (let k = Math.min(acc.length, OPEN.length - 1); k > 0; k--) {
    if (acc.endsWith(OPEN.slice(0, k))) return acc.length - k;
  }
  return -1;
}
