import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — local-parser');

try {
  const localParserModule = await import(pathToFileURL(join(ROOT, 'providers/local-parser.mjs')).href);
  const localParser = localParserModule.default;

  // 1. Identity
  if (localParser.id === 'local-parser') pass('localParser.id is "local-parser"');
  else fail(`localParser.id is ${JSON.stringify(localParser.id)}`);

  // 2. Detect - Happy path
  const validEntry = {
    careers_url: 'https://example.com/careers',
    parser: { command: 'node', script: 'tests/providers/_fixture-local-parser.mjs' }
  };
  const hit = localParser.detect(validEntry);
  if (hit && hit.url === 'https://example.com/careers') {
    pass('localParser.detect() resolves valid config');
  } else {
    fail(`localParser.detect() returned ${JSON.stringify(hit)}`);
  }

  // Detect - Happy path without careers_url falls back to 'local-parser'
  const hitNoUrl = localParser.detect({ parser: validEntry.parser });
  if (hitNoUrl && hitNoUrl.url === 'local-parser') {
    pass('localParser.detect() falls back to "local-parser" when careers_url is missing');
  } else {
    fail('localParser.detect() fallback failed');
  }

  // 3. Detect - Negative paths
  if (localParser.detect({}) === null) {
    pass('localParser.detect() returns null when parser.command is missing');
  } else {
    fail('localParser.detect() should return null without command');
  }

  if (localParser.detect({ parser: { command: 'node' } }) === null) {
    pass('localParser.detect() returns null for interpreter without script');
  } else {
    fail('localParser.detect() should reject interpreter without script');
  }

  if (localParser.detect({ parser: { command: '../escaped' } }) === null) {
    pass('localParser.detect() returns null for command escaping root');
  } else {
    fail('localParser.detect() should reject escaped commands');
  }

  // 4. Fetch - Standard output, normalization, and dropping invalid jobs
  const fetchJobs = await localParser.fetch(validEntry);
  if (fetchJobs.length === 1) {
    pass('localParser.fetch() correctly extracts valid jobs and drops invalid ones');
  } else {
    fail(`localParser.fetch() returned ${fetchJobs.length} jobs, expected 1`);
  }

  if (fetchJobs[0]?.title === 'Standard Job' && fetchJobs[0]?.location === 'Remote, NY') {
    pass('localParser.fetch() parses fields and normalizes locations');
  } else {
    fail(`Fetch row 0 = ${JSON.stringify(fetchJobs[0])}`);
  }

  // 5. Fetch - Arguments interpolation
  const echoEntry = {
    name: 'Acme Corp',
    careers_url: 'https://example.com/acme',
    parser: {
      command: 'node',
      script: 'tests/providers/_fixture-local-parser.mjs',
      args: ['echo', 'Company:', '{company}', 'URL:', '{careers_url}']
    }
  };
  const echoJobs = await localParser.fetch(echoEntry);
  if (echoJobs[0]?.title === 'echo Company: Acme Corp URL: https://example.com/acme') {
    pass('localParser.fetch() interpolates {company} and {careers_url} correctly');
  } else {
    fail(`Interpolation failed, got title: ${echoJobs[0]?.title}`);
  }

  // 6. Fetch - Injection Prevention (Invalid URLs or companies)
  try {
    await localParser.fetch({
      name: '-Acme', // starts with hyphen
      careers_url: 'https://example.com',
      parser: echoEntry.parser
    });
    fail('localParser.fetch() should throw on company names starting with a hyphen');
  } catch (e) {
    if (e.message.includes("cannot start with '-'")) {
      pass('localParser.fetch() rejects company names that look like CLI flags');
    } else {
      fail(`Unexpected error: ${e.message}`);
    }
  }

  try {
    await localParser.fetch({
      name: 'Acme',
      careers_url: 'ftp://example.com', // invalid protocol
      parser: echoEntry.parser
    });
    fail('localParser.fetch() should throw on non-http(s) careers_url');
  } catch (e) {
    if (e.message.includes('must be http(s)')) {
      pass('localParser.fetch() rejects non-http(s) careers_url for interpolation');
    } else {
      fail(`Unexpected error: ${e.message}`);
    }
  }

  // 7. Fetch - Envelopes and URL resolution
  const envEntry = {
    careers_url: 'https://example.com/base/',
    parser: {
      command: 'node',
      script: 'tests/providers/_fixture-local-parser.mjs',
      args: ['envelope-jobs']
    }
  };
  const envJobs = await localParser.fetch(envEntry);
  if (envJobs[0]?.title === 'Envelope Job' && envJobs[0]?.url === 'https://example.com/job2') {
    pass('localParser.fetch() handles { jobs: [...] } envelope and resolves relative URLs');
  } else {
    fail(`Envelope extraction failed: ${JSON.stringify(envJobs[0])}`);
  }

  // 8. Fetch - Invalid JSON
  try {
    await localParser.fetch({
      parser: {
        command: 'node',
        script: 'tests/providers/_fixture-local-parser.mjs',
        args: ['invalid']
      }
    });
    fail('localParser.fetch() should throw on invalid JSON output');
  } catch (e) {
    if (e.message.includes('invalid JSON')) {
      pass('localParser.fetch() handles invalid JSON output safely');
    } else {
      fail(`Unexpected error for invalid JSON: ${e.message}`);
    }
  }

  // 9. Fetch - posting date. Without it a local-parser job reaches the scan loop
  // with no `postedAt`, so max_posting_age_days, --posted-after/--posted-before
  // and --since all pass it through, whatever the source actually said.
  const datedJobs = await localParser.fetch({
    careers_url: 'https://example.com/careers',
    parser: {
      command: 'node',
      script: 'tests/providers/_fixture-local-parser.mjs',
      args: ['dates'],
    },
  });
  const byTitle = Object.fromEntries(datedJobs.map(j => [j.title, j]));
  const expected = Date.parse('2026-02-08T00:00:00Z');

  if (byTitle['Epoch ms']?.postedAt === 1760000000000) {
    pass('localParser.fetch() keeps an epoch-ms postedAt as given');
  } else {
    fail(`epoch ms postedAt was ${JSON.stringify(byTitle['Epoch ms']?.postedAt)}`);
  }

  const spellings = [
    ['ISO date', 'posted_at', expected],
    ['ISO datetime', 'publishedAt', Date.parse('2026-02-08T10:30:00Z')],
    ['Breezy spelling', 'published_date', Date.parse('2026-02-08T10:30:00Z')],
    ['JSON-LD spelling', 'datePosted', expected],
  ];
  const wrongSpellings = spellings.filter(([title, , want]) => byTitle[title]?.postedAt !== want);
  if (wrongSpellings.length === 0) {
    pass('localParser.fetch() parses postedAt / posted_at / publishedAt / published_date / datePosted');
  } else {
    fail(`postedAt spellings not parsed: ${JSON.stringify(wrongSpellings.map(([t]) => t))}`);
  }

  const mustBeAbsent = ['Unparseable', 'Empty', 'Absent'];
  const leaked = mustBeAbsent.filter(t => 'postedAt' in (byTitle[t] || {}));
  if (leaked.length === 0) {
    pass('localParser.fetch() omits postedAt for unparseable, empty and absent dates');
  } else {
    fail(`postedAt should be absent for: ${JSON.stringify(leaked)}`);
  }

} catch (e) {
  fail(`local-parser provider tests crashed: ${e.message}`);
}
