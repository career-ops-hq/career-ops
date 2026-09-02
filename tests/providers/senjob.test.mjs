// tests/providers/senjob.test.mjs — provider-contract tests for the Senjob
// board-wide HTML listing (providers/senjob.mjs).
//
// The fixtures reproduce shapes measured on the live board on 2026-08-16, and
// each one exists because it decides the parser's design:
//
//   - the title link and the publication date sit in SIBLING cells, so a parser
//     that windows around the link loses the date;
//   - the board pins "sticky" postings to the top of every page, so the same
//     posting id recurs and must merge rather than duplicate;
//   - anchor bodies carry an HTML comment between the title and a spacer image,
//     which a naive tag strip would leave inside the title;
//   - the date is only machine-readable in a hidden span next to its localized
//     form ("13 Aou.").
//
// The last group is the important one: a listing page that parses to nothing
// must THROW. Returning [] would render a broken parser as a board with no
// openings — indistinguishable from a healthy quiet board, and the reason
// scraped sources are hard to trust.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — senjob');

// One posting: title anchor in its own row, dates in the sibling row that
// follows. Trimmed from the live page, structure preserved.
const ROW_WITH_SIBLING_DATE = `
<tr style="height:70px;">
  <td align=center><div align=left>
    <a href="https://senjob.com/jobseekers/developpeur-fullstack_e_163401.html" style="font-size:18px; color:#222;">
      Developpeur Fullstack
      <!-- d ico postulez -->
      <img src="images/blank.gif">
      <!-- f ico postulez -->
    </a>
  </div></td>
  <td align=left valign=middle>Dakar</td>
</tr>
<tr>
  <td><a href="https://senjob.com/jobseekers/developpeur-fullstack_e_163401.html">&nbsp;</a>
    <span style='color:#999;'> Publi&eacute;: </span>
    <span style="display:none;">2026-08-14</span>14&nbsp;Aou.
  </td>
</tr>`;

// A second, self-contained posting whose place cell precedes the "Publié:"
// label inside the SAME row.
const ROW_INLINE = `
<tr>
  <td><div align=left>
    <a href="https://senjob.com/jobseekers/software-and-data-engineer_e_163402.html" style="color:#222;">Software and Data Engineer</a>
  </div></td>
  <td>Dakar <span style='color:#999;'> Publi&eacute;: </span><span style="display:none;">2026-08-12</span>12&nbsp;Aou.</td>
</tr>`;

