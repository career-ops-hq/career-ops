import { pass, fail } from './helpers.mjs';
import { metricClaims, stripMarkup, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nMetric fact gate — markdown emphasis');

// cv.md and article-digest.md bold nearly every metric. stripMarkup used to
// leave `**` in place, and metricClaims only tolerates whitespace between a
// number and its noun — so a closing `**` severed the pair and the metric was
// never extracted. A truthful CV quoting the sources verbatim then failed the
// gate as "invented". Regression for issue #4085.

const bolded = [
  ['**194** automated tests', '194 tests'],
  ['Layer A **2,044** tests', '2044 tests'],
  ['**2,842** commits', '2842 commits'],
  ['*35* people', '35 people'],
];
for (const [input, expected] of bolded) {
  const claims = [...metricClaims(input)];
  if (claims.includes(expected)) {
    pass(`extracts ${JSON.stringify(expected)} from ${JSON.stringify(input)}`);
  } else {
    fail(`bolded metric dropped: ${JSON.stringify(input)} -> ${JSON.stringify(claims)}`);
  }
}

// The emphasis strip is asterisk-only on purpose. Underscores are load-bearing
// in these sources (snake_case, env-keys.json, file paths), so they must pass
// through untouched and the count noun after a bolded number must survive.
if (stripMarkup('shipped **738** commits to env_keys.json') === 'shipped 738 commits to env_keys.json') {
  pass('leaves underscores in identifiers alone while stripping asterisks');
} else {
  fail(`stripMarkup mangled an identifier: ${JSON.stringify(stripMarkup('shipped **738** commits to env_keys.json'))}`);
}

// End to end: a CV that quotes a bolded metric from cv.md now clears the gate.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-emphasis-facts-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(source, 'Automated the suite to **2,044** tests across **35** people.');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [] }));

  const supported = verifyFacts('Automated the suite to 2,044 tests across 35 people.', {
    sourcePaths: [source], configPath: config,
  });
  if (supported.verdict === 'pass' && supported.invented.length === 0) {
    pass('a CV quoting bolded source metrics clears the gate');
  } else {
    fail(`truthful bolded metrics were blocked: ${JSON.stringify(supported)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
