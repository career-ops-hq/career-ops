// tests/cv-visual-apt-update.test.mjs
//
// tests/cv-visual/Dockerfile installs fonts and Poppler from snapshot.ubuntu.com.
// Without --error-on=any a failed InRelease fetch only warns, so the build fails
// later with a misleading "Unable to locate package" (exit 100) instead of the
// 503/502 that caused it. The update therefore has to fail on any error, and
// retry, because the snapshot service has outages that last a few minutes.
// The install retries for the same reason: apt's own retries span under a
// minute, and an outage can begin after the update has succeeded.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n🔁 cv-visual apt update and install (fail loudly on a bad fetch, retry)');

// Reasons the apt-get update and install steps are not safe, or [] when they
// are. Each step is a `for ... done` loop that contains the apt-get call, and
// its exit guard has to fire on the loop's last attempt: with a higher bound the
// loop ends on `sleep`'s status and a failed fetch passes.
function aptProblems(dockerfile) {
  const text = dockerfile.replace(/\\\r?\n/g, ' ');
  const loops = [...text.matchAll(/\bfor\s+(\w+)\s+in\s+([^;]+);\s*do\b(.*?)\bdone\b/gs)]
    .map((m) => ({ variable: m[1], attempts: m[2].trim().split(/\s+/), body: m[3] }));
  const problems = [];
  for (const command of ['update', 'install']) {
    const loop = loops.find(({ body }) => new RegExp(`\\bapt-get ${command}\\b`).test(body));
    if (!loop) {
      problems.push(`apt-get ${command} is not inside a retry loop`);
      continue;
    }
    if (command === 'update' && !/\bapt-get update\b[^;&|]*--error-on=any\b/.test(loop.body)) {
      problems.push('apt-get update lacks --error-on=any');
    }
    // Stop at `|` too: `apt-get install x || echo failed && break` breaks after a failure.
    if (!new RegExp(`\\bapt-get ${command}\\b[^;|]*&&\\s*break\\b`).test(loop.body)) {
      problems.push(`the apt-get ${command} loop does not break on success`);
    }
    const last = loop.attempts.at(-1);
    const guard = new RegExp(`\\[\\s*"?\\$${loop.variable}"?\\s+-lt\\s+${last}\\s*\\]\\s*\\|\\|\\s*exit\\s+1\\b`);
    if (!/^\d+$/.test(last) || !guard.test(loop.body)) {
      problems.push(`the apt-get ${command} loop does not exit non-zero after the last attempt`);
    }
  }
  return problems;
}

// ── The check ────────────────────────────────────────────────────────
const UPDATE_LOOP = `    && for attempt in 1 2 3; do \\
         apt-get update --error-on=any && break; \\
         [ "$attempt" -lt 3 ] || exit 1; \\
         sleep 1; \\
       done \\
`;
const INSTALL_LOOP = `    && for attempt in 1 2 3; do \\
         apt-get install -y \\
           x && break; \\
         [ "$attempt" -lt 3 ] || exit 1; \\
         sleep 1; \\
       done
`;
const GOOD = `RUN a \\\n${UPDATE_LOOP}${INSTALL_LOOP}`;
for (const [label, text, want] of [
  ['retrying update and install loops', GOOD, 0],
  ['CRLF line endings', GOOD.replace(/\n/g, '\r\n'), 0],
  ['a bare update', `RUN a \\\n    && apt-get update \\\n${INSTALL_LOOP}`, 1],
  ['an update loop without --error-on=any', GOOD.replace(' --error-on=any', ''), 1],
  ['an update loop that never fails', `RUN a \\\n${UPDATE_LOOP.replace('|| exit 1', '|| true')}${INSTALL_LOOP}`, 1],
  ['an update loop that never breaks', GOOD.replace('--error-on=any && break', '--error-on=any'), 1],
  ['--error-on=any outside the loop', `RUN apt-get update --error-on=any \\\n${INSTALL_LOOP}`, 1],
  ['a bare install', `RUN a \\\n${UPDATE_LOOP}    && apt-get install -y x\n`, 1],
  ['an install loop that never fails', `RUN a \\\n${UPDATE_LOOP}${INSTALL_LOOP.replace('|| exit 1', '|| true')}`, 1],
  ['an install loop that never breaks', GOOD.replace('x && break', 'x'), 1],
  ['an install loop that breaks after a failure', GOOD.replace('x && break', 'x || echo failed && break'), 1],
  ['an update loop that breaks after a failure', GOOD.replace('--error-on=any && break', '--error-on=any || echo failed && break'), 1],
  ['an update loop whose exit misses the last attempt', `RUN a \\\n${UPDATE_LOOP.replace('-lt 3', '-lt 6')}${INSTALL_LOOP}`, 1],
  ['an install loop whose exit misses the last attempt', `RUN a \\\n${UPDATE_LOOP}${INSTALL_LOOP.replace('-lt 3', '-lt 6')}`, 1],
]) {
  const got = aptProblems(text).length > 0 ? 1 : 0;
  if (got === want) pass(`${label} is ${want ? 'rejected' : 'accepted'}`);
  else fail(`${label}: expected ${want ? 'rejected' : 'accepted'}, got ${got ? 'rejected' : 'accepted'}`);
}

// ── The Dockerfile ───────────────────────────────────────────────────
const problems = aptProblems(readFileSync(join(ROOT, 'tests/cv-visual/Dockerfile'), 'utf-8'));
if (problems.length === 0) {
  pass('tests/cv-visual/Dockerfile retries apt-get update --error-on=any and apt-get install');
} else {
  for (const p of problems) fail(`tests/cv-visual/Dockerfile: ${p}`);
}
