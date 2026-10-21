// tests/scan-history-headerless-first-row.test.mjs — collectSeenUrls keeps the
// first row of a headerless scan-history.tsv.
//
// appendToScanHistory documents headerless legacy files as a supported state.
// The reader used to skip line 0 unconditionally, so on such a file the oldest
// row was read as a header and dropped, and that URL was never pinned.
import { pass, fail } from './helpers.mjs';
import { collectSeenUrls } from '../scan.mjs';

console.log('\nscan.mjs — collectSeenUrls keeps the first row of a headerless scan-history.tsv');

const URL1 = 'https://boards.greenhouse.io/acme/jobs/1';
const URL2 = 'https://boards.greenhouse.io/acme/jobs/2';
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const row = (url) => `${url}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`;

const headerless = [row(URL1), row(URL2), ''].join('\n');
const { seen: seenHeaderless } = collectSeenUrls({ scanHistoryText: headerless }, {});
if (seenHeaderless.has(URL1) && seenHeaderless.has(URL2)) {
  pass('headerless file: both rows are pinned, including the first');
} else {
  fail(`headerless file lost a row (row 1: ${seenHeaderless.has(URL1)}, row 2: ${seenHeaderless.has(URL2)})`);
}

const withHeader = [HEADER, row(URL1), row(URL2), ''].join('\n');
const { seen: seenHeader } = collectSeenUrls({ scanHistoryText: withHeader }, {});
if (seenHeader.has(URL1) && seenHeader.has(URL2) && seenHeader.size === 2) {
  pass('file with a header: both rows are pinned and the header is not read as a row');
} else {
  fail(`file with a header changed behaviour (size ${seenHeader.size})`);
}
