// tests/providers/hecklerkoch.test.mjs — SSR Stellenangebote parser.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hecklerkoch (SSR Stellenangebote parser)');
try {
  const hkModule = await import(pathToFileURL(join(ROOT, 'providers/hecklerkoch.mjs')).href);
  const hk = hkModule.default;
  const { resolveListUrl: hkListUrl, parseListing } = hkModule;

  if (hk.id === 'hecklerkoch') pass('hecklerkoch.id is "hecklerkoch"');
  else fail(`hecklerkoch.id is ${JSON.stringify(hk.id)}`);

  if (hkListUrl({ careers_url: 'https://www.heckler-koch.com/en/Career' }) === 'https://www.heckler-koch.com/de/Karriere/Stellenangebote') pass('hecklerkoch.resolveListUrl() defaults to the Stellenangebote list');
  else fail(`hecklerkoch.resolveListUrl() default wrong: ${hkListUrl({ careers_url: 'https://www.heckler-koch.com/en/Career' })}`);
  if (hk.detect({ careers_url: 'https://evil.com/x.heckler-koch.com' }) === null && hk.detect({ careers_url: 'https://heckler-koch.com.evil.com/x' }) === null) {
    pass('hecklerkoch.detect() rejects spoofed hosts');
  } else {
    fail('hecklerkoch.detect() should reject spoofed hosts');
  }

  // parseListing — anchor on the jobposting/{hash} link, read the <h3> title.
  const hkCard = (hash, title) =>
    `<a to="[object Object]" href="https://karriere.heckler-koch.com/jobposting/${hash}" target="_blank" rel="noreferrer" class="group flex"><div class="text-secondary font-medium"><p> Produktion | Direkteinstieg </p><h3 class="text-lg md:text-2xl">${title}</h3></div><i class="pl-4 icon-chevron"></i></a>`;
  const hkHtml = '<html>' + hkCard('d1be4446a082dd289578456f38fb82473beedb350', 'Maschineneinrichter (m/w/d) - Fr&#228;sen') + hkCard('ba2bf2265bc08d4d5df5993b33a0f4d05e4bd7ed0', 'Werkstudent Arbeitssicherheit (m/w/d)') + '</html>';
  const hkRows = parseListing(hkHtml);
  if (hkRows.length === 2) pass('hecklerkoch.parseListing() yields one row per jobposting link');
  else fail(`hecklerkoch.parseListing() returned ${hkRows.length}, expected 2`);
  if (hkRows[0]?.title === 'Maschineneinrichter (m/w/d) - Fräsen' && hkRows[0]?.url === 'https://karriere.heckler-koch.com/jobposting/d1be4446a082dd289578456f38fb82473beedb350') {
    pass('hecklerkoch.parseListing() decodes the title and keeps the jobposting URL/id');
  } else {
    fail(`hecklerkoch.parseListing() row wrong: ${JSON.stringify(hkRows[0])}`);
  }
  if (parseListing('<html>no jobs</html>').length === 0 && parseListing(undefined).length === 0) pass('hecklerkoch.parseListing() returns [] for job-less / non-string input');
  else fail('hecklerkoch.parseListing() should return [] without jobs');

  // decodeEntities (exercised via parseListing) — a malformed/out-of-range
  // numeric entity (a lone surrogate half) must degrade to the literal text,
  // never throw RangeError and abort the whole parse.
  const badCard = hkCard('badhash0000000000000000000000000000000000', 'Bad&#xD800;Entity');
  const badRows = parseListing('<html>' + badCard + '</html>');
  if (badRows.length === 1 && badRows[0].title === 'Bad&#xD800;Entity') pass('hecklerkoch.parseListing() tolerates an invalid numeric entity (no RangeError crash)');
  else fail(`hecklerkoch.parseListing() should degrade a malformed entity to literal text, got: ${JSON.stringify(badRows)}`);

  // fetch — single request, jobs normalized (location empty by design).
  const hkJobs = await hk.fetch({ name: 'Heckler & Koch', api: 'https://www.heckler-koch.com/de/Karriere/Stellenangebote' }, { fetchText: async () => hkHtml });
  if (hkJobs.length === 2 && hkJobs[0].company === 'Heckler & Koch' && hkJobs[0].location === '') pass('hecklerkoch.fetch() returns normalized jobs from one request');
  else fail(`hecklerkoch.fetch() wrong: ${JSON.stringify(hkJobs)}`);
} catch (e) {
  fail(`hecklerkoch provider tests crashed: ${e.message}`);
}
