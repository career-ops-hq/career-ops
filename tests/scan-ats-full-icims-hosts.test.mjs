// tests/scan-ats-full-icims-hosts.test.mjs — how iCIMS dataset entries become
// board hosts. The public dataset stores some tenants bare ("acmefreight") and
// some as a full portal subdomain ("careers-acmefreight"); prefixing both with
// "careers-" produced careers-careers-* hosts that do not exist.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — iCIMS host candidates');

const { SOURCES, icimsHostCandidates } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const url = (host) => `https://${host}/jobs/search?ss=1&in_iframe=1`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A bare tenant keeps the canonical careers- host first, with the bare host as fallback.
{
  const e = SOURCES.icims.toEntry('acmefreight');
  if (e?.careers_url === url('careers-acmefreight.icims.com') && same(e.fallback_urls, [url('acmefreight.icims.com')])) {
    pass('bare tenant: careers- host first, bare host as fallback');
  } else {
    fail(`bare tenant: ${JSON.stringify(e)}`);
  }
}

// An entry that is already a careers- subdomain is used as-is and never doubled.
{
  const e = SOURCES.icims.toEntry('careers-acmefreight');
  if (e?.careers_url === url('careers-acmefreight.icims.com') && e.fallback_urls === undefined) {
    pass('careers- entry used as-is, no careers-careers- host');
  } else {
    fail(`careers- entry: ${JSON.stringify(e)}`);
  }
}

// Other portal subdomains that contain "careers" are tried as-is first.
{
  const e = SOURCES.icims.toEntry('uscareers-acme');
  if (e?.careers_url === url('uscareers-acme.icims.com') && same(e.fallback_urls, [url('careers-uscareers-acme.icims.com')])) {
    pass('portal subdomain containing "careers" tried as-is first');
  } else {
    fail(`uscareers- entry: ${JSON.stringify(e)}`);
  }
}

// A hyphenated entry without "careers" could be either shape; the prefixed host stays first.
{
  const e = SOURCES.icims.toEntry('jobs-acme');
  if (e?.careers_url === url('careers-jobs-acme.icims.com') && same(e.fallback_urls, [url('jobs-acme.icims.com')])) {
    pass('hyphenated entry without "careers": prefixed host first, as-is fallback');
  } else {
    fail(`jobs- entry: ${JSON.stringify(e)}`);
  }
}

// Normalization: the dataset carries one entry with a stray leading dash.
{
  if (same(icimsHostCandidates('-careers-acme'), ['careers-acme.icims.com'])) pass('leading dash stripped before building the host');
  else fail(`leading dash: ${JSON.stringify(icimsHostCandidates('-careers-acme'))}`);

  if (same(icimsHostCandidates('AcmeFreight'), ['careers-acmefreight.icims.com', 'acmefreight.icims.com'])) pass('host lowercased');
  else fail(`uppercase: ${JSON.stringify(icimsHostCandidates('AcmeFreight'))}`);

  if (same(icimsHostCandidates(''), [])) pass('empty entry yields no host');
  else fail(`empty: ${JSON.stringify(icimsHostCandidates(''))}`);
}

// Every candidate stays on icims.com, and hostile input is still rejected.
{
  const hosts = ['acme', 'careers-acme', 'jobs-acme', 'acmecareers-west', 'a.b'].flatMap(icimsHostCandidates);
  if (hosts.length > 0 && hosts.every((h) => h.endsWith('.icims.com'))) pass('all candidate hosts stay on icims.com');
  else fail(`off-host candidate: ${JSON.stringify(hosts)}`);

  if (SOURCES.icims.toEntry('evil/..%2f') === null) pass('toEntry still rejects non-slug input');
  else fail('toEntry accepted a hostile slug');
}
