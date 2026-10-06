// lib/node-floor.mjs — the project's minimum Node.js version, stated once.
//
// 22.13 is the lowest release where everything in the root CLI runs with no
// flags. node:sqlite (tracker.mjs's index) landed in 22.5.0 but stayed behind
// --experimental-sqlite until 22.13.0 / 23.4.0, and tracker.mjs imports it
// plainly — so on 22.5 through 22.12 the import fails. doctor used to pass that
// range because it read "added in 22.5" as "usable from 22.5" (#4801).
//
// Node 18 and 20 are past end of life, and nothing in CI ran either of them, so
// the old ">= 18" floor promised compatibility no one was checking.
//
// package.json `engines`, scaffolder/package.json `engines`, and the CI floor
// job in .github/workflows/test.yml carry the same number;
// tests/node-floor.test.mjs fails if any of them drifts from this one.

export const NODE_MIN = '22.13.0';

const parse = (v) => String(v).replace(/^v/, '').split('.').map(Number);

/**
 * Verdict on whether a Node version meets the project floor.
 *
 * @param {string} versionStr - A Node version string, e.g. "22.12.0".
 * @returns {{pass: boolean, label: string, fix?: string[]}}
 */
export function nodeFloor(versionStr) {
  const [major, minor] = parse(versionStr);
  const [minMajor, minMinor] = parse(NODE_MIN);
  const floor = `${minMajor}.${minMinor}`;

  // An unreadable version is not a pass: a check that cannot look must not
  // answer "all clear".
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return {
      pass: false,
      label: `Could not read the Node.js version ("${versionStr}"), so the Node ${floor}+ requirement could not be verified`,
      fix: [`Check your Node install, then confirm it is ${floor} or later: node --version`],
    };
  }

  if (major > minMajor || (major === minMajor && minor >= minMinor)) {
    return { pass: true, label: `Node.js >= ${floor} (v${versionStr})` };
  }

  return {
    pass: false,
    label: `Node.js >= ${floor} required (found v${versionStr})`,
    fix: [
      `Install Node.js ${floor} or later (the current LTS is a safe choice) from https://nodejs.org`,
      `tracker.mjs's index uses node:sqlite, which needs no flag only from Node ${floor} on.`,
    ],
  };
}
