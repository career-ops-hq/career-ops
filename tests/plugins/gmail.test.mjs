// tests/plugins/gmail.test.mjs — two fixes to the bundled gmail plugin's
// helpers: the DMARC gate reads only Gmail's own verdict, and a part declaring
// quoted-printable is decoded before the URL sweep reads it.
//
// The DMARC hole: RFC 8601 §5 only obliges a receiver to strip
// Authentication-Results headers claiming its OWN authserv-id, so a header the
// sender wrote under any other id — `evil.test; dmarc=pass` — is delivered
// untouched. `isAuthenticEmail` accepted any of them, which let the sender pass
// the anti-spoof gate whenever Gmail itself reported no pass.
//
// The decoding bug: Indeed's plain part arrives with its transfer encoding
// intact. Read raw, the sweep turned `jk=3Dc3626a…` into a plausible-looking
// posting URL for an id that does not exist, and cut every long URL at its fold.
//
// The fixture under tests/fixtures/ is a real Indeed alert (Traditional Chinese,
// which is why the multi-byte path is covered) with every account-identifying
// token replaced. Nothing here reads a live mailbox.
import { pass, fail, ROOT } from '../helpers.mjs';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getMessageBody, extractUrls, isCleanUrl, isAuthenticEmail, decodeQuotedPrintable,
} from '../../plugins/gmail/_helpers.mjs';

const INDEED_FIXTURE = readFileSync(join(ROOT, 'tests', 'fixtures', 'indeed-job-alert.txt'), 'utf-8');
const INDEED_JK = 'c3626a655de4a873';
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const plainPayload = (text) => ({ mimeType: 'text/plain', body: { data: b64(text) } });
// A quoted-printable part as Gmail actually delivers it: its own headers alongside
// its body. Decoding depends on that declaration; nothing sniffs the content.
const qpPayload = (text) => ({
  mimeType: 'text/plain',
  headers: [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }],
  body: { data: b64(text) },
});
const AR = (value) => ({ name: 'Authentication-Results', value });
/** Hostname of a URL, or '' — compared whole, never as a substring of the URL. */
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const jkOf = (url) => { try { return new URL(url).searchParams.get('jk'); } catch { return null; } };

console.log('\ngmail — isAuthenticEmail() reads only Gmail\'s own Authentication-Results');
try {
  const injected = AR('evil.test; dmarc=pass header.from=linkedin.com');
  for (const [headers, label] of [
    [[AR('mx.google.com; dmarc=fail header.from=example.test'), injected], 'Gmail said fail and the sender wrote their own pass'],
    [[AR('mx.google.com; spf=pass'), injected], 'Gmail published no dmarc verdict and the sender supplied one'],
    [[injected, AR('mx.google.com; dmarc=fail header.from=example.test')], "the injected header sits above Gmail's"],
    [[injected], "the only Authentication-Results present is the sender's"],
  ]) {
    if (!isAuthenticEmail(headers)) pass(`ignores a foreign authserv-id: ${label}`);
    else fail(`accepted an injected Authentication-Results: ${label}`);
  }

  // The verdict is read as a whole clause, not by finding `dmarc=pass` anywhere
  // in the header: each of these is a real shape that a substring search misreads.
  for (const [value, label] of [
    ['mx.google.com; dmarc=fail reason="not dmarc=pass" header.from=linkedin.com', 'a failure whose reason text quotes the word pass'],
    ['mx.google.com; dmarc=fail (dmarc=pass) header.from=linkedin.com', 'a pass hiding inside a comment'],
    // A quoted string may hold `;`, so a clause boundary inside one is not real.
    ['mx.google.com; dmarc=fail reason="a; dmarc=pass header.from=linkedin.com"', 'a semicolon inside the reason text'],
    // ...and the quoted part can be the sender's own MAIL FROM, which they choose.
    ['mx.google.com; spf=fail (google.com: bad) smtp.mailfrom="a; dmarc=pass header.from=linkedin.com"@x.test; dmarc=fail (p=NONE) header.from=x.test', 'a forged clause inside a quoted local-part'],
  ]) {
    if (!isAuthenticEmail([AR(value)])) pass(`reads the clause, not the substring: ${label}`);
    else fail(`misread: ${label}`);
  }

  // The shapes Gmail actually delivers must keep passing.
  const real = 'mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass (google.com: domain of x designates 1.2.3.4 as permitted sender) smtp.mailfrom="a@b.test"; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=linkedin.com';
  if (isAuthenticEmail([{ name: 'From', value: 'x' }, AR(real)])) pass('a real multi-clause Gmail header passes');
  else fail('real Gmail header shape was rejected');
  if (isAuthenticEmail([AR('mx.google.com 1; dmarc=pass header.from=linkedin.com')])) pass('an authserv-id carrying an RFC 8601 version passes');
  else fail('authres-version form was rejected');
  if (isAuthenticEmail([{ name: 'authentication-results', value: 'mx.google.com; dmarc=pass header.from=linkedin.com' }])) pass('the header name is matched case-insensitively');
  else fail('lowercase header name was rejected');
  // ...and the sender's own header cannot veto Gmail's pass either.
  if (isAuthenticEmail([AR('evil.test; dmarc=fail'), AR(real)])) pass("a foreign header above Gmail's pass does not mask it");
  else fail("a foreign header masked Gmail's own pass");

  for (const [headers, label] of [
    [[{ name: 'From', value: 'LinkedIn <jobs@linkedin.com>' }], 'no Authentication-Results at all'],
    [[AR('mx.google.com; dmarc=none header.from=example.test')], 'a domain with no DMARC record'],
    [[], 'an empty header list'],
    [null, 'null headers'],
  ]) {
    if (!isAuthenticEmail(headers)) pass(`fails closed for ${label}`);
    else fail(`accepted ${label}`);
  }
} catch (err) {
  fail(`isAuthenticEmail tests crashed: ${err && err.message}`);
}

