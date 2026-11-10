// tests/required-tools.mjs — tools a suite can need that a plain checkout lacks.
//
// Some suites check something only a real Chromium or a real TeX engine can
// show: a PDF's text layer, a template that compiles. A contributor's machine
// may have neither, so those suites skip (node:test) or warn (pass/fail) when
// the tool is missing. The required `test` job installs neither, so before
// #5756 and #5758 those checks ran on no CI job at all, and a green check said
// nothing about them.
//
// The fix is a job that does have the tools and runs those suites with the
// skip turned into a failure. A suite declares what it needs by calling
// toolRequired(tool) (node:test: in its `skip` condition) or toolUnavailable()
// from tests/helpers.mjs (pass/fail: in its "cannot launch" branch).
// `node test-all.mjs --needs <tool>` selects every suite that declares the tool
// and sets its variable below to 1, so a missing tool fails there instead of
// skipping. tests/required-tools-declared.test.mjs keeps a new browser suite
// from leaving that selection by skipping its own way.
//
// Kept apart from tests/helpers.mjs on purpose: node:test suites import this,
// and helpers.mjs sets up the pass/fail suite sandbox as it loads.

/** Each tool, and the variable that turns its absence into a failure. */
export const REQUIRED_TOOL_ENV = Object.freeze({
  browser: 'CAREER_OPS_REQUIRE_BROWSER',
  latex: 'CAREER_OPS_REQUIRE_LATEX',
});

// One fixed pattern per tool, never a RegExp built from the name: `--needs`
// hands test-all.mjs the name straight from the command line.
const DECLARATION_RE = Object.freeze({
  browser: /\btool(?:Required|Unavailable)\(\s*['"]browser['"]/,
  latex: /\btool(?:Required|Unavailable)\(\s*['"]latex['"]/,
});

function envFor(tool) {
  // Object.hasOwn: a name such as "constructor" is not a tool.
  const name = Object.hasOwn(REQUIRED_TOOL_ENV, tool) ? REQUIRED_TOOL_ENV[tool] : null;
  if (!name) throw new Error(`unknown tool "${tool}" (known: ${Object.keys(REQUIRED_TOOL_ENV).join(', ')})`);
  return name;
}

/**
 * Whether this run must have `tool`: true when its variable is exactly "1".
 *
 * Read on every call, not once at load, because test-all.mjs sets the variable
 * after it has already imported the suites' helpers.
 *
 * @param {'browser'|'latex'} tool
 * @returns {boolean}
 */
export function toolRequired(tool) {
  return process.env[envFor(tool)] === '1';
}

/**
 * Whether a suite's source declares that it needs `tool`.
 *
 * Expects comment-stripped source, so a suite that only mentions the helpers
 * in a comment is not selected.
 *
 * @param {string} src
 * @param {'browser'|'latex'} tool
 * @returns {boolean}
 */
export function declaresTool(src, tool) {
  envFor(tool);
  return DECLARATION_RE[tool].test(src);
}
