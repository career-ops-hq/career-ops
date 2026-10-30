// A local parser that always fails. Each real execution leaves one line in the
// file named by CO_TEST_PARSER_MARKER, so a test can count how many times the
// scanner ran it.
import { appendFileSync } from 'node:fs';

if (process.env.CO_TEST_PARSER_MARKER) appendFileSync(process.env.CO_TEST_PARSER_MARKER, 'ran\n');
process.stderr.write('failing-parser fixture: exiting 1 on purpose\n');
process.exit(1);