console.log('\ngmail — decodeQuotedPrintable()');
try {
  if (decodeQuotedPrintable('=E5=8F=B0=E5=8C=97') === '台北') pass('decodes an escaped multi-byte character byte-wise');
  else fail(`escaped CJK → ${JSON.stringify(decodeQuotedPrintable('=E5=8F=B0=E5=8C=97'))}`);
  if (decodeQuotedPrintable('a=\nb') === 'ab' && decodeQuotedPrintable('a=\r\nb') === 'ab') pass('joins a soft line break, LF or CRLF');
  else fail(`soft break → ${JSON.stringify([decodeQuotedPrintable('a=\nb'), decodeQuotedPrintable('a=\r\nb')])}`);
  if (decodeQuotedPrintable('jk=3Dc3626a') === 'jk=c3626a') pass('turns `=3D` back into `=`');
  else fail(`=3D → ${JSON.stringify(decodeQuotedPrintable('jk=3Dc3626a'))}`);
  if (decodeQuotedPrintable('a =ZZ b') === 'a =ZZ b') pass('leaves an `=` that is not an escape alone');
  else fail(`=ZZ → ${JSON.stringify(decodeQuotedPrintable('a =ZZ b'))}`);
  // The encoding is supposed to escape every non-ASCII byte, and senders emit raw
  // UTF-8 in these parts anyway. Decoding must walk code points: an astral
  // character is two UTF-16 halves, and each half alone encodes to U+FFFD.
  for (const [raw, label] of [
    ['Senior PM \u{1F680} role', 'an emoji left unescaped'],
    ['台北 \u{1F4CD} Hybrid', 'an astral character beside BMP CJK'],
  ]) {
    if (decodeQuotedPrintable(raw) === raw) pass(`passes through ${label}`);
    else fail(`${label} → ${JSON.stringify(decodeQuotedPrintable(raw))}`);
  }
} catch (err) {
  fail(`decodeQuotedPrintable tests crashed: ${err && err.message}`);
}

console.log('\ngmail — getMessageBody() decodes only what declares quoted-printable');
try {
  if (getMessageBody(qpPayload('a=3Db=\nc')) === 'a=bc') pass('a part declaring quoted-printable is decoded');
  else fail(`declared quoted-printable not decoded: ${JSON.stringify(getMessageBody(qpPayload('a=3Db=\nc')))}`);

  // RFC 2045 makes 7bit the default and many senders omit the header, so
  // sniffing the content for a trailing-`=` fold would corrupt ordinary mail —
  // a URL wrapping after `?gh_src=` would lose the fold and `=ab` would be read
  // as a byte. Decoding is driven by the declaration alone.
  const raw = 'see https://boards.greenhouse.io/acme/jobs/4012345?gh_src=\nlinkedin and =ab literal';
  if (getMessageBody(plainPayload(raw)) === raw) pass('a part declaring no encoding is passed through byte-identical');
  else fail(`undeclared 7bit part was decoded: ${JSON.stringify(getMessageBody(plainPayload(raw)))}`);

  const nested = {
    mimeType: 'multipart/alternative',
    parts: [plainPayload('plain '), { mimeType: 'multipart/related', parts: [qpPayload('=E5=8F=B0=E5=8C=97')] }],
  };
  if (getMessageBody(nested) === 'plain 台北') pass('each nested part is decoded by its own declaration');
  else fail(`nested → ${JSON.stringify(getMessageBody(nested))}`);

  // Gmail returns base64url, not base64: `-` and `_` stand in for `+` and `/`.
  const tricky = 'Ünïcode ✓ / plus + slash';
  if (getMessageBody(plainPayload(tricky)) === tricky) pass('still decodes base64url payloads');
  else fail(`base64url round-trip returned ${JSON.stringify(getMessageBody(plainPayload(tricky)))}`);
  if (getMessageBody(null) === '' && getMessageBody({ mimeType: 'text/plain', body: {} }) === '') pass("returns '' for a missing payload or an empty part");
  else fail('empty input did not return \'\'');
} catch (err) {
  fail(`getMessageBody tests crashed: ${err && err.message}`);
}

