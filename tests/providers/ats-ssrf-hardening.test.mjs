// tests/providers/ats-ssrf-hardening.test.mjs — moved verbatim from test-all.mjs (#1440).
// _http.mjs defaults to redirect:'follow', so a server-side redirect from any
// of these ATS APIs to an internal address is an SSRF vector. Every other GET
// provider passes redirect:'error'; these two were missing it.
// (workday's redirect:'error' coverage lives in its own "Provider — workday"
// section, checked across every paginated request, not just the first.)
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — SSRF redirect hardening (lever / ashby)');

try {
  const lever = (await import(pathToFileURL(join(ROOT, 'providers/lever.mjs')).href)).default;
  const ashby = (await import(pathToFileURL(join(ROOT, 'providers/ashby.mjs')).href)).default;

  // Each instance must hit its own host with redirect:'error' — a wrong host
  // silently returns another tenant's (or no) postings instead of erroring.
  let leverUrl = null, leverOpts = null;
  await lever.fetch(
    { name: 'L', careers_url: 'https://jobs.lever.co/example' },
    { transport: 'http', fetchJson: async (u, opts) => { leverUrl = u; leverOpts = opts; return []; }, fetchText: async () => '' },
  );
  if (leverUrl === 'https://api.lever.co/v0/postings/example' && leverOpts?.redirect === 'error') {
    pass('lever.fetch() hits api.lever.co and passes redirect:"error"');
  } else {
    fail(`lever.fetch() default instance: url=${leverUrl}, opts=${JSON.stringify(leverOpts)}`);
  }

  let leverEuUrl = null, leverEuOpts = null;
  await lever.fetch(
    { name: 'L EU', careers_url: 'https://jobs.eu.lever.co/example-eu' },
    { transport: 'http', fetchJson: async (u, opts) => { leverEuUrl = u; leverEuOpts = opts; return []; }, fetchText: async () => '' },
  );
  if (leverEuUrl === 'https://api.eu.lever.co/v0/postings/example-eu' && leverEuOpts?.redirect === 'error') {
    pass('lever.fetch() hits api.eu.lever.co and passes redirect:"error"');
  } else {
    fail(`lever.fetch() EU instance: url=${leverEuUrl}, opts=${JSON.stringify(leverEuOpts)}`);
  }

  let ashbyOpts = null;
  await ashby.fetch(
    { name: 'A', careers_url: 'https://jobs.ashbyhq.com/example' },
    { transport: 'http', fetchJson: async (_u, opts) => { ashbyOpts = opts; return { jobs: [] }; }, fetchText: async () => '' },
  );
  if (ashbyOpts && ashbyOpts.redirect === 'error') pass('ashby.fetch() passes redirect:"error"');
  else fail(`ashby.fetch() should pass redirect:"error", got ${JSON.stringify(ashbyOpts)}`);
} catch (e) {
  fail(`SSRF redirect hardening tests crashed: ${e.message}`);
}

