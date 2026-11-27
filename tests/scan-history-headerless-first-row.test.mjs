// tests/scan-history-headerless-first-row.test.mjs — collectSeenUrls keeps the
// first row of a headerless scan-history.tsv.
//
// appendToScanHistory documents headerless legacy files as a supported state.
// The reader used to skip line 0 unconditionally, so on such a file the oldest
// row was read as a header and dropped, and that URL was never pinned.
import { pass, fail } from './helpers.mjs';
import { collectSeenUrls, seenJobKey } from '../scan.mjs';

console.log('\nscan.mjs — collectSeenUrls keeps the first row of a headerless scan-history.tsv');

const URL1 = 'https://boards.greenhouse.io/acme/jobs/1';
const URL2 = 'https://boards.greenhouse.io/acme/jobs/2';
// The pin is the same-job key. These two board URLs are greenhouse:1 and greenhouse:2.
const KEY1 = seenJobKey(URL1);
const KEY2 = seenJobKey(URL2);
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const row = (url) => `${url}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`;

const headerless = [row(URL1), row(URL2), ''].join('\n');
const { seen: seenHeaderless } = collectSeenUrls({ scanHistoryText: headerless }, {});
if (seenHeaderless.has(KEY1) && seenHeaderless.has(KEY2)) {
  pass('headerless file: both rows are pinned, including the first');
} else {
  fail(`headerless file lost a row (row 1: ${seenHeaderless.has(KEY1)}, row 2: ${seenHeaderless.has(KEY2)})`);
}

const withHeader = [HEADER, row(URL1), row(URL2), ''].join('\n');
const { seen: seenHeader } = collectSeenUrls({ scanHistoryText: withHeader }, {});
if (seenHeader.has(KEY1) && seenHeader.has(KEY2) && seenHeader.size === 2) {
  pass('file with a header: both rows are pinned and the header is not read as a row');
} else {
  fail(`file with a header changed behaviour (size ${seenHeader.size})`);
}
