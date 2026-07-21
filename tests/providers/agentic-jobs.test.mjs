// tests/providers/agentic-jobs.test.mjs — Agentic Engineering Jobs provider
// (server-rendered listing at agentic-engineering-jobs.com, parsed from
// data-impression-slug card containers). Follows the discovered-test layout
// from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — agentic-jobs (agentic-engineering-jobs.com SSR listing)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/agentic-jobs.mjs')).href);
  const agentic = mod.default;
  const { flagToCountry, cardLines, normalizeAgenticCard, parseAgenticListing } = mod;

  if (agentic.id === 'agentic-jobs') pass('agentic-jobs.id is "agentic-jobs"');
  else fail(`agentic-jobs.id is ${JSON.stringify(agentic.id)}`);

  const hit = agentic.detect({ name: 'Agentic Engineering Jobs', provider: 'agentic-jobs' });
  if (hit && hit.url === 'https://agentic-engineering-jobs.com') {
    pass('agentic-jobs.detect() claims entries with provider: agentic-jobs');
  } else {
    fail(`agentic-jobs.detect() returned ${JSON.stringify(hit)}`);
  }

  if (agentic.detect({ name: 'X', provider: 'remoteok' }) === null) {
    pass('agentic-jobs.detect() returns null for other providers');
  } else {
    fail('agentic-jobs.detect() should return null for other providers');
  }

  if (agentic.detect({ name: 'X', careers_url: 'https://agentic-engineering-jobs.com/' }) === null) {
    pass('agentic-jobs.detect() does not URL-autodetect (explicit provider: only)');
  } else {
    fail('agentic-jobs.detect() should not claim entries by careers_url');
  }

  // flagToCountry — regional-indicator flag emoji → English country name
  if (flagToCountry('🇺🇸') === 'United States') pass('flagToCountry() decodes 🇺🇸 to United States');
  else fail(`flagToCountry('🇺🇸') = ${JSON.stringify(flagToCountry('🇺🇸'))}`);

  if (flagToCountry('🇩🇪') === 'Germany') pass('flagToCountry() decodes 🇩🇪 to Germany');
  else fail(`flagToCountry('🇩🇪') = ${JSON.stringify(flagToCountry('🇩🇪'))}`);

  if (flagToCountry('DE') === '' && flagToCountry('🇺') === '' && flagToCountry('LangGraph') === '') {
    pass('flagToCountry() returns "" for plain text and non-flag input');
  } else {
    fail('flagToCountry() should return "" for non-flag input');
  }

  // cardLines — tag-stripped, entity-decoded text lines
  const lines = cardLines(
    '<script>var x = "<b>ignore</b>";</script><style>.a{}</style><img src="/logo.png">' +
    '<h2>Agent Engineer</h2> <p>Acme &amp; Co</p><span>  </span><span>Berlin</span>',
  );
  if (JSON.stringify(lines) === JSON.stringify(['Agent Engineer', 'Acme & Co', 'Berlin'])) {
    pass('cardLines() strips script/style/img, decodes entities, and drops blank lines');
  } else {
    fail(`cardLines() = ${JSON.stringify(lines)}`);
  }

  // normalizeAgenticCard — text lines → normalized Job
  const card = normalizeAgenticCard('senior-agent-engineer-acme', [
    'senior-agent-engineer-acme" class="card">',
    'Featured',
    'Senior Agent Engineer',
    'Acme AI',
    'San Francisco',
    'LangGraph',
    '🇺🇸',
    '2026-07-01',
  ]);
  if (
    card &&
    card.title === 'Senior Agent Engineer' &&
    card.company === 'Acme AI' &&
    card.url === 'https://agentic-engineering-jobs.com/jobs/senior-agent-engineer-acme'
  ) {
    pass('normalizeAgenticCard() drops the slug artifact + Featured badge and maps title/company/url');
  } else {
    fail(`normalizeAgenticCard() = ${JSON.stringify(card)}`);
  }

  if (card && card.location === 'San Francisco, United States') {
    pass('normalizeAgenticCard() appends the decoded flag country to the location');
  } else {
    fail(`normalizeAgenticCard() location = ${JSON.stringify(card && card.location)}`);
  }

  if (card && card.postedAt === Date.parse('2026-07-01T00:00:00Z')) {
    pass('normalizeAgenticCard() parses the YYYY-MM-DD date line as UTC postedAt');
  } else {
    fail(`normalizeAgenticCard() postedAt = ${card && card.postedAt}`);
  }

  const noLocation = normalizeAgenticCard('agent-eng', ['Agent Engineer', 'Globex', '2026-06-15', '🇫🇷']);
  if (noLocation && noLocation.location === 'France' && noLocation.postedAt === Date.parse('2026-06-15T00:00:00Z')) {
    pass('normalizeAgenticCard() treats a date-shaped third field as no location (flag country only)');
  } else {
    fail(`normalizeAgenticCard() no-location card = ${JSON.stringify(noLocation)}`);
  }

  const flagSlot = normalizeAgenticCard('agent-eng-2', ['Agent Engineer', 'Globex', '🇺🇸', '2026-06-15']);
  if (flagSlot && flagSlot.location === 'United States') {
    pass('normalizeAgenticCard() never reads a bare flag line as the location (no-location card)');
  } else {
    fail(`normalizeAgenticCard() flag-in-location-slot card = ${JSON.stringify(flagSlot)}`);
  }

  if (normalizeAgenticCard('bad slug!', ['Title', 'Company']) === null) {
    pass('normalizeAgenticCard() rejects path-unsafe slugs (they feed straight into a URL path)');
  } else {
    fail('normalizeAgenticCard() should reject path-unsafe slugs');
  }

  if (normalizeAgenticCard('', ['Title', 'Company']) === null && normalizeAgenticCard('ok-slug', ['Title only']) === null) {
    pass('normalizeAgenticCard() returns null for a missing slug or fewer than title+company');
  } else {
    fail('normalizeAgenticCard() should return null for incomplete cards');
  }

  // parseAgenticListing — full page → deduped job list
  const LISTING = `
<html><body><main>
  <div class="cards">
    <div data-impression-slug="senior-agent-engineer-acme" class="card">
      <img src="/acme.png">
      <h2>Senior Agent Engineer</h2>
      <p class="company">Acme AI</p>
      <p class="location">San Francisco</p>
      <span class="tag">LangGraph</span>
      <span class="flag">🇺🇸</span>
      <time>2026-07-01</time>
    </div>
    <div data-impression-slug="agent-platform-engineer-globex" class="card">
      <span class="badge">Featured</span>
      <h2>Agent Platform Engineer</h2>
      <p class="company">Globex &amp; Co</p>
      <p class="location">Remote</p>
      <span class="flag">🇩🇪</span>
      <time>2026-06-15</time>
    </div>
    <div data-impression-slug="senior-agent-engineer-acme" class="card">
      <h2>Senior Agent Engineer</h2>
      <p class="company">Acme AI</p>
    </div>
  </div>
</main></body></html>`;

  const jobs = parseAgenticListing(LISTING);
  if (jobs.length === 2) {
    pass('parseAgenticListing() parses every card and dedupes repeated slugs');
  } else {
    fail(`parseAgenticListing() returned ${jobs.length} jobs, expected 2`);
  }

  const g = jobs[1];
  if (
    g &&
    g.company === 'Globex & Co' &&
    g.location === 'Remote, Germany' &&
    g.url === 'https://agentic-engineering-jobs.com/jobs/agent-platform-engineer-globex'
  ) {
    pass('parseAgenticListing() decodes entities and appends the flag country per card');
  } else {
    fail(`parseAgenticListing() job[1] = ${JSON.stringify(g)}`);
  }

  // fetch() — single page fetch, hard failure on zero cards (mocked ctx)
  const mkCtx = (html) => {
    const calls = [];
    return { calls, ctx: { fetchText: async (url, opts) => { calls.push({ url, opts }); return html; } } };
  };

  const ok = mkCtx(LISTING);
  const fetched = await agentic.fetch({ name: 'Agentic Engineering Jobs', provider: 'agentic-jobs' }, ok.ctx);
  if (
    fetched.length === 2 &&
    ok.calls.length === 1 &&
    ok.calls[0].url === 'https://agentic-engineering-jobs.com/' &&
    ok.calls[0].opts.redirect === 'error'
  ) {
    pass('agentic-jobs.fetch() fetches the listing once with redirect: error and returns the parsed jobs');
  } else {
    fail(`agentic-jobs.fetch(): ${fetched.length} jobs, calls = ${JSON.stringify(ok.calls.map((c) => c.url))}`);
  }

  let zeroCardsThrew = false;
  try {
    await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, mkCtx('<html><body>no cards here</body></html>').ctx);
  } catch { zeroCardsThrew = true; }
  if (zeroCardsThrew) {
    pass('agentic-jobs.fetch() throws when the page yields zero cards (markup-change canary)');
  } else {
    fail('agentic-jobs.fetch() should throw when no cards parse');
  }
} catch (e) {
  fail(`agentic-jobs provider tests crashed: ${e.message}`);
}
