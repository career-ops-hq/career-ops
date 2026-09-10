// tests/gmail-digest-parsers.test.mjs — the per-sender digest parsers behind
// gmail ingest, and the canonical-URL step that keeps a parsed lead from being
// re-added a second time by the generic URL sweep.
//
// The bug these guard: a LinkedIn job-alert digest states title, company and
// location for every posting in its own body, but the generic
// `extractUrls().filter(isCleanUrl)` path sees only links. Every posting in the
// digest therefore landed in the pipeline as `Job lead (email)` with an empty
// company — unrankable, undedupable against the same posting found by a scanner,
// and unreadable without opening it.
//
// Both directions are pinned, and they are not symmetric. A missed posting is a
// visible gap the generic path still catches as an untitled lead. A *wrongly*
// titled one is invisible: it reads as a real, complete lead and gets acted on.
// So every boundary below is pinned toward "skip it and let the URL path have
// it" rather than toward "guess". In particular a field the digest does not
// state stays '' — never inherited from the entry above it, which is the failure
// mode a naive upward walk produces on the one entry that omits its location.
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getPlainTextBody, getMessageBody, extractUrls, isCleanUrl, isAuthenticEmail,
  canonicalizeJobUrl, parseLinkedInDigest, parseIndeedAlert,
  parseDigestLeads, decodeQuotedPrintable,
} from '../plugins/gmail/_helpers.mjs';

const FIXTURE = readFileSync(join(ROOT, 'tests', 'fixtures', 'linkedin-job-alert.txt'), 'utf-8');
const INDEED_FIXTURE = readFileSync(join(ROOT, 'tests', 'fixtures', 'indeed-job-alert.txt'), 'utf-8');
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const plainPayload = (text) => ({ mimeType: 'text/plain', body: { data: b64(text) } });
// A quoted-printable part as Gmail actually delivers it: its own headers alongside
// its body. The parsers depend on that declaration; nothing sniffs the content.
const qpPayload = (text) => ({
  mimeType: 'text/plain',
  headers: [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }],
  body: { data: b64(text) },
});
// Dispatch reads the domain DMARC verified, not the From header.
const verified = (domain, from = 'Someone <someone@example.test>') => [
  { name: 'From', value: from },
  { name: 'Authentication-Results', value: `mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}` },
];
const linkedinHeaders = verified('linkedin.com', 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>');

console.log('\ngmail digest parsers — getPlainTextBody()');
try {
  const nested = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/html', body: { data: b64('<p>table soup</p>') } },
      { mimeType: 'multipart/related', parts: [plainPayload('the plain part')] },
    ],
  };
  if (getPlainTextBody(nested) === 'the plain part') pass('finds text/plain nested under another multipart');
  else fail(`nested lookup returned ${JSON.stringify(getPlainTextBody(nested))}`);

  // Gmail returns base64url, not base64: `-` and `_` stand in for `+` and `/`.
  // Decoding it as plain base64 mangles any body whose bytes hit those symbols.
  const tricky = 'Ünïcode ✓ / plus + slash';
  if (getPlainTextBody(plainPayload(tricky)) === tricky) pass('decodes base64url payloads, not just base64');
  else fail(`base64url round-trip returned ${JSON.stringify(getPlainTextBody(plainPayload(tricky)))}`);

  for (const [payload, label] of [
    [null, 'null payload'],
    [{ mimeType: 'text/html', body: { data: b64('<p>only html</p>') } }, 'an HTML-only message'],
    [{ mimeType: 'text/plain', body: {} }, 'a text/plain part with no data'],
  ]) {
    if (getPlainTextBody(payload) === '') pass(`returns '' for ${label} (caller falls back to the URL path)`);
    else fail(`${label} returned ${JSON.stringify(getPlainTextBody(payload))}`);
  }
} catch (err) {
  fail(`getPlainTextBody tests crashed: ${err && err.message}`);
}

