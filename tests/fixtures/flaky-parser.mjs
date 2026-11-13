// A local parser that fails like a network timeout on its first run and
// succeeds on the next. The state lives in the file named by
// CO_TEST_PARSER_MARKER: one line per run, so a test can also count runs.
import { appendFileSync, existsSync } from 'node:fs';

const marker = process.env.CO_TEST_PARSER_MARKER;
const firstRun = !marker || !existsSync(marker);
if (marker) appendFileSync(marker, 'ran\n');
if (firstRun) {
  process.stderr.write('flaky-parser fixture: fetch failed (ETIMEDOUT) on purpose\n');
  process.exit(1);
}
console.log(JSON.stringify([{ title: 'Strategy Engineer', url: 'https://self-hosted.example.com/jobs/1' }]));
