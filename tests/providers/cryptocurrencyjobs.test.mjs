// tests/providers/cryptocurrencyjobs.test.mjs — provider-contract tests for the
// CryptocurrencyJobs Web3 board RSS provider (providers/cryptocurrencyjobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — cryptocurrencyjobs');

try {
  const ccj = (await import(pathToFileURL(join(ROOT, 'providers/cryptocurrencyjobs.mjs')).href)).default;
  const { parseCryptocurrencyJobsRss, splitTitle } = await import(pathToFileURL(join(ROOT, 'providers/cryptocurrencyjobs.mjs')).href);

  if (ccj.id === 'cryptocurrencyjobs') pass('cryptocurrencyjobs.id is "cryptocurrencyjobs"');
  else fail(`cryptocurrencyjobs.id is ${JSON.stringify(ccj.id)}`);

  if (splitTitle('Senior Backend Engineer at Acme Protocol').company === 'Acme Protocol' &&
      splitTitle('Role with no separator').company === '') {
    pass('splitTitle splits on the last " at " and handles the no-separator case');
  } else {
    fail(`splitTitle wrong: ${JSON.stringify(splitTitle('Senior Backend Engineer at Acme Protocol'))}`);
  }

  const sampleXml = [
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>',
    '<title>Cryptocurrency Jobs</title>',
    '<item><title><![CDATA[Senior Backend Engineer at Acme Protocol]]></title>',
    '<link>https://cryptocurrencyjobs.co/engineering/acme-senior-backend/</link>',
    '<description><![CDATA[We are hiring a backend engineer. 100% remote.]]></description>',
    '<pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate></item>',
    '<item><title>Solidity Engineer at Beta Labs</title>',
    '<guid>https://cryptocurrencyjobs.co/engineering/beta-solidity/</guid></item>',
    '<item><title>Item with no link</title></item>',
    '</channel></rss>',
  ].join('');

  const jobs = parseCryptocurrencyJobsRss(sampleXml);
  if (jobs.length === 2) pass('parseCryptocurrencyJobsRss extracts 2 jobs (skips the link-less item)');
  else fail(`parseCryptocurrencyJobsRss returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Senior Backend Engineer' && jobs[0]?.company === 'Acme Protocol' &&
      jobs[0]?.url === 'https://cryptocurrencyjobs.co/engineering/acme-senior-backend/') {
    pass('parseCryptocurrencyJobsRss splits "Role at Company" and reads link');
  } else {
    fail(`parseCryptocurrencyJobsRss row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (typeof jobs[0]?.postedAt === 'number' && Number.isFinite(jobs[0].postedAt)) {
    pass('parseCryptocurrencyJobsRss parses pubDate into a numeric postedAt');
  } else {
    fail(`parseCryptocurrencyJobsRss postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.url === 'https://cryptocurrencyjobs.co/engineering/beta-solidity/') {
    pass('parseCryptocurrencyJobsRss falls back to <guid> when <link> is absent');
  } else {
    fail(`parseCryptocurrencyJobsRss guid fallback failed: ${JSON.stringify(jobs[1])}`);
  }

  if (jobs[0]?.description === 'We are hiring a backend engineer. 100% remote.' && !('description' in (jobs[1] || {}))) {
    pass('parseCryptocurrencyJobsRss populates description when present and omits it when absent');
  } else {
    fail(`parseCryptocurrencyJobsRss description handling = ${JSON.stringify(jobs[0]?.description)}`);
  }

  if (parseCryptocurrencyJobsRss('').length === 0 && parseCryptocurrencyJobsRss(null).length === 0) {
    pass('parseCryptocurrencyJobsRss returns [] for empty/null input (no crash)');
  } else {
    fail('parseCryptocurrencyJobsRss should yield [] for empty/null input');
  }

  // fetch() reaches fetchText (passing redirect:'error') and returns parsed jobs
  let capturedOpts = null;
  const fetched = await ccj.fetch(
    { name: 'CryptocurrencyJobs', provider: 'cryptocurrencyjobs' },
    { transport: 'http', fetchText: async (_url, opts) => { capturedOpts = opts; return sampleXml; }, fetchJson: async () => { throw new Error('fetchJson should not be called'); } },
  );
  if (fetched.length === 2) pass('cryptocurrencyjobs.fetch() returns parsed jobs from fetchText');
  else fail(`cryptocurrencyjobs.fetch() returned ${fetched.length} jobs`);
  if (capturedOpts && capturedOpts.redirect === 'error') pass('cryptocurrencyjobs.fetch() passes redirect:"error" (SSRF hardening)');
  else fail(`cryptocurrencyjobs.fetch() should pass redirect:"error", got ${JSON.stringify(capturedOpts)}`);

  // A failed feed fetch must THROW, not return []: scan.mjs catches per-target
  // throws and records a failure, while [] reads as "live but empty" — so a
  // dead board never trips portal-health escalation (meituan/tencent contract).
  let threw = null;
  try {
    await ccj.fetch(
      { name: 'CryptocurrencyJobs', provider: 'cryptocurrencyjobs' },
      { transport: 'http', fetchText: async () => { throw new Error('network down'); }, fetchJson: async () => ({}) },
    );
  } catch (err) {
    threw = err;
  }
  if (threw?.message === 'network down') pass('cryptocurrencyjobs.fetch() throws when the feed fetch fails (dead board ≠ empty board)');
  else fail('cryptocurrencyjobs.fetch() swallowed a feed-fetch failure into []');
} catch (e) {
  fail(`cryptocurrencyjobs provider tests crashed: ${e.message}`);
}