const PAGE = `<html><body><table>${ROW_WITH_SIBLING_DATE}${ROW_INLINE}</table></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/senjob.mjs')).href);
  const senjob = mod.default;
  const { parseListingPage, buildListUrl, visibleText, assertParsedSomething } = mod;

  if (senjob.id === 'senjob') pass('senjob.id is "senjob"');
  else fail(`senjob.id is ${JSON.stringify(senjob.id)}`);

  // ── detect(): explicit selection only, like every board-wide provider ──
  const hit = senjob.detect({ name: 'Senjob', provider: 'senjob' });
  if (hit && hit.url === 'https://senjob.com/offres-d-emploi.php') {
    pass('detect() resolves provider:senjob → the listing URL');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }
  if (senjob.detect({ name: 'Senjob' }) === null) pass('detect() returns null without provider:senjob');
  else fail('detect() must require provider:senjob');

  // ── buildListUrl(): page 1 is the bare path the board itself links ──
  if (buildListUrl(1) === 'https://senjob.com/offres-d-emploi.php'
      && buildListUrl(3) === 'https://senjob.com/offres-d-emploi.php?page=3') {
    pass('buildListUrl(): page 1 bare, later pages carry ?page=N');
  } else {
    fail(`buildListUrl drift: ${buildListUrl(1)} / ${buildListUrl(3)}`);
  }

  // ── visibleText(): comments stripped BEFORE tags ──
  // A tag-only strip leaves "d ico postulez" sitting inside the title.
  const titleFragment = 'Developpeur Fullstack <!-- d ico postulez --> <img src="x.gif">';
  if (visibleText(titleFragment) === 'Developpeur Fullstack') {
    pass('visibleText() drops HTML comments, not just tags');
  } else {
    fail(`visibleText() => ${JSON.stringify(visibleText(titleFragment))}`);
  }

  // Entity decoding must be ONE pass. Decoding `&amp;` before the others turned
  // `&amp;quot;` into `&quot;` and then into `"` — a double-unescape that
  // rewrites text the board meant literally (CodeQL, #2962).
  if (visibleText('&amp;quot;') === '&quot;' && visibleText('&amp;amp;') === '&amp;') {
    pass('visibleText() decodes entities once — &amp;quot; stays literal');
  } else {
    fail(`double-unescape: &amp;quot; => ${JSON.stringify(visibleText('&amp;quot;'))}, &amp;amp; => ${JSON.stringify(visibleText('&amp;amp;'))}`);
  }
  // Guard: ordinary entities still decode, including the accented ones a
  // French-language board actually emits, and numeric references.
  if (visibleText('R&amp;D') === 'R&D'
      && visibleText('&quot;Senior&quot;') === '"Senior"'
      && visibleText('Charg&eacute; de projet') === 'Chargé de projet'
      && visibleText('D&#233;veloppeur') === 'Développeur'
      && visibleText('L&#39;agent') === "L'agent") {
    pass('visibleText() still decodes named, accented and numeric entities');
  } else {
    fail(`entity decoding drift: ${JSON.stringify([visibleText('R&amp;D'), visibleText('&quot;Senior&quot;'), visibleText('Charg&eacute; de projet'), visibleText('D&#233;veloppeur'), visibleText("L&#39;agent")])}`);
  }
  // A numeric reference outside the valid scalar range must stay literal.
  // String.fromCodePoint() happily builds a LONE SURROGATE, which is not valid
  // text and breaks strict serialization downstream (CodeRabbit, #2962).
  // The policy is the shared decoder's: XML 1.0 §2.2 Char. Surrogates and
  // U+FFFE/U+FFFF are outside it and stay literal. The FDD0–FDEF noncharacter
  // block is INSIDE it and decodes — a deliberate consequence of naming that
  // standard, not an oversight here, so this pins the standard's actual edge
  // rather than a stricter rule this provider used to apply alone.
  const outsideXmlChar = ['&#55296;', '&#xD800;', '&#65534;', '&#65535;', '&#1;'];
  const keptLiteral = outsideXmlChar.filter((ref) => visibleText(ref) === ref);
  if (keptLiteral.length === outsideXmlChar.length) {
    pass('visibleText() keeps surrogates, U+FFFE, U+FFFF and the C0 controls literal');
  } else {
    fail(`decoded outside XML Char: ${JSON.stringify(outsideXmlChar.filter((r) => !keptLiteral.includes(r)).map((r) => [r, visibleText(r)]))}`);
  }
  // The other side of the same boundary, which the comment above claims and the
  // assertion above cannot show: U+FDD0 is INSIDE XML Char and therefore
  // decodes. Without this, a decoder that rejected the whole FDD0–FDEF block —
  // the stricter rule senjob used to apply alone — would still pass (CodeRabbit,
  // #3007).
  if (visibleText('&#64976;') === '\uFDD0') {
    pass('visibleText() decodes U+FDD0: inside XML Char, so inside the policy');
  } else {
    fail(`U+FDD0 not decoded: ${JSON.stringify(visibleText('&#64976;'))}`);
  }
  // Guard: valid references on both sides of the rejected ranges still decode.
  if (visibleText('&#233;') === 'é' && visibleText('&#xE9;') === 'é' && visibleText('&#128512;') === '\u{1F600}') {
    pass('visibleText() still decodes valid decimal, hex and astral references');
  } else {
    fail(`valid references broken: ${JSON.stringify([visibleText('&#233;'), visibleText('&#xE9;'), visibleText('&#128512;')])}`);
  }

  // An entity the table does not know is left alone rather than mangled.
  // `&euro;` is now a KNOWN entity (the shared table carries it), so the guard
  // uses names the table genuinely does not have.
  if (visibleText('&unknown; &fakeent; net') === '&unknown; &fakeent; net') {
    pass('visibleText() leaves an unknown entity untouched');
  } else {
    fail(`unknown entity mangled: ${JSON.stringify(visibleText('&unknown; &fakeent; net'))}`);
  }

  // ── parseListingPage(): the shapes the board actually serves ──
  const jobs = parseListingPage(PAGE);
  if (jobs.length === 2) pass('parseListingPage() returns one job per posting id, sticky rows merged');
  else fail(`parseListingPage() returned ${jobs.length} jobs: ${JSON.stringify(jobs)}`);

  const fullstack = jobs.find((j) => /Fullstack/.test(j.title));
  if (fullstack && fullstack.title === 'Developpeur Fullstack') {
    pass('title comes from the anchor body, comment and spacer image removed');
  } else {
    fail(`title drift: ${JSON.stringify(fullstack)}`);
  }
  if (fullstack && fullstack.url === 'https://senjob.com/jobseekers/developpeur-fullstack_e_163401.html') {
    pass('url is the absolute posting link');
  } else {
    fail(`url drift: ${JSON.stringify(fullstack && fullstack.url)}`);
  }
  if (fullstack && fullstack.location === 'Dakar') {
    pass('location is read from the cell after the title');
  } else {
    fail(`location drift: ${JSON.stringify(fullstack && fullstack.location)}`);
  }
  // The date lives in a DIFFERENT row than the title — the case that motivates
  // merging by id instead of windowing around the link.
  if (fullstack && fullstack.postedAt === Date.parse('2026-08-14T00:00:00Z')) {
    pass('postedAt is picked up from the sibling row, not lost');
  } else {
    fail(`postedAt drift: ${JSON.stringify(fullstack && fullstack.postedAt)}`);
  }

  const inline = jobs.find((j) => /Data Engineer/.test(j.title));
  if (inline && inline.location === 'Dakar' && inline.postedAt === Date.parse('2026-08-12T00:00:00Z')) {
    pass('a posting whose place and date share one row parses too');
  } else {
    fail(`inline row drift: ${JSON.stringify(inline)}`);
  }

  // company is deliberately empty: the listing rows never name the employer,
  // and _types.js documents an empty company for exactly this case. Guessing
  // one from the slug would be a fabricated claim.
  if (jobs.every((j) => j.company === '')) {
    pass('company is left empty rather than invented from the slug');
  } else {
    fail(`company was populated: ${JSON.stringify(jobs.map((j) => j.company))}`);
  }

  // ── The silent-zero guard ──
  let threw = false;
  try {
    assertParsedSomething(PAGE, 'https://senjob.com/offres-d-emploi.php');
  } catch {
    threw = true;
  }
  if (threw) {
    pass('assertParsedSomething() throws when posting links are present but unparsed');
  } else {
    fail('a page still full of posting links must not be reported as empty');
  }

  let threwOnEmpty = false;
  try {
    assertParsedSomething('<html><body>No results.</body></html>', 'https://senjob.com/offres-d-emploi.php');
  } catch {
    threwOnEmpty = true;
  }
  if (!threwOnEmpty) {
    pass('a genuinely empty page does not throw — only an unparsed one does');
  } else {
    fail('an empty listing page must be allowed, or a quiet board reads as broken');
  }

  // ── fetch(): pagination, dedup, and the stop condition ──
  const pages = new Map([
    ['https://senjob.com/offres-d-emploi.php', PAGE],
    ['https://senjob.com/offres-d-emploi.php?page=2', ROW_INLINE], // only a sticky repeat
  ]);
  /** @type {string[]} */
  const requested = [];
  let slept = 0;
  const ctx = {
    maxPages: 5,
    sleep: async (ms) => { slept += ms; },
    fetchText: async (url) => {
      requested.push(url);
      return pages.get(url) ?? '<html><body>No results.</body></html>';
    },
  };

  const fetched = await senjob.fetch({ provider: 'senjob' }, ctx);
  if (fetched.length === 2) {
    pass('fetch() dedups a sticky posting repeated on the next page');
  } else {
    fail(`fetch() returned ${fetched.length}: ${JSON.stringify(fetched.map((j) => j.url))}`);
  }
  if (requested.length === 2) {
    pass('fetch() stops once a page contributes no new posting');
  } else {
    fail(`fetch() requested ${requested.length} pages: ${JSON.stringify(requested)}`);
  }
  if (slept >= 250) pass('fetch() paces between pages of the same board');
  else fail(`fetch() slept ${slept}ms between pages`);

  // ── fetch(): entry.max_pages configures the run, ctx.maxPages only caps it ──
  // The convention alibaba.mjs and 4dayweek.mjs already follow: `max_pages` on
  // the portals entry is the user's setting; ctx.maxPages is verify-portals'
  // health probe passing 1. Reading only ctx.maxPages ignored the configuration.
  {
    const wide = new Map([
      ['https://senjob.com/offres-d-emploi.php', PAGE],
      ['https://senjob.com/offres-d-emploi.php?page=2', ROW_WITH_SIBLING_DATE.replace(/163401/g, '900001')],
      ['https://senjob.com/offres-d-emploi.php?page=3', ROW_WITH_SIBLING_DATE.replace(/163401/g, '900002')],
    ]);
    /** @type {string[]} */
    const asked = [];
    const cappedCtx = {
      sleep: async () => {},
      fetchText: async (url) => { asked.push(url); return wide.get(url) ?? '<html>No results.</html>'; },
    };
    await senjob.fetch({ provider: 'senjob', max_pages: 2 }, cappedCtx);
    if (asked.length === 2) {
      pass('fetch() honours entry.max_pages when ctx carries no hint');
    } else {
      fail(`entry.max_pages ignored: requested ${JSON.stringify(asked)}`);
    }

    asked.length = 0;
    await senjob.fetch({ provider: 'senjob', max_pages: 3 }, { ...cappedCtx, maxPages: 1 });
    if (asked.length === 1) {
      pass('ctx.maxPages caps entry.max_pages — a health probe still reads one page');
    } else {
      fail(`probe not capped: requested ${JSON.stringify(asked)}`);
    }
  }

  // The MAX_PAGES_CAP boundary: a configured max_pages above the ceiling is
  // clamped, so one misconfigured entry cannot sweep the board forever
  // (Scott-Emberson, code owner for tests/, on #2962). Every page below yields a
  // NEW posting, so nothing but the cap can stop the run.
  {
    /** @type {string[]} */
    const asked = [];
    const endlessCtx = {
      sleep: async () => {},
      fetchText: async (url) => {
        asked.push(url);
        const page = Number(new URL(url).searchParams.get('page') || '1');
        return ROW_WITH_SIBLING_DATE.replace(/163401/g, String(800000 + page));
      },
    };
    await senjob.fetch({ provider: 'senjob', max_pages: 999 }, endlessCtx);
    if (asked.length === 50) {
      pass('fetch() clamps an over-large max_pages to the 50-page cap');
    } else {
      fail(`MAX_PAGES_CAP not enforced: requested ${asked.length} pages`);
    }
  }

  // ── fetch(): the request is pinned against SSRF ──
  // redirect:'error' plus the host check is what keeps the sweep on senjob.com;
  // a refactor dropping either would leave the pin looking present but inert.
  {
    /** @type {any[]} */
    const opts = [];
    const optCtx = {
      sleep: async () => {},
      fetchText: async (url, o) => { opts.push(o); return url.includes('page=') ? '<html>No results.</html>' : PAGE; },
    };
    await senjob.fetch({ provider: 'senjob' }, optCtx);
    const pinned = opts.length > 0 && opts.every((o) => o
      && o.redirect === 'error'
      && typeof o.headers?.['User-Agent'] === 'string'
      && o.headers['User-Agent'].length > 0);
    if (pinned) {
      pass('fetch() sends redirect:error and a browser-like User-Agent on every request');
    } else {
      fail(`request options drift: ${JSON.stringify(opts)}`);
    }
  }

  // ── fetch(): a broken page 1 is an error, never an empty board ──
  const brokenCtx = {
    sleep: async () => {},
    // The realistic markup change: postings still on the page, but the link
    // moved off the `href` of an anchor onto a data attribute (a JS-driven
    // card). The parser finds nothing; the page is clearly still a listing.
    fetchText: async () => '<div data-url="https://senjob.com/jobseekers/x_e_1.html">x</div>',
  };
  let fetchThrew = false;
  try {
    await senjob.fetch({ provider: 'senjob' }, brokenCtx);
  } catch (err) {
    fetchThrew = /markup changed/.test(String(err && err.message));
  }
  if (fetchThrew) {
    pass('fetch() throws when page 1 has postings it cannot parse');
  } else {
    fail('a markup change must surface as an error, not as a board with no jobs');
  }
} catch (error) {
  fail(`senjob provider tests could not run: ${error.message}`);
}
