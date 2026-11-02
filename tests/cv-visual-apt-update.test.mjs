// tests/cv-visual-apt-update.test.mjs
//
// tests/cv-visual/Dockerfile installs fonts and Poppler from snapshot.ubuntu.com.
// Without --error-on=any a failed InRelease fetch only warns, so the build fails
// later with a misleading "Unable to locate package" (exit 100) instead of the
// 503/502 that caused it. The update therefore has to fail on any error, and
// retry, because the snapshot service has outages that last a few minutes.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n🔁 cv-visual apt update (fails loudly on a bad fetch, retries)');

// Reasons the apt-get update step is not safe, or [] when it is. The step is
// the `for ... done` loop that contains the update call.
function aptUpdateProblems(dockerfile) {
  const text = dockerfile.replace(/\\\r?\n/g, ' ');
  const loop = text.match(/\bfor\s+\w+\s+in\s+[^;]+;\s*do\b(.*?)\bdone\b/s)?.[1];
  if (!loop || !/\bapt-get update\b/.test(loop)) {
    return ['apt-get update is not inside a retry loop'];
  }
  const problems = [];
  if (!/\bapt-get update\b[^;&|]*--error-on=any\b/.test(loop)) problems.push('apt-get update lacks --error-on=any');
  if (!/\bapt-get update\b[^;]*&&\s*break\b/.test(loop)) problems.push('the loop does not break on success');
  if (!/\bexit\s+1\b/.test(loop)) problems.push('the loop does not exit non-zero after the last attempt');
  return problems;
}

// ── The check ────────────────────────────────────────────────────────
const GOOD = `RUN a \\
    && for attempt in 1 2 3; do \\
         apt-get update --error-on=any && break; \\
         [ "$attempt" -lt 3 ] || exit 1; \\
         sleep 1; \\
       done \\
    && apt-get install -y x
`;
for (const [label, text, want] of [
  ['a retrying update with --error-on=any', GOOD, 0],
  ['CRLF line endings', GOOD.replace(/\n/g, '\r\n'), 0],
  ['a bare update', 'RUN a \\\n    && apt-get update \\\n    && apt-get install -y x\n', 1],
  ['a loop without --error-on=any', GOOD.replace(' --error-on=any', ''), 1],
  ['a loop that never fails', GOOD.replace('|| exit 1', '|| true'), 1],
  ['a loop that never breaks', GOOD.replace(' && break', ''), 1],
  ['--error-on=any outside the loop', 'RUN apt-get update --error-on=any\n', 1],
]) {
  const got = aptUpdateProblems(text).length > 0 ? 1 : 0;
  if (got === want) pass(`${label} is ${want ? 'rejected' : 'accepted'}`);
  else fail(`${label}: expected ${want ? 'rejected' : 'accepted'}, got ${got ? 'rejected' : 'accepted'}`);
}

// ── The Dockerfile ───────────────────────────────────────────────────
const problems = aptUpdateProblems(readFileSync(join(ROOT, 'tests/cv-visual/Dockerfile'), 'utf-8'));
if (problems.length === 0) {
  pass('tests/cv-visual/Dockerfile retries apt-get update --error-on=any');
} else {
  for (const p of problems) fail(`tests/cv-visual/Dockerfile: ${p}`);
}
