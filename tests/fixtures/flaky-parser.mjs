// A local parser that fails its first CO_TEST_FAIL_TIMES runs (default 1) with a
// transport-looking error, then returns one job. Each execution appends a line
// to the file named by CO_TEST_PARSER_MARKER, which is also how it knows how
// many times it has run, so a test can count the attempts the scanner made.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const marker = process.env.CO_TEST_PARSER_MARKER;
const failTimes = Number(process.env.CO_TEST_FAIL_TIMES ?? 1);
const runsBefore = marker && existsSync(marker)
  ? readFileSync(marker, 'utf-8').split('\n').filter(Boolean).length
  : 0;
if (marker) appendFileSync(marker, 'ran\n');

if (runsBefore < failTimes) {
  // classifyFetchError reads "network" in the message as a network failure.
  process.stderr.write('flaky-parser fixture: network error, connection reset\n');
  process.exit(1);
}
console.log(JSON.stringify([{ title: 'Software Engineer', url: 'https://example.com/jobs/flaky-1' }]));