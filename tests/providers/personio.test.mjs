// tests/providers/personio.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — personio');


try {
  const personioModule = await import(pathToFileURL(join(ROOT, 'providers/personio.mjs')).href);
  const personio = personioModule.default;
  const { parsePersonioXml } = personioModule;

  if (personio.id === 'personio') pass('personio.id is "personio"');
  else fail(`personio.id is ${JSON.stringify(personio.id)}`);

  // detect: <slug>.jobs.personio.de careers host → /xml feed
  const hit = personio.detect({ name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' });
  if (hit && hit.url === 'https://acme.jobs.personio.de/xml') {
    pass('personio.detect() resolves <slug>.jobs.personio.de → /xml feed');
  } else {
    fail(`personio.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: the .com TLD variant is also accepted
  const comHit = personio.detect({ name: 'Acme', careers_url: 'https://acme.jobs.personio.com/jobs' });
  if (comHit && comHit.url === 'https://acme.jobs.personio.com/xml') {
    pass('personio.detect() accepts the .com TLD variant');
  } else {
    fail(`personio.detect() .com → ${JSON.stringify(comHit)}`);
  }

  if (personio.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('personio.detect() returns null for non-personio URLs');
  } else {
    fail('personio.detect() should return null for non-personio URLs');
  }

  if (personio.detect({ name: 'X', careers_url: null }) === null && personio.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('personio.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('personio.detect() should treat non-string careers_url as missing');
  }

  // SSRF: jobs.personio.de in the PATH (not host) must not be detected.
  if (personio.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.jobs.personio.de/xml' }) === null) {
    pass('personio.detect() rejects path-spoofed URLs');
  } else {
    fail('personio.detect() must NOT misdetect path-spoofed URLs');
  }

  // SSRF: a look-alike host (suffix attack) must be rejected.
  if (personio.detect({ name: 'Spoof', careers_url: 'https://acme.jobs.personio.de.evil.com/xml' }) === null) {
    pass('personio.detect() rejects suffix-spoofed look-alike hosts');
  } else {
    fail('personio.detect() must reject suffix-spoofed hosts');
  }

  // parsePersonioXml — the real <workzag-jobs> shape (confirmed live)
  const HOST = 'acme.jobs.personio.de';
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
  <id>1834171</id>
  <office>Munich</office>
  <additionalOffices><office>Berlin</office></additionalOffices>
  <name>Staff Software Engineer, Data &amp; Platform</name>
  <createdAt>2024-11-13T14:10:41+00:00</createdAt>
</position>
<position>
  <id>900100</id>
  <office>Remote</office>
  <name><![CDATA[Senior Engineer (m/f/d)]]></name>
  <createdAt>2025-01-02T09:00:00+00:00</createdAt>
</position>
<position>
  <id>777</id>
  <office>Cologne</office>
  <name></name>
</position>
<position>
  <id>not-a-number</id>
  <office>Hamburg</office>
  <name>Bad ID Role</name>
</position>
</workzag-jobs>`;
  const jobs = parsePersonioXml(sample, 'Acme', HOST);

  if (jobs.length === 2) pass('parsePersonioXml keeps 2 positions (drops empty name + non-numeric id)');
  else fail(`parsePersonioXml returned ${jobs.length} positions (expected 2)`);

  if (jobs[0]?.title === 'Staff Software Engineer, Data & Platform' && jobs[0]?.company === 'Acme') {
    pass('parsePersonioXml decodes &amp; in the title');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://acme.jobs.personio.de/job/1834171') {
    pass('parsePersonioXml builds the job URL from host + numeric id');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Munich, Berlin') {
    pass('parsePersonioXml joins primary + additionalOffices');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}, expected "Munich, Berlin"`);
  }

  if (jobs[0]?.postedAt === Date.parse('2024-11-13T14:10:41+00:00')) {
    pass('parsePersonioXml parses createdAt → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.title === 'Senior Engineer (m/f/d)') {
    pass('parsePersonioXml unwraps a CDATA name');
  } else {
    fail(`row 1 title = ${JSON.stringify(jobs[1]?.title)}`);
  }

  if (parsePersonioXml('', 'X', HOST).length === 0 && parsePersonioXml(null, 'X', HOST).length === 0) {
    pass('empty / non-string feed → empty result (no crash)');
  } else {
    fail('empty / non-string feed should yield empty result');
  }

  // Hardening: <jobDescriptions> carries per-section <name>/<value> pairs whose
  // nested <name> must NOT be mistaken for the position's own title; numeric
  // entities decode; an office wrapped in CDATA unwraps.
  const tricky = `<workzag-jobs><position>
    <id>42</id>
    <office><![CDATA[München]]></office>
    <name>Real Title &#38; More</name>
    <jobDescriptions>
      <jobDescription><name>Your tasks</name><value>do things</value></jobDescription>
    </jobDescriptions>
    <createdAt>2025-03-04T00:00:00+00:00</createdAt>
  </position></workzag-jobs>`;
  const tj = parsePersonioXml(tricky, 'Acme', HOST);
  if (tj.length === 1 && tj[0].title === 'Real Title & More') {
    pass('parsePersonioXml ignores nested <jobDescriptions><name> + decodes numeric entity');
  } else {
    fail(`tricky title = ${JSON.stringify(tj[0]?.title)} (len ${tj.length})`);
  }
  if (tj[0]?.location === 'München') {
    pass('parsePersonioXml unwraps a CDATA <office>');
  } else {
    fail(`tricky location = ${JSON.stringify(tj[0]?.location)}`);
  }

  // Hardening: a <jobDescriptions> value carrying a literal "</position>" must
  // not truncate the block split. Stripping descriptions from the whole feed
  // first keeps both positions intact.
  const sneaky = `<workzag-jobs><position>
    <id>1</id><name>First</name>
    <jobDescriptions><jobDescription><name>About</name><value>uses &lt;/position&gt; literally: </position></value></jobDescription></jobDescriptions>
  </position><position>
    <id>2</id><name>Second</name>
  </position></workzag-jobs>`;
  const sj2 = parsePersonioXml(sneaky, 'Acme', HOST);
  if (sj2.length === 2 && sj2[0].title === 'First' && sj2[1].title === 'Second') {
    pass('parsePersonioXml survives a literal </position> inside <jobDescriptions>');
  } else {
    fail(`sneaky parse = ${JSON.stringify(sj2.map(j => j.title))} (len ${sj2.length})`);
  }

  // fetch() passes redirect:'error' to fetchText (SSRF hardening must not regress)
  let capturedOpts = null;
  await personio.fetch(
    { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
    { fetchText: async (_url, opts) => { capturedOpts = opts; return '<workzag-jobs></workzag-jobs>'; } },
  );
  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('personio.fetch() passes redirect:"error" to fetchText');
  } else {
    fail(`personio.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  // fetch() throws when no feed URL can be derived (non-personio careers_url).
  try {
    await personio.fetch(
      { name: 'NoFeed', careers_url: 'https://example.com/careers' },
      { fetchText: async () => { throw new Error('must not be called'); } },
    );
    fail('personio.fetch() should throw when the feed URL cannot be derived');
  } catch (e) {
    if (/cannot derive feed URL for NoFeed/.test(e.message)) {
      pass('personio.fetch() throws "cannot derive feed URL" for underivable entries');
    } else {
      fail(`personio.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`personio provider tests crashed: ${e.message}`);
}