console.log('\ngmail — the URL sweep over a real quoted-printable Indeed alert');
try {
  const body = getMessageBody(qpPayload(INDEED_FIXTURE));
  const swept = extractUrls(body).filter(isCleanUrl);

  if (swept.some(u => hostOf(u) === 'tw.indeed.com' && jkOf(u) === INDEED_JK)) pass('the posting URL arrives whole, its `jk` intact');
  else fail(`no intact posting URL in ${JSON.stringify(swept)}`);
  // The bug this pins: read raw, the escaped `=` was swallowed into the id. The
  // result looks like a valid posting URL, which is what makes it worse than an
  // obviously broken one.
  if (!swept.some(u => /jk=3d/i.test(u))) pass('no `jk=3D…` ghost posting survives the sweep');
  else fail(`ghost posting in sweep: ${swept.find(u => /jk=3d/i.test(u))}`);
  if (!swept.some(u => u.endsWith('='))) pass('no URL is cut at a soft line break');
  else fail(`URL cut at a fold: ${swept.find(u => u.endsWith('='))}`);
  // The alert-management link carries the recipient's own token and is only
  // reachable now that the body is decoded; it must not become a lead.
  if (!swept.some(u => hostOf(u) === 'subscriptions.indeed.com')) pass("the recipient's own alert-management URL is not swept up as a lead");
  else fail(`alert-management URL leaked into the sweep: ${swept.find(u => hostOf(u) === 'subscriptions.indeed.com')}`);
  if (body.includes('漸強實驗室 Crescendo Lab Ltd. - 台北市')) pass('the CJK company line decodes to readable text');
  else fail('the CJK company line did not decode');
} catch (err) {
  fail(`fixture sweep tests crashed: ${err && err.message}`);
}

console.log('\ngmail — ingest() end to end, with its state isolated');
try {
  const gmail = (await import(pathToFileURL(join(ROOT, 'plugins/gmail/index.mjs')).href)).default;
  const message = (id, authResults, part) => ({
    id,
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Subject', value: 'Job alert' },
        { name: 'From', value: 'Indeed <donotreply@jobalert.indeed.com>' },
        ...authResults.map(AR),
      ],
      parts: [part],
    },
  });
  const messages = {
    'alert-indeed': message('alert-indeed',
      ['mx.google.com; dmarc=pass (p=REJECT) header.from=jobalert.indeed.com'], qpPayload(INDEED_FIXTURE)),
    // Gmail's own verdict is a fail; the sender appended a pass of their own.
    'spoofed': message('spoofed',
      ['mx.google.com; dmarc=fail (p=NONE) header.from=example.test', 'evil.test; dmarc=pass header.from=indeed.com'],
      plainPayload('Apply now: https://boards.greenhouse.io/evil/jobs/666')),
  };
  const ctx = {
    dryRun: true,
    env: { GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' },
    settings: {},
    log: () => {},
    fetch: async (url) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      if (url.includes('messages?')) return { ok: true, json: async () => ({ messages: Object.keys(messages).map(id => ({ id })) }) };
      const hit = Object.keys(messages).find(id => url.includes(`messages/${id}?`));
      if (hit) return { ok: true, json: async () => messages[hit] };
      return { ok: true, json: async () => ({}) };
    },
  };

  // The plugin reads its processed-id cursor from `data/gmail-state.json` under
  // ctx.dataRoot, and, when there is none, from the same path under the working
  // directory, where earlier versions kept it. `dryRun` stops the write but not
  // the read, so point both at an empty directory: otherwise a message id the
  // checkout's own cursor already lists would be skipped, and the result would
  // depend on whatever state the machine happens to carry.
  const cwd = process.cwd();
  const sandbox = mkdtempSync(join(tmpdir(), 'gmail-ingest-'));
  const origWarn = console.warn;
  let jobs;
  try {
    process.chdir(sandbox);
    console.warn = () => {}; // the spoofed message logs an expected skip
    jobs = await gmail.ingest({ ...ctx, dataRoot: sandbox });
  } finally {
    console.warn = origWarn;
    process.chdir(cwd);
    rmSync(sandbox, { recursive: true, force: true });
  }

  if (jobs.some(j => hostOf(j.url) === 'tw.indeed.com' && jkOf(j.url) === INDEED_JK)) pass('the Indeed posting reaches the pipeline with its `jk` intact');
  else fail(`leads = ${JSON.stringify(jobs.map(j => j.url))}`);
  if (!jobs.some(j => /jk=3d/i.test(j.url))) pass('no `jk=3D…` ghost posting reaches the pipeline');
  else fail(`ghost posting: ${jobs.find(j => /jk=3d/i.test(j.url)).url}`);
  if (!jobs.some(j => hostOf(j.url) === 'subscriptions.indeed.com')) pass("the recipient's alert-management URL never becomes a lead");
  else fail('alert-management URL reached the pipeline');
  if (!jobs.some(j => j.url.includes('greenhouse.io/evil'))) pass('a message whose only dmarc=pass is the sender\'s own is skipped');
  else fail('a spoofed message reached the pipeline');
} catch (err) {
  fail(`ingest end-to-end test crashed: ${err && err.message}`);
}
