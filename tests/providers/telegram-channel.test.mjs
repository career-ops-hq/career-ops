// tests/providers/telegram-channel.test.mjs — direct provider-contract tests.
// The t.me/s/<channel> preview is server-rendered HTML; the parser must turn
// each post into one posting keyed by its permalink, page back with
// ?before=<id>, stop at the configured age, and fail CLOSED on a channel that
// has no public preview — a silent zero there would read as an empty board
// and quietly drop the source from every scan.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — telegram-channel');

const post = (id, date, textHtml) => `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="devjobs/${id}" data-view="x">
    <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/devjobs"><span dir="auto">Game Development Jobs</span></a></div>
    <div class="tgme_widget_message_text js-message_text" dir="auto">${textHtml}</div>
    <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/devjobs/${id}"><time datetime="${date}" class="time">16:01</time></a></span>
  </div>
</div>`;

const page = (...posts) => `<html><head><meta property="og:title" content="Game Development Jobs"></head><body>${posts.join('')}</body></html>`;
const NO_PREVIEW = '<html><head><meta property="og:title" content="Telegram: Contact @gophersjob"></head><body><div class="tgme_page_description">You can contact @gophersjob right away.</div></body></html>';

const P1 = post(12509, '2026-09-01T17:25:26+00:00', 'Senior Unity Developer, remote, $5k<br/>Мы HyperHug &amp; Oxide: Survival Island.<br/>Стек: C#, Unity, <a href="https://example.com">подробнее</a>');
const P2 = post(12508, '2026-08-30T11:06:18+00:00', 'Backend Go engineer (game services)<br/>Удалённо, ГПХ');
const P_OLD = post(977, '2024-01-05T09:00:00+00:00', 'Very old post');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/telegram-channel.mjs')).href);
  const tg = mod.default;
  const { parseChannelPage } = mod;

  if (tg.id === 'telegram-channel') pass('telegram-channel.id is "telegram-channel"');
  else fail(`telegram-channel.id is ${JSON.stringify(tg.id)}`);

  if (typeof tg.detect !== 'function') pass('telegram-channel has no detect() — explicit provider: only, never auto-claimed from a careers_url');
  else fail('telegram-channel must not auto-detect');

  // --- parser ---------------------------------------------------------------
  const parsed = parseChannelPage(page(P1, P2), 'devjobs');
  if (parsed.posts.length === 2 && parsed.noPreview === false) pass('parseChannelPage() finds both posts on a preview page');
  else fail(`parseChannelPage() → ${parsed.posts.length} posts, noPreview=${parsed.noPreview}`);

  const first = parsed.posts[0];
  if (first?.id === 12509 && first.url === 'https://t.me/devjobs/12509') pass('a post keys on its permalink https://t.me/<channel>/<id>');
  else fail(`first post = ${JSON.stringify(first)}`);
  if (first?.title === 'Senior Unity Developer, remote, $5k') pass('title is the first line of the post, markup stripped');
  else fail(`title = ${JSON.stringify(first?.title)}`);
  if (first?.description.includes('HyperHug & Oxide') && first.description.includes('подробнее') && !/<a\b/.test(first.description)) {
    pass('description is the whole post as decoded plain text');
  } else {
    fail(`description = ${JSON.stringify(first?.description)}`);
  }
  if (first?.postedAt === Date.parse('2026-09-01T17:25:26+00:00')) pass('postedAt comes from <time datetime>');
  else fail(`postedAt = ${JSON.stringify(first?.postedAt)}`);

  // A post from another channel embedded in the page (forwards) is not ours.
  const foreign = parseChannelPage(page(P1.replace('data-post="devjobs/12509"', 'data-post="otherchan/5"')), 'devjobs');
  if (foreign.posts.length === 0) pass('posts attributed to another channel are ignored');
  else fail(`foreign post leaked: ${JSON.stringify(foreign.posts[0])}`);

  const stub = parseChannelPage(NO_PREVIEW, 'gophersjob');
  if (stub.posts.length === 0 && stub.noPreview === true) pass('the "Contact @handle" stub is recognised as no-public-preview');
  else fail(`stub → ${JSON.stringify(stub)}`);

  // --- fetch: redirect guard, mapping, paging ------------------------------
  const calls = [];
  const ctx = {
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      if (url === 'https://t.me/s/devjobs') return page(P1, P2);
      if (url === 'https://t.me/s/devjobs?before=12508') return page(P_OLD);
      return page();
    },
  };
  const jobs = await tg.fetch({ name: 'TG devjobs', channel: 'devjobs', max_pages: 3, since_days: 36500 }, ctx);
  // 'manual' (never followed, but the 3xx is visible), not 'follow': a hostile
  // handle must not be able to walk the request off t.me, and a private
  // channel's 302 must be reportable rather than a bare "fetch failed".
  if (calls.every((c) => c.opts?.redirect === 'manual')) pass('fetch() never follows redirects (redirect:"manual" on every page)');
  else fail(`redirect opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
  if (calls.length === 3 && calls[1].url === 'https://t.me/s/devjobs?before=12508' && calls[2].url === 'https://t.me/s/devjobs?before=977') {
    pass('fetch() pages back with ?before=<oldest id> and stops on an empty page');
  } else {
    fail(`page urls = ${JSON.stringify(calls.map((c) => c.url))}`);
  }
  if (jobs.length === 3 && jobs[0].company === '@devjobs' && jobs[0].location === '' && jobs[0].url === 'https://t.me/devjobs/12509' && jobs[2].url === 'https://t.me/devjobs/977') {
    pass('fetch() maps posts across pages to jobs with company=@channel');
  } else {
    fail(`jobs = ${JSON.stringify(jobs.map((j) => [j.url, j.company]))}`);
  }

  // since_days: an old post is dropped and paging stops there.
  const calls2 = [];
  const ctx2 = { fetchText: async (url, opts) => { calls2.push(url); return url.includes('before') ? page(P_OLD) : page(P1, P2); } };
  const recent = await tg.fetch({ name: 'TG', channel: '@devjobs', max_pages: 5, since_days: 36500 }, ctx2);
  const cut = await tg.fetch({ name: 'TG', channel: 'devjobs', max_pages: 5 }, { fetchText: async () => page(P_OLD) });
  if (recent.length === 3 && cut.length === 0) pass('since_days drops posts older than the window (default 30 days) and a leading @ is tolerated');
  else fail(`recent=${recent.length} cut=${cut.length}`);

  // --- fail closed ------------------------------------------------------------
  // Live behaviour (measured 2026-09-02): a private channel, one with the
  // preview switched off, and a nonexistent handle all answer
  // 302 → https://t.me/<handle>. Under redirect:'manual' _http.mjs throws an
  // error carrying status + location; the provider must turn that into a
  // named failure, not swallow it as an empty board.
  let threw = null;
  try {
    await tg.fetch({ name: 'TG', channel: 'gophersjob' }, {
      fetchText: async () => { const e = new Error('HTTP 302 Found'); e.status = 302; e.location = 'https://t.me/gophersjob'; throw e; },
    });
  } catch (e) { threw = e.message; }
  if (threw && /no public preview/.test(threw) && /302/.test(threw)) pass('a 302 on the first page throws "no public preview" naming the status (fails closed)');
  else fail(`302 channel did not throw as expected: ${JSON.stringify(threw)}`);

  // A network fault is not a "no preview" verdict — it must propagate as-is.
  let netErr = null;
  try { await tg.fetch({ name: 'TG', channel: 'devjobs' }, { fetchText: async () => { throw new Error('fetch failed'); } }); }
  catch (e) { netErr = e.message; }
  if (netErr === 'fetch failed') pass('a network error propagates unchanged (not mislabelled as no-preview)');
  else fail(`network error became: ${JSON.stringify(netErr)}`);

  let stubThrew = null;
  try { await tg.fetch({ name: 'TG', channel: 'gophersjob' }, { fetchText: async () => NO_PREVIEW }); }
  catch (e) { stubThrew = e.message; }
  if (stubThrew && /no public preview/.test(stubThrew)) pass('the "Contact @handle" stub served with 200 also throws (fails closed)');
  else fail(`stub page did not throw: ${JSON.stringify(stubThrew)}`);

  // A page that does not move back must not append the same posts twice.
  const stalled = await tg.fetch({ name: 'TG', channel: 'devjobs', max_pages: 4, since_days: 36500 }, { fetchText: async () => page(P1, P2) });
  if (stalled.length === 2) pass('a stalled page (same posts again) stops paging instead of duplicating posts');
  else fail(`stalled paging produced ${stalled.length} jobs, expected 2`);

  let fetched = false;
  let bad = null;
  try { await tg.fetch({ name: 'TG', channel: 'evil.example/x?y' }, { fetchText: async () => { fetched = true; return ''; } }); }
  catch (e) { bad = e.message; }
  if (bad && !fetched) pass('an invalid channel handle is rejected before any request is made');
  else fail(`invalid handle: threw=${JSON.stringify(bad)} fetched=${fetched}`);

  const empty = await tg.fetch({ name: 'TG', channel: 'devjobs' }, { fetchText: async () => page() });
  if (Array.isArray(empty) && empty.length === 0) pass('a preview page with no posts is an empty board, not an error');
  else fail(`empty page → ${JSON.stringify(empty)}`);
} catch (e) {
  fail(`telegram-channel provider tests crashed: ${e.message}`);
}
