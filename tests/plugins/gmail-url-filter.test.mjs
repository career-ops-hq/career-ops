// tests/plugins/gmail-url-filter.test.mjs — isCleanUrl() in the gmail plugin
// matches tracker words as a whole hostname word or a whole path segment, never
// as a substring of the URL. A substring match dropped real postings whose
// company slug, job slug or query string happened to contain "click", "track"
// or "newsletter".
import { pass, fail } from '../helpers.mjs';
import { isCleanUrl } from '../../plugins/gmail/_helpers.mjs';

console.log('\ngmail — isCleanUrl() matches tracker words as whole words, not substrings');
try {
  // Each of these is a posting a substring match on the whole URL dropped: the
  // tracker word sits inside a company slug, a job slug, or a query param.
  for (const url of [
    'https://boards.greenhouse.io/clickhouse/jobs/123',
    'https://jobs.lever.co/clickup/xyz',
    'https://jobs.ashbyhq.com/trackman/abc',
    'https://jobs.lever.co/acme/fast-track-engineer',
    'https://boards.greenhouse.io/acme/jobs/4012345?gh_src=newsletter',
    'https://clickup.wd5.myworkdayjobs.com/en-US/careers/job/123',
    'https://jobs.lever.co/acme/123?utm_medium=click&utm_source=subscribe',
    'https://jobs.lever.co/acme/openpixel-engineer',
  ]) {
    if (isCleanUrl(url)) pass(`keeps a posting: ${url}`);
    else fail(`dropped a real posting: ${url}`);
  }
  for (const url of [
    'https://click.mail.example.com/abc',
    'https://email-tracking.example.com/o/abc',
    'https://u123.ct.sendgrid.net/ls/click?upn=abc',
    'https://example.us1.list-manage.com/track/click?u=1&id=2',
    'https://example.com/track/open?id=1',
    'https://example.com/unsubscribe?token=abc',
    'https://example.com/email/unsubscribe.php?u=1',
    'https://example.com/newsletter',
    'https://example.com/opt-out',
    'https://example.com/openpixel?recipient=abc',
    'https://example.com/%55nsubscribe?token=abc',
    'https://ad.doubleclick.net/ddm/trackclk/abc',
    'https://www.linkedin.com/help/linkedin/answer/123',
    'https://github.com/login?return_to=x',
  ]) {
    if (!isCleanUrl(url)) pass(`still drops: ${url}`);
    else fail(`tracker or non-posting URL kept: ${url}`);
  }
} catch (err) {
  fail(`isCleanUrl tests crashed: ${err && err.message}`);
}