/** Hostname of a URL, or '' — compared whole, never as a substring of the URL. */
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
/** String.prototype.isWellFormed is Node 20+; package.json still declares >=18. */
const wellFormed = (s) => (typeof s?.isWellFormed === 'function'
  ? s.isWellFormed()
  : !/[\uD800-\uDFFF]/.test(String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')));

console.log('\ngmail digest parsers — canonicalizeJobUrl()');
try {
  const ID = '4011223344';
  const a = canonicalizeJobUrl(`https://www.linkedin.com/comm/jobs/view/${ID}?trk=eml-job_card-0&trkEmail=eml-aaa`);
  const b = canonicalizeJobUrl(`https://www.linkedin.com/comm/jobs/view/${ID}?trk=eml-job_card-3&trkEmail=eml-bbb`);
  // `trk` is regenerated per send, so without this the same posting reads as new
  // on every digest and the pipeline grows one duplicate per alert.
  if (a === b && a === `https://www.linkedin.com/jobs/view/${ID}`) pass('two sends of one posting collapse onto the canonical URL');
  else fail(`trk variants → ${JSON.stringify({ a, b })}`);

  if (canonicalizeJobUrl('https://tw.indeed.com/rc/clk?jk=AB0005D11BE78014&fccid=x') === 'https://www.indeed.com/viewjob?jk=ab0005d11be78014') {
    pass('an Indeed regional click-through canonicalizes on its lowercased jk');
  } else {
    fail(`indeed → ${canonicalizeJobUrl('https://tw.indeed.com/rc/clk?jk=AB0005D11BE78014&fccid=x')}`);
  }

  // This canonicalizes; it does not filter. A URL it cannot parse must survive
  // byte-identical or the generic path loses the lead entirely.
  for (const url of [
    'https://boards.greenhouse.io/acme/jobs/12345',
    'https://www.linkedin.com/feed/update/urn:li:activity:123',
    'https://www.indeed.com/m?utm_source=jobalerts',
  ]) {
    if (canonicalizeJobUrl(url) === url) pass(`leaves an unrecognized URL untouched (${new URL(url).hostname})`);
    else fail(`${url} → ${canonicalizeJobUrl(url)}`);
  }
  // A lookalike host must not be rewritten. Doing so does more than mislabel: it
  // hands back a plausible board URL for a posting that does not exist, and takes
  // the real posting's slot in the dedupe key, so the genuine lead is suppressed.
  for (const url of [
    'https://evillinkedin.com/x/jobs/view/4011223344',
    'https://myindeed.com/?jk=c3626a655de4a873',
    'https://linkedin.com.evil.test/jobs/view/4011223344',
    'https://www.linkedin.com/feed#jobs/view/4011223344',
  ]) {
    if (canonicalizeJobUrl(url) === url) pass(`leaves a lookalike host untouched (${hostOf(url)})`);
    else fail(`${url} → ${canonicalizeJobUrl(url)}`);
  }
  // ...while a real regional subdomain, digits and all, still canonicalizes.
  if (canonicalizeJobUrl('https://uk2.indeed.com/viewjob?jk=c3626a655de4a873') === 'https://www.indeed.com/viewjob?jk=c3626a655de4a873') {
    pass('a numbered regional subdomain still canonicalizes');
  } else {
    fail(`uk2.indeed.com → ${canonicalizeJobUrl('https://uk2.indeed.com/viewjob?jk=c3626a655de4a873')}`);
  }
  if (canonicalizeJobUrl('') === '') pass("returns '' unchanged rather than throwing");
  else fail('empty input mangled');
} catch (err) {
  fail(`canonicalizeJobUrl tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — parseLinkedInDigest() over the fixture');
try {
  const jobs = parseLinkedInDigest(FIXTURE);

  // Four `View job:` anchors carry a real posting, but one repeats a posting
  // already listed higher up, so three distinct leads is the correct count.
  if (jobs.length === 3) pass('the digest yields 3 distinct leads');
  else fail(`expected 3 leads, got ${jobs.length}: ${JSON.stringify(jobs.map(j => j.title))}`);

  const byId = Object.fromEntries(jobs.map(j => [j.url.split('/').pop(), j]));

  const first = byId['4011223344'];
  if (first && first.title === 'Senior Product Manager' && first.company === 'Acme Analytics' && first.location === 'Taipei, Taiwan (Hybrid)') {
    pass('title/company/location read off the three lines above the separator');
  } else {
    fail(`first lead = ${JSON.stringify(first)}`);
  }

  // The furniture between the separator and `View job:` varies per posting and
  // per send ("Actively recruiting", a profile-match line, an apply CTA), which
  // is why the parse walks up to the blank rather than enumerating it.
  const second = byId['4022334455'];
  if (second && second.title === 'Growth Product Manager' && second.company === 'Northwind Labs' && second.location === 'Singapore') {
    pass('two lines of furniture between the separator and the anchor are walked past');
  } else {
    fail(`second lead = ${JSON.stringify(second)}`);
  }

  // The whole point of rule 2: this entry states no location. Borrowing
  // "Singapore" from the entry above would produce a lead that looks complete
  // and is wrong.
  const third = byId['4033445566'];
  if (third && third.title === 'Product Marketing Lead' && third.company === 'Contoso' && third.location === '') {
    pass('an entry with no location keeps location empty rather than inheriting the one above');
  } else {
    fail(`third lead = ${JSON.stringify(third)}`);
  }

  if (!jobs.some(j => j.url.endsWith('4099887766'))) {
    pass('a `View job:` buried in the unsubscribe footer, with no separator above it, is skipped');
  } else {
    fail('footer link was parsed as a job');
  }

  if (jobs.every(j => /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+$/.test(j.url))) pass('every lead URL is canonical, not the tracking wrapper');
  else fail(`non-canonical URLs: ${JSON.stringify(jobs.map(j => j.url))}`);

  for (const [input, label] of [['', 'empty string'], ['no anchors here at all\n\njust prose', 'a message with no `View job:` anchor']]) {
    if (parseLinkedInDigest(input).length === 0) pass(`returns [] for ${label}`);
    else fail(`${label} produced leads`);
  }
} catch (err) {
  fail(`parseLinkedInDigest tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — dispatch is on the DMARC-verified domain');
try {
  if (parseDigestLeads(linkedinHeaders, plainPayload(FIXTURE)).length === 3) pass('a verified linkedin.com dispatches to the LinkedIn parser');
  else fail('verified linkedin.com did not dispatch');

  const indeedLeads = parseDigestLeads(verified('jobalert.indeed.com', 'Indeed <donotreply@jobalert.indeed.com>'), qpPayload(INDEED_FIXTURE));
  if (indeedLeads.length === 1 && indeedLeads[0].company === '漸強實驗室 Crescendo Lab Ltd.') pass('a verified alert subdomain dispatches to the Indeed parser');
  else fail(`indeed dispatch → ${JSON.stringify(indeedLeads)}`);

  // The From header is attacker-chosen and RFC 5322 lets it carry angle brackets,
  // nested comments and a mailbox-list — every one of these is a legal or
  // near-legal header that some From parser reads as LinkedIn. None of them can
  // change what DMARC verified, which is the whole reason dispatch reads that
  // instead. Each is paired with a domain the attacker really does control and
  // really can get a dmarc=pass for.
  for (const [from, label] of [
    ['"<jobs@linkedin.com>" <evil@example.test>', 'an address quoted inside the display name'],
    ['LinkedIn <jobs@linkedin.com> <evil@example.test>', 'two angle-bracket groups'],
    ['<evil@example.test> (a (b) <jobs@linkedin.com>)', 'a nested RFC 5322 comment'],
    ['<evil@example.test>, <jobs@linkedin.com>', 'a bracketed mailbox-list'],
    ['undisclosed:<evil@example.test>, <jobs@linkedin.com>;', 'an RFC 6854 group'],
    ['jobs@evil.test@linkedin.com', 'a second @ before the trusted domain'],
    ['jobs@linkedin.com', 'a From that simply lies'],
  ]) {
    if (parseDigestLeads(verified('example.test', from), plainPayload(FIXTURE)).length === 0) pass(`no parser for ${label} when DMARC verified example.test`);
    else fail(`${label} reached the LinkedIn parser`);
  }

  // Lookalikes have to fail at the domain level too, since a verified domain is
  // still just a string until it is matched.
  for (const [domain, label] of [
    ['linkedin.com.evil.example', 'a lookalike domain'],
    ['notlinkedin.com', 'a suffix-only lookalike'],
    ['indeed.com.evil.example', 'an Indeed lookalike'],
    ['example.test', 'an unrelated sender'],
  ]) {
    if (parseDigestLeads(verified(domain), plainPayload(FIXTURE)).length === 0) pass(`no parser for ${label}`);
    else fail(`${label} was dispatched`);
  }

  // Fail closed: no DMARC pass, no parser. ingest() already drops unauthenticated
  // mail, but the helper must not depend on being called only after that gate.
  for (const [headers, label] of [
    [[{ name: 'From', value: 'LinkedIn <jobs@linkedin.com>' }], 'a message with no Authentication-Results at all'],
    [[{ name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail header.from=linkedin.com' }], 'a dmarc=fail result'],
    [[{ name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass' }], 'a dmarc=pass with no header.from'],
    [null, 'null headers'],
  ]) {
    if (parseDigestLeads(headers, plainPayload(FIXTURE)).length === 0) pass(`fails closed for ${label}`);
    else fail(`${label} dispatched`);
  }

  if (parseDigestLeads(linkedinHeaders, { mimeType: 'text/html', body: { data: b64('<p>x</p>') } }).length === 0) {
    pass('a verified LinkedIn message with no plain-text part degrades to the URL path');
  } else {
    fail('HTML-only LinkedIn message produced leads');
  }
  if (parseDigestLeads(null, null).length === 0) pass('null headers/payload return [] rather than throwing');
  else fail('null input did not return []');
} catch (err) {
  fail(`dispatch tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — the two readers must see the same text');
try {
  // The bug this pins: the parsers read the plain part through the
  // quoted-printable decoder while the generic sweep read the raw body, so an
  // Indeed alert produced the posting twice — once correctly from the parser,
  // and once as `viewjob?jk=3dc3626a…`, where the `3D` of the escaped `=` had
  // been swallowed into the id. The second copy looks like a valid posting URL,
  // which is what makes it worse than an obviously broken one.
  const payload = qpPayload(INDEED_FIXTURE);
  const swept = extractUrls(getMessageBody(payload)).filter(isCleanUrl).map(canonicalizeJobUrl);
  const lead = parseIndeedAlert(getPlainTextBody(payload))[0];

  if (swept.includes(lead.url)) pass('the generic sweep produces the same canonical URL the parser does (so the lead dedupes)');
  else fail(`sweep = ${JSON.stringify(swept)}, lead = ${lead.url}`);
  if (!swept.some(u => /jk=3d/i.test(u))) pass('no `jk=3D…` ghost posting survives the sweep');
  else fail(`ghost posting in sweep: ${swept.find(u => /jk=3d/i.test(u))}`);

  // The regression this pins: RFC 2045 makes 7bit the default and many senders
  // omit the header, so sniffing the content for a trailing-`=` fold corrupts
  // ordinary mail on the generic sweep — a URL wrapping after `?gh_src=` loses the
  // fold and `=ab` is read as a byte. Decoding is driven by the declaration alone.
  const undeclared = plainPayload('see https://boards.greenhouse.io/acme/jobs/4012345?gh_src=\nlinkedin and =ab literal');
  if (getMessageBody(undeclared) === 'see https://boards.greenhouse.io/acme/jobs/4012345?gh_src=\nlinkedin and =ab literal') {
    pass('a part declaring no encoding is passed through byte-identical, fold-shaped line and all');
  } else {
    fail(`undeclared 7bit part was decoded: ${JSON.stringify(getMessageBody(undeclared))}`);
  }
  if (getMessageBody(qpPayload('a=3Db=\nc')) === 'a=bc') pass('a part declaring quoted-printable is decoded');
  else fail(`declared quoted-printable not decoded: ${JSON.stringify(getMessageBody(qpPayload('a=3Db=\nc')))}`);

  // The alert-management link carries the recipient's own token and is only
  // reachable now that the body is decoded; it must not become a lead.
  if (!swept.some(u => hostOf(u) === 'subscriptions.indeed.com')) pass("the recipient's own alert-management URL is not swept up as a lead");
  else fail(`alert-management URL leaked into the sweep: ${swept.find(u => hostOf(u) === 'subscriptions.indeed.com')}`);

} catch (err) {
  fail(`shared-decode tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — block boundaries (rule 2: never read a neighbour)');
try {
  // Indeed inserts an estimated-salary line on some postings, and LinkedIn a
  // promoted label. Reading the bottom three lines of a four-line run relabels
  // every field — location becomes the salary, company becomes the location —
  // and the lead reads as complete.
  const fourLine = ['', 'Senior PM', 'Acme', 'Taipei, Taiwan', '$120K/yr - $150K/yr', '',
    'View job: https://www.linkedin.com/comm/jobs/view/5000000001?trk=x', ''].join('\n');
  if (parseLinkedInDigest(fourLine).length === 0) pass('a four-line block is skipped, not read bottom-up');
  else fail(`four-line block produced ${JSON.stringify(parseLinkedInDigest(fourLine))}`);

  // Two anchors sharing one separator: the second must not inherit the first's
  // title, company and location.
  const shared = ['', 'T1', 'C1', 'L1', '',
    'View job: https://www.linkedin.com/comm/jobs/view/5000000002?trk=x',
    'View job: https://www.linkedin.com/comm/jobs/view/5000000003?trk=x', ''].join('\n');
  const sharedJobs = parseLinkedInDigest(shared);
  if (sharedJobs.length === 1 && sharedJobs[0].url.endsWith('5000000002')) {
    pass('a second anchor with no block of its own is skipped rather than inheriting the first');
  } else {
    fail(`shared separator → ${JSON.stringify(sharedJobs)}`);
  }

  // Same failure on the Indeed side when the digest drops a blank between blocks.
  const adjacent = ['', 'PM1', 'Acme1 - Taipei', 'excerpt', '1天前',
    'https://www.indeed.com/viewjob?jk=6666666666666666',
    'PM2', 'Acme2 - Tainan', 'excerpt', '2天前',
    'https://www.indeed.com/viewjob?jk=7777777777777777', ''].join('\n');
  const adjacentJobs = parseIndeedAlert(adjacent);
  if (adjacentJobs.length === 1 && adjacentJobs[0].company === 'Acme1') {
    pass('an Indeed block with no opening blank is skipped rather than reading the block above');
  } else {
    fail(`adjacent blocks → ${JSON.stringify(adjacentJobs.map(j => [j.title, j.company]))}`);
  }

  // A three-line block that opens the message (no blank above it) is still valid.
  const atStart = ['Head of Product', 'Acme', 'Remote', '',
    'View job: https://www.linkedin.com/comm/jobs/view/5000000005?trk=x'].join('\n');
  if (parseLinkedInDigest(atStart)[0]?.title === 'Head of Product') pass('a block bounded by the start of the message is accepted');
  else fail(`block at index 0 → ${JSON.stringify(parseLinkedInDigest(atStart))}`);
} catch (err) {
  fail(`block-boundary tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — truncation counts code points');
try {
  // slice() counts UTF-16 units, so a cut between an emoji's surrogates leaves a
  // lone half that serializes to U+FFFD in the pipeline file.
  const long = `${'x'.repeat(159)}🚀 tail`;
  const job = parseLinkedInDigest(['', long, 'Acme', 'Taipei', '',
    'View job: https://www.linkedin.com/comm/jobs/view/5000000004?trk=x', ''].join('\n'))[0];
  if (job && wellFormed(job.title) && Array.from(job.title).length === 160) {
    pass('a title cut at the limit stays well-formed (no split surrogate)');
  } else {
    fail(`truncated title wellFormed=${wellFormed(job?.title)} length=${job && Array.from(job.title).length}`);
  }
} catch (err) {
  fail(`truncation tests crashed: ${err && err.message}`);
}

console.log('\ngmail digest parsers — only Gmail\'s own Authentication-Results counts');
try {
  const AR = (value) => ({ name: 'Authentication-Results', value });
  const payload = plainPayload(FIXTURE);

  // The attack: RFC 8601 §5 only obliges a receiver to strip Authentication-Results
  // headers claiming its OWN authserv-id, so a header the sender wrote under any
  // other id is delivered untouched. Without an authserv-id check the sender
  // supplies the verdict that decides which parser reads their body.
  const injected = AR('evil.test; dmarc=pass header.from=linkedin.com');
  for (const [headers, label] of [
    [[AR('mx.google.com; dmarc=fail header.from=example.test'), injected], "Gmail said fail and the sender wrote their own pass"],
    [[AR('mx.google.com; spf=pass'), injected], 'Gmail published no dmarc verdict and the sender supplied one'],
    [[injected, AR('mx.google.com; dmarc=pass header.from=example.test')], 'the injected header sits above Gmail\'s'],
    [[injected], 'the only Authentication-Results present is the sender\'s'],
  ]) {
    if (parseDigestLeads(headers, payload).length === 0) pass(`ignores a foreign authserv-id: ${label}`);
    else fail(`dispatched on an injected Authentication-Results: ${label}`);
  }

  // Same gate guards the anti-spoof check itself, which had the same hole.
  if (!isAuthenticEmail([AR('mx.google.com; dmarc=fail header.from=example.test'), injected])) {
    pass('isAuthenticEmail does not accept a foreign authserv-id either');
  } else {
    fail('isAuthenticEmail accepted an injected Authentication-Results');
  }

  // The verdict is read as a whole clause, not by finding `dmarc=pass` anywhere
  // in the header: both of these are real shapes that a substring search misreads.
  for (const [value, label] of [
    ['mx.google.com; dmarc=fail reason="not dmarc=pass" header.from=linkedin.com', 'a failure whose reason text quotes the word pass'],
    ['mx.google.com; dmarc=pass (header.from=linkedin.com) header.from=example.test', 'a header.from hiding inside a comment'],
    // A quoted string may hold `;`, so a clause boundary inside one is not real.
    ['mx.google.com; dmarc=fail reason="a; dmarc=pass header.from=linkedin.com"', 'a semicolon inside the reason text'],
    // ...and the quoted part can be the sender's own MAIL FROM, which they choose.
    ['mx.google.com; spf=fail (google.com: bad) smtp.mailfrom="a; dmarc=pass header.from=linkedin.com"@x.test; dmarc=fail (p=NONE) header.from=x.test', 'a forged clause inside a quoted local-part'],
  ]) {
    if (parseDigestLeads([AR(value)], payload).length === 0) pass(`reads the clause, not the substring: ${label}`);
    else fail(`misread: ${label}`);
  }

  // The shape Gmail actually delivers, semicolon-separated with comments.
  const real = 'mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass (google.com: domain of x designates 1.2.3.4 as permitted sender) smtp.mailfrom="a@b.test"; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=linkedin.com';
  if (parseDigestLeads([AR(real)], payload).length === 3) pass('a real multi-clause Gmail header dispatches normally');
  else fail('real Gmail header shape failed to dispatch');
} catch (err) {
  fail(`authserv-id tests crashed: ${err && err.message}`);
}

console.log('\ngmail ingest — a digest posting is added exactly once, end to end');
try {
  const gmail = (await import(pathToFileURL(join(ROOT, 'plugins/gmail/index.mjs')).href)).default;
  const message = (id, domain, from, part) => ({
    id,
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Subject', value: 'Job alert' },
        { name: 'From', value: from },
        { name: 'Authentication-Results', value: `mx.google.com; dmarc=pass (p=REJECT) header.from=${domain}` },
      ],
      parts: [part],
    },
  });
  const messages = {
    'digest-indeed': message('digest-indeed', 'jobalert.indeed.com', 'Indeed <donotreply@jobalert.indeed.com>', qpPayload(INDEED_FIXTURE)),
    'digest-linkedin': message('digest-linkedin', 'linkedin.com', 'LinkedIn <jobs@linkedin.com>', plainPayload(FIXTURE)),
  };
  const ctx = {
    dryRun: true,
    env: { GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' },
    settings: {},
    log: () => {},
    fetch: async (url) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      if (url.includes('messages?')) return { ok: true, json: async () => ({ messages: Object.keys(messages).map(id => ({ id })) }) };
      const hit = Object.keys(messages).find(id => url.includes(`messages/${id}`));
      if (hit) return { ok: true, json: async () => messages[hit] };
      return { ok: true, json: async () => ({}) };
    },
  };

  const jobs = await gmail.ingest(ctx);
  const indeed = jobs.filter(j => j.url.includes('indeed.com/viewjob'));

  // The claim the commit message makes: the parsed lead and the generic sweep of
  // the same message are one posting, not two. Verified through ingest() rather
  // than only at helper level, because it is the ORDER in index.mjs — leads first,
  // their canonical URLs registered before the sweep — that makes it true.
  if (indeed.length === 1 && indeed[0].url === 'https://www.indeed.com/viewjob?jk=c3626a655de4a873') {
    pass('the Indeed posting is added exactly once, with its canonical URL');
  } else {
    fail(`indeed leads = ${JSON.stringify(indeed)}`);
  }
  if (indeed[0]?.company === '漸強實驗室 Crescendo Lab Ltd.') pass('and it arrives titled, not as "Job lead (email)"');
  else fail(`indeed lead company = ${JSON.stringify(indeed[0]?.company)}`);
  if (!jobs.some(j => /jk=3d/i.test(j.url))) pass('no `jk=3D…` ghost posting reaches the pipeline');
  else fail(`ghost posting: ${jobs.find(j => /jk=3d/i.test(j.url)).url}`);

  const linkedin = jobs.filter(j => /linkedin\.com\/jobs\/view\/\d+$/.test(j.url));
  const titled = linkedin.filter(j => j.company);
  if (titled.length === 3 && new Set(titled.map(j => j.url)).size === 3) pass('all three real LinkedIn postings arrive titled and deduped');
  else fail(`titled linkedin leads = ${JSON.stringify(titled.map(j => [j.url.split('/').pop(), j.company]))}`);

  // The designed degradation, pinned rather than papered over: the footer anchor
  // the parser refuses to guess at is still swept up as an untitled lead, exactly
  // as it is today. Skipping a block costs visibility, never the lead itself.
  const untitled = linkedin.filter(j => !j.company);
  if (untitled.length === 1 && untitled[0].url.endsWith('4099887766')) pass('a block the parser skipped still reaches the pipeline untitled, via the URL path');
  else fail(`untitled linkedin leads = ${JSON.stringify(untitled.map(j => j.url))}`);
  if (!jobs.some(j => hostOf(j.url) === 'subscriptions.indeed.com')) pass("the recipient's alert-management URL never becomes a lead");
  else fail('alert-management URL reached the pipeline');
  // The digest's own footer navigation is on linkedin.com over https with no
  // tracker keyword, so nothing above catches it: without its own check it lands
  // in the pipeline as an untitled lead you have to open to identify.
  const nav = jobs.filter(j => /\/comm\/(psettings|jobs\/search)/.test(j.url));
  if (nav.length === 0) pass("the digest's own navigation links never become leads");
  else fail(`navigation links reached the pipeline: ${JSON.stringify(nav.map(j => j.url))}`);
} catch (err) {
  fail(`ingest end-to-end test crashed: ${err && err.message}`);
}
