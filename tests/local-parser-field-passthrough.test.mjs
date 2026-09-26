// tests/local-parser-field-passthrough.test.mjs — #3438 provider contract.
// normalizeParserJob() built a closed object literal, so a jobs-json-v1 parser
// could publish an occupation code and scan.mjs would never see it. That made
// a non-title `filter_on` dead on arrival for every local-parser board — the
// transport Job Bank targets actually use.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nlocal-parser — extra fields reach the scanner');

const mod = await import(pathToFileURL(join(ROOT, 'providers/local-parser.mjs')).href);
const { normalizeParserJob } = mod;
const entry = { name: 'Job Bank — help desk', careers_url: 'https://www.jobbank.gc.ca/jobsearch/jobsearch' };

// The case the issue turns on.
{
  const got = normalizeParserJob(
    { title: 'Analyst, Client Services', url: 'https://www.jobbank.gc.ca/jobsearch/jobposting/1', noc: '22221' },
    entry,
  );
  if (got && got.noc === '22221') pass('an extra field (noc) survives normalization');
  else fail(`expected noc to survive, got ${JSON.stringify(got)}`);
}

// Behaviour-neutral today: no existing parser emits anything beyond the four
// normalized keys, so the object is byte-for-byte what it was.
{
  const got = normalizeParserJob(
    { title: 'Order Picker', url: 'https://example.com/1', company: 'Acme', location: 'Mississauga, ON' },
    entry,
  );
  const want = { title: 'Order Picker', url: 'https://example.com/1', company: 'Acme', location: 'Mississauga, ON' };
  if (JSON.stringify(got) === JSON.stringify(want)) pass('a job with no extra keys is unchanged');
  else fail(`expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// The normalized keys are authoritative: a parser that emits both `name` and
// `title`, or a raw `locations` array, must not have the raw form win.
{
  const got = normalizeParserJob(
    { name: 'raw name', title: 'Real Title', url: 'https://example.com/2',
      locations: ['Toronto, ON', 'Ottawa, ON'], job_url: 'https://wrong.example/x', dept: 'IT' },
    entry,
  );
  if (got.title === 'Real Title' && got.location === 'Toronto, ON, Ottawa, ON'
      && got.url === 'https://example.com/2' && got.name === undefined
      && got.locations === undefined && got.job_url === undefined) {
    pass('raw aliases are consumed, not carried through');
  } else {
    fail(`aliases leaked: ${JSON.stringify(got)}`);
  }
  if (got.dept === 'IT') pass('an unrelated extra key still passes through');
  else fail('expected dept to survive');
}

// Posting dates are validated, not passed through (#4057). The date aliases
// are consumed like the other normalized keys, so an unparseable raw date
// cannot ride along in the passthrough beside the validated postedAt.
{
  const bad = normalizeParserJob(
    { title: 'Analyst', url: 'https://example.com/4', postedAt: 'not a date', date_posted: 'also not', noc: '22221' },
    entry,
  );
  if (bad && bad.noc === '22221' && !('postedAt' in bad) && !('date_posted' in bad)) {
    pass('an unparseable posting date is dropped, not carried through with the extra keys');
  } else {
    fail(`raw date leaked or extra key lost: ${JSON.stringify(bad)}`);
  }

  const good = normalizeParserJob(
    { title: 'Analyst', url: 'https://example.com/5', posted_at: '2026-09-01T00:00:00Z', noc: '22221' },
    entry,
  );
  if (good && good.postedAt === Date.parse('2026-09-01T00:00:00Z') && !('posted_at' in good) && good.noc === '22221') {
    pass('a parseable date alias arrives as postedAt only, next to the extra keys');
  } else {
    fail(`expected postedAt only: ${JSON.stringify(good)}`);
  }
}

// Guard rails unchanged.
{
  if (normalizeParserJob(null, entry) === null) pass('null job still rejected');
  else fail('expected null');
  if (normalizeParserJob({ url: 'https://example.com/3' }, entry) === null) pass('a job with no title still rejected');
  else fail('expected null for a titleless job');
}
