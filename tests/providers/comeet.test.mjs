// tests/providers/comeet.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — comeet');


try {
  const comeetModule = await import(pathToFileURL(join(ROOT, 'providers/comeet.mjs')).href);
  const comeet = comeetModule.default;
  const { parseComeetResponse } = comeetModule;

  if (comeet.id === 'comeet') pass('comeet.id is "comeet"');
  else fail(`comeet.id is ${JSON.stringify(comeet.id)}`);

  // detect: explicit api: careers-api URL is honoured (and the secret token is
  // redacted from the informational DetectHit url).
  const apiUrl = 'https://www.comeet.co/careers-api/2.0/company/30.005/positions?token=ABC123';
  const apiHit = comeet.detect({ name: 'Spark Hire', api: apiUrl, careers_url: 'https://www.comeet.com/jobs/spark-hire/30.005' });
  if (apiHit && apiHit.url === 'https://www.comeet.co/careers-api/2.0/company/30.005/positions?token=REDACTED') {
    pass('comeet.detect() resolves an explicit api: URL and redacts the token');
  } else {
    fail(`comeet.detect() api: → ${JSON.stringify(apiHit)}`);
  }

  // the DetectHit url must not leak the real token (it may be logged)
  if (apiHit && !apiHit.url.includes('ABC123')) {
    pass('comeet.detect() does not leak the real token in the DetectHit url');
  } else {
    fail(`comeet.detect() leaked the token: ${JSON.stringify(apiHit)}`);
  }

  // detect: full careers-api URL pasted into careers_url is also accepted
  const cuHit = comeet.detect({ name: 'X', careers_url: apiUrl });
  if (cuHit && cuHit.url === 'https://www.comeet.co/careers-api/2.0/company/30.005/positions?token=REDACTED') {
    pass('comeet.detect() accepts a careers-api URL in careers_url');
  } else {
    fail(`comeet.detect() careers_url → ${JSON.stringify(cuHit)}`);
  }

  // detect: a branded www.comeet.com/jobs page carries no token → not claimed
  if (comeet.detect({ name: 'X', careers_url: 'https://www.comeet.com/jobs/spark-hire/30.005' }) === null) {
    pass('comeet.detect() returns null for a branded careers page (no token)');
  } else {
    fail('comeet.detect() should not claim a tokenless branded careers page');
  }

  if (comeet.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('comeet.detect() returns null for non-comeet URLs');
  } else {
    fail('comeet.detect() should return null for non-comeet URLs');
  }

  if (comeet.detect({ name: 'X', careers_url: null }) === null && comeet.detect({ name: 'X', api: 7 }) === null) {
    pass('comeet.detect() returns null for non-string url fields (null and 7)');
  } else {
    fail('comeet.detect() should treat non-string url fields as missing');
  }

  // SSRF: comeet.co in the PATH (not host) must not be detected.
  if (comeet.detect({ name: 'Spoof', api: 'https://evil.example/www.comeet.co/careers-api/2.0/company/x/positions' }) === null) {
    pass('comeet.detect() rejects path-spoofed URLs');
  } else {
    fail('comeet.detect() must NOT misdetect path-spoofed URLs');
  }

  // SSRF: the wrong comeet host (www.comeet.com, the hosted-page origin) is rejected.
  if (comeet.detect({ name: 'Spoof', api: 'https://www.comeet.com/careers-api/2.0/company/x/positions?token=y' }) === null) {
    pass('comeet.detect() pins to www.comeet.co (rejects www.comeet.com)');
  } else {
    fail('comeet.detect() must pin to www.comeet.co');
  }

  // parseComeetResponse — top-level array (real shape, confirmed live)
  const sample = [
    {
      name: 'AI Engineer',
      url_active_page: 'https://www.comeet.com/jobs/spark-hire/30.005/ai-engineer/F1.B67',
      url_comeet_hosted_page: 'https://www.comeet.com/jobs/spark-hire/30.005/ai-engineer/F1.B67',
      time_updated: '2026-06-11T07:49:20Z',
      location: { name: 'Tel Aviv, Israel', is_remote: true },
    },
    {
      name: 'Backend Engineer',
      url_comeet_hosted_page: 'https://www.comeet.com/jobs/spark-hire/30.005/backend/AB.C12',
      location: { name: 'Berlin, Germany', is_remote: false },
    },
    { name: 'No URL row', location: { name: 'Remote' } },
    { name: 'Insecure URL', url_active_page: 'http://www.comeet.com/jobs/x', location: {} },
  ];
  const jobs = parseComeetResponse(sample, 'Spark Hire');

  if (jobs.length === 2) pass('parseComeetResponse keeps 2 rows (drops missing/non-https url)');
  else fail(`parseComeetResponse returned ${jobs.length} rows (expected 2)`);

  if (jobs[0]?.title === 'AI Engineer' && jobs[0]?.company === 'Spark Hire' && jobs[0]?.location === 'Tel Aviv, Israel, Remote') {
    pass('parseComeetResponse maps name/location.name and appends Remote');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-06-11T07:49:20Z')) {
    pass('parseComeetResponse parses time_updated → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.url === 'https://www.comeet.com/jobs/spark-hire/30.005/backend/AB.C12' && jobs[1]?.location === 'Berlin, Germany' && jobs[1]?.postedAt === undefined) {
    pass('parseComeetResponse falls back to url_comeet_hosted_page and omits absent postedAt');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (parseComeetResponse(null, 'X').length === 0 && parseComeetResponse({}, 'X').length === 0) {
    pass('non-array payload → empty result (no crash)');
  } else {
    fail('non-array payload should yield empty result');
  }

  // a location already containing "Remote" must not get a duplicate suffix
  const noDup = parseComeetResponse([{ name: 'R', url_active_page: 'https://www.comeet.com/jobs/x/r', location: { name: 'Remote, EMEA', is_remote: true } }], 'X');
  if (noDup[0]?.location === 'Remote, EMEA') pass('parseComeetResponse does not double-append Remote');
  else fail(`expected "Remote, EMEA", got ${JSON.stringify(noDup[0]?.location)}`);

  // malformed members (null / non-object / whitespace-only name) must neither
  // throw nor slip through: a row needs a non-empty trimmed title AND a url.
  const dirty = [
    null,
    'not an object',
    42,
    { name: '   ', url_active_page: 'https://www.comeet.com/jobs/x/blank' }, // blank title → dropped
    { name: '  Padded Role  ', url_active_page: 'https://www.comeet.com/jobs/x/p', location: {} }, // trimmed, kept
  ];
  const cleaned = parseComeetResponse(dirty, 'X');
  if (cleaned.length === 1 && cleaned[0].title === 'Padded Role') {
    pass('parseComeetResponse skips null/non-object/blank-title rows and trims the title');
  } else {
    fail(`dirty parse = ${JSON.stringify(cleaned)} (expected 1 row "Padded Role")`);
  }

} catch (e) {
  fail(`comeet provider tests crashed: ${e.message}`);
}

