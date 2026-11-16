// lib/gemini-node-floor.mjs — the one place that knows the Gemini integration
// needs a higher Node than the rest of the project.
//
// This exists because the fact used to live only in prose. docs/SETUP.md stated
// it, the docs site did not, and a user on Node 18 who followed the site and
// picked the Gemini path hit the requirement at runtime with nothing warning
// them. Worse, the Spanish and French pages had drifted the other way and
// asserted Node 20 as a *general* requirement, which is false.
//
// Prose copies drift. A runtime verdict does not: doctor emits it, and every
// surface that renders doctor's output gets it without keeping a second copy.
// So the number lives here, once, and everything else derives.
//
// Scoped on purpose: it returns null unless the CLI actually in use is Gemini.
//
// Since #4801 the project-wide floor (lib/node-floor.mjs, 22.13) sits above
// this one, so a Node that fails here already fails doctor's own Node check.
// This verdict now only adds which integration needed the version; it no longer
// offers "use another CLI" as a way out, because none exists below the project
// floor.

import { NODE_MIN } from './node-floor.mjs';

export const GEMINI_MIN_MAJOR = 20;

/**
 * Verdict on whether the running Node satisfies the Gemini integration's floor.
 *
 * @param {string} activeCli - The CLI in use, as resolved by doctor.
 * @param {string} versionStr - A Node version string, e.g. "18.20.4".
 * @returns {{pass: boolean, label: string, fix?: string[]}|null} null when the
 *   check does not apply (any CLI other than Gemini).
 */
export function geminiNodeFloor(activeCli, versionStr) {
  if (activeCli !== 'gemini') return null;

  const major = Number(String(versionStr).split('.')[0]);

  // An unparseable version is not a pass. Reporting "fine" because we could not
  // read the number is the failure mode this project keeps finding elsewhere:
  // a check that cannot look must not answer "all clear".
  if (!Number.isFinite(major)) {
    return {
      pass: false,
      label: `Could not read the Node.js version ("${versionStr}"), so the Gemini integration's Node ${GEMINI_MIN_MAJOR}+ requirement could not be verified`,
      fix: [`Check your Node install, then confirm it is ${GEMINI_MIN_MAJOR} or later: node --version`],
    };
  }

  if (major >= GEMINI_MIN_MAJOR) {
    return { pass: true, label: `Node.js >= ${GEMINI_MIN_MAJOR} for the Gemini CLI integration (v${versionStr})` };
  }

  return {
    pass: false,
    label: `The Gemini CLI integration requires Node.js ${GEMINI_MIN_MAJOR}+ (found v${versionStr})`,
    // Point at the project floor, not GEMINI_MIN_MAJOR: upgrading only to 20
    // would still fail doctor's own Node check.
    fix: [`Upgrade Node.js to ${NODE_MIN.split('.').slice(0, 2).join('.')} or later from https://nodejs.org (career-ops as a whole needs it; Gemini alone needs ${GEMINI_MIN_MAJOR}+)`],
  };
}
