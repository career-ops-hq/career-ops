// lib/node-floor.mjs — the project's minimum Node.js version, stated once.
//
// 22.13 is the lowest release where everything in the root CLI runs with no
// flags. node:sqlite (tracker.mjs's index) landed in 22.5.0 but stayed behind
// --experimental-sqlite until 22.13.0 / 23.4.0, and tracker.mjs imports it
// plainly — so on 22.5 through 22.12 (and 23.0 through 23.3) the import fails.
// doctor used to pass that range because it read "added in 22.5" as "usable
// from 22.5" (#4801).
//
// Node 18 and 20 are past end of life, and nothing in CI ran either of them, so
// the old ">= 18" floor promised compatibility no one was checking.
//
// package.json `engines` (NODE_ENGINES), scaffolder/package.json `engines`, and
// the CI floor job in .github/workflows/test.yml carry the same numbers;
// tests/node-floor.test.mjs fails if any of them drifts from these.

export const NODE_MIN = '22.13.0';

// The 23.x line unflagged node:sqlite later, in 23.4.0, so 23.0–23.3 are below
// the floor even though they are numerically above 22.13. (23.x is EOL; this
// only keeps the verdict honest for anyone still on it.)
export const NODE_MIN_23 = '23.4.0';

export const NODE_ENGINES = `^${NODE_MIN} || >=${NODE_MIN_23}`;

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
  const [, min23Minor] = parse(NODE_MIN_23);
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

  const meets = major === 23
    ? minor >= min23Minor
    : major > minMajor || (major === minMajor && minor >= minMinor);

  if (meets) {
    return { pass: true, label: `Node.js >= ${floor} (v${versionStr})` };
  }

  return {
    pass: false,
    label: major === 23
      ? `Node.js 23 needs 23.${min23Minor} or later for node:sqlite without a flag (found v${versionStr})`
      : `Node.js >= ${floor} required (found v${versionStr})`,
    fix: [
      `Install Node.js ${floor} or later (the current LTS is a safe choice) from https://nodejs.org`,
      `tracker.mjs's index uses node:sqlite, which needs no flag only from Node ${floor} on (${NODE_MIN_23.split('.').slice(0, 2).join('.')} on the 23.x line).`,
    ],
  };
}
