/**
 * tests/discover-ats-small-board.test.mjs — soft warning for small boards (#4772)
 *
 * discover-ats.mjs keeps resolving a board that lists only a few postings, but
 * flags it: a `smallBoard` field in the JSON, a marker in --summary, and a
 * `# verify:` comment on the entry --write appends. The threshold and wording
 * are shared with audit-portals.mjs through lib/small-board.mjs. No network.
 */

import { flagSmallBoards, renderPortalEntry, insertIntoTrackedCompanies } from '../discover-ats.mjs';
import { DEFAULT_SMALL_THRESHOLD as AUDIT_THRESHOLD, classifyBoard } from '../audit-portals.mjs';
import { DEFAULT_SMALL_THRESHOLD, isSmallBoard, smallBoardDetail } from '../lib/small-board.mjs';
import * as yaml from 'js-yaml';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

console.log('\ndiscover-ats.mjs — small board warning');

const ok = (label, cond) => (cond ? pass(label) : fail(label));
const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'discover-ats.mjs');

// Shared with audit-portals
ok('threshold is shared with audit-portals', AUDIT_THRESHOLD === DEFAULT_SMALL_THRESHOLD);
const audit = classifyBoard({ provider: 'recruitee', jobs: [{ title: 'x' }] });
ok('audit-portals wording matches the shared detail', audit.verdict === 'small' && audit.detail === smallBoardDetail(1));

// isSmallBoard boundaries
ok('count at the threshold is small', isSmallBoard(DEFAULT_SMALL_THRESHOLD));
ok('count above the threshold is not small', !isSmallBoard(DEFAULT_SMALL_THRESHOLD + 1));
ok('threshold 0 turns the check off', !isSmallBoard(1, 0));

// flagSmallBoards
const resolved = [
  { name: 'Personio', jobCount: 1 },
  { name: 'Big Co', jobCount: 300 },
  { name: 'Edge', jobCount: 5 },
];
flagSmallBoards(resolved);
ok('single-posting board is flagged', resolved[0].smallBoard === true);
ok('large board is not flagged', resolved[1].smallBoard === undefined);
ok('board exactly at the threshold is flagged', resolved[2].smallBoard === true);
const custom = flagSmallBoards([{ name: 'A', jobCount: 3 }], 2);
ok('custom threshold is honored', custom[0].smallBoard === undefined);

// renderPortalEntry
const flagged = renderPortalEntry({ name: 'Personio', careers_url: 'https://personio.recruitee.com', provider: 'recruitee', jobCount: 1, smallBoard: true });
ok('flagged entry carries a # verify: comment', /\n {4}# verify: only 1 posting\(s\)/.test(flagged));
const plain = renderPortalEntry({ name: 'Big Co', careers_url: 'https://jobs.lever.co/bigco', jobCount: 300 });
ok('unflagged entry has no # verify: comment', !plain.includes('# verify:'));

// The comment must not change what portals.yml parses to
const doc = 'tracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n';
const merged = yaml.load(insertIntoTrackedCompanies(doc, [flagged]));
const added = merged.tracked_companies.find((e) => e.name === 'Personio');
ok('portals.yml still parses with the comment', !!added && added.careers_url === 'https://personio.recruitee.com' && added.enabled === true);
ok('comment adds no extra YAML keys', Object.keys(added).sort().join(',') === 'careers_url,enabled,name,provider');

// CLI: --small-threshold validation (no companies, so no network)
let badExit = 0;
try {
  execFileSync('node', [script, '--small-threshold', 'abc', 'Foo'], { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' });
} catch (e) {
  badExit = e.status;
}
ok('non-numeric --small-threshold exits nonzero', badExit !== 0);
let okExit = 0;
try {
  execFileSync('node', [script, '--small-threshold', '0'], { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' });
} catch (e) {
  okExit = e.status;
}
ok('--small-threshold 0 is accepted', okExit === 0);
