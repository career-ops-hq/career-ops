// tests/providers/rss-entity-decoding.test.mjs — the seven providers that
// carried a hand-rolled entity decoder emitted NUL / lone surrogates into job
// titles and silently deleted out-of-range references (#2790). They now share
// the safe decoder in providers/_html-entities.mjs, so their output must match
// it: any non-emittable reference is left as raw text, never a bad code unit.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProviders — entity decoding is illegal-code-point safe (#2790)');

const load = (f) => import(pathToFileURL(join(ROOT, 'providers/' + f)).href);
const { decodeEntities } = await load('_html-entities.mjs');

// A NUL or a *lone* surrogate must never reach a title. A valid supplementary
// character is a high surrogate immediately followed by a low surrogate, so a
// plain [\uD800-\uDFFF] class would false-positive on legitimate emoji/CJK-B —
// walk the string and only reject surrogates that are not part of a pair.
function hasNulOrLoneSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

// NUL, a lone surrogate, a C0 control, a noncharacter, and an out-of-range code
// point: the old decoder emitted the first four and deleted the last. The shared
// decoder leaves each reference as raw text.
const cases = ['A&#0;B', 'A&#xD800;B', 'A&#1;B', 'A&#xFFFF;B', 'A&#99999999;B'];

// Feed each case through getTitle(rawTitle) and check the result is exactly the
// shared decoder's output and free of NUL / lone surrogates.
function checkProvider(label, getTitle) {
  for (const raw of cases) {
    const input = `${raw} Engineer`;
    const title = getTitle(input) ?? '';
    if (hasNulOrLoneSurrogate(title)) {
      fail(`${label}: ${raw}: title contains a NUL or lone surrogate`);
      return;
    }
    if (title !== decodeEntities(input)) {
      fail(`${label}: ${raw}: got ${JSON.stringify(title)}, want ${JSON.stringify(decodeEntities(input))}`);
      return;
    }
  }
  pass(`${label} leaves illegal entity references as raw text`);
}

// ── RSS feed parsers ──
const rss = (title, link) =>
  `<?xml version="1.0"?><rss><channel><item>` +
  `<title>${title}</title><link>${link}</link>` +
  `<description>Location: Remote</description></item></channel></rss>`;

const rssProviders = [
  ['jobspresso.mjs', 'parseJobspressoFeed', 'https://jobspresso.co/job/x/'],
  ['higheredjobs.mjs', 'parseHigherEdJobsFeed', 'https://www.higheredjobs.com/details.cfm?JobCode=1'],
  ['nodesk.mjs', 'parseNodeskFeed', 'https://nodesk.co/remote-jobs/x/'],
  ['larajobs.mjs', 'parseLarajobsFeed', 'https://larajobs.com/job/1'],
  ['teamtailor.mjs', 'parseTeamtailorFeed', 'https://x.teamtailor.com/jobs/1'],
  ['weworkremotely.mjs', 'parseWwrFeed', 'https://weworkremotely.com/remote-jobs/x'],
];
// Every (label, getTitle) pair checked above, reused by the decode-equivalence
// pass at the bottom so it covers the same set without re-deriving it.
const checked = [];

for (const [file, fn, link] of rssProviders) {
  const parse = (await load(file))[fn];
  const getTitle = (input) => parse(rss(input, link))[0]?.title;
  checkProvider(fn, getTitle);
  checked.push([fn, getTitle]);
}

// ── personio: title and location decode through the shared decoder on both the
// XML feed path (tagText → extractText) and the HTML-fallback path. ──
const { parsePersonioXml, parsePersonioHtml } = await load('personio.mjs');

const personioXmlTitle = (input) =>
  parsePersonioXml(
    `<workzag-jobs><position><name>${input}</name><id>123</id><office>Remote</office></position></workzag-jobs>`,
    'Acme',
    'acme.jobs.personio.de',
  )[0]?.title;

const personioHtmlTitle = (input) =>
  parsePersonioHtml(
    `<a class="job-box" href="/job/123"><h3>${input}</h3><span class="jobMetaText">Remote</span></a>`,
    'Acme',
    'acme.jobs.personio.de',
  )[0]?.title;

checkProvider('parsePersonioXml', personioXmlTitle);
checkProvider('parsePersonioHtml', personioHtmlTitle);
checked.push(['parsePersonioXml', personioXmlTitle], ['parsePersonioHtml', personioHtmlTitle]);

// ── Legitimate references must still decode, the same way the shared decoder
// decodes them. The cases above prove a provider rejects what it should; on
// their own they are also satisfied by a provider that has stopped decoding
// altogether, since `decodeEntities` leaves every one of them as raw text too.
//
// These also pin the two places the private copies used to differ from the
// shared decoder, so a re-introduced copy that only gets *these* wrong still
// fails: they knew five named entities and matched them case-sensitively, so
// `&nbsp;` survived as literal text and `&AMP;` / `&#Xfc;` never decoded.
const decodingCases = ['R&amp;D f&#252;r Z&#xfc;rich', 'A&nbsp;B', 'A&AMP;B', 'Z&#Xfc;rich'];

for (const [label, getTitle] of checked) {
  let ok = true;
  for (const raw of decodingCases) {
    const input = `${raw} Engineer`;
    const title = getTitle(input) ?? '';
    if (title !== decodeEntities(input)) {
      fail(`${label}: ${raw}: got ${JSON.stringify(title)}, want ${JSON.stringify(decodeEntities(input))}`);
      ok = false;
      break;
    }
  }
  if (ok) pass(`${label} decodes legitimate references exactly as the shared decoder does`);
}

// ── Source-level guard ──
// Everything above compares a provider's output to the shared decoder on a
// fixed set of inputs, which catches a private copy that behaves differently
// *today*. But the failure this bug class keeps having is a copy that is
// correct when it lands and drifts afterwards — #1555, #1639 and #2623 were
// each a copy that had been right at some point. So assert it at the source:
// a provider that imports the shared decoder must not also declare its own,
// and the commit that re-introduces one fails here rather than years later.
//
// Two passes, because "imports the shared decoder" alone is escapable: a
// provider that DROPS the import while restoring a private copy would simply
// fall out of a discovery sweep, and a correct-looking copy passes every
// output case above (CodeRabbit on this PR).
//
//   1. The seven files #2818 migrated are named explicitly. That set is
//      historical and does not move, so a hardcoded list is the right shape:
//      each MUST still import the shared module, and dropping the import is
//      itself the failure.
//   2. Every other importer is swept dynamically, so a provider added later
//      that grows its own copy is caught without anyone updating a list.
//
// providers/jobvite.mjs is in neither set: it still carries a private decoder
// (a correct one — isEmittableCodePoint was upstreamed from it in #2623) and
// does not import the shared module, so it is legitimately outside this guard
// rather than silently excused by an exception list.
{
  const { readdirSync, readFileSync } = await import('fs');
  const dir = join(ROOT, 'providers');
  // Every provider on main writes the import one way, but the guard must not
  // depend on that: quote style and `const`/arrow declarations are exactly the
  // cosmetic variations a re-introduced copy would arrive with, and matching
  // one spelling would let it back in (CodeRabbit on this PR).
  const SHARED_IMPORT = /\bfrom\s*['"]\.\/_html-entities\.mjs['"]/;
  // The name list is a list of SPELLINGS, so it has to carry the near misses.
  // senjob (#2962) declared `decodeEntity` — singular — alongside its own
  // `NAMED_ENTITIES` table, and matched none of the three names below, so this
  // guard reported a clean repository while a fifth private copy sat in it.
  const PRIVATE_DECL =
    /(?:function\s*\*?\s+|(?:const|let|var)\s+)(decodeEntity|decodeEntities|decodeXmlEntity|decodeXmlEntities|fromCodePoint|NAMED_ENTITIES|XML_ENTITIES|HTML_ENTITIES)\b/;
  // Declarations only — remotli.mjs names String.fromCodePoint in a comment
  // explaining why it uses the shared decoder, which is not a private copy.
  // A destructure (`const { decodeEntities } = …`) has a brace after `const`
  // and so does not match either.

  const MIGRATED = [
    'jobspresso.mjs', 'higheredjobs.mjs', 'nodesk.mjs', 'larajobs.mjs',
    'personio.mjs', 'teamtailor.mjs', 'weworkremotely.mjs',
  ];

  // The classification lives in one function so the POSITIVE CONTROL below can
  // run it on synthetic sources instead of restating the logic. A guard whose
  // discrimination is only ever demonstrated in a pull-request description is
  // demonstrated nowhere after the merge (Scott-Emberson on this PR).
  /** @returns {string|null} offender line, or null when the file is clean. */
  const classifyProvider = (file, src) => {
    const local = src.match(PRIVATE_DECL);
    if (!local) return null;
    return SHARED_IMPORT.test(src)
      ? `${file} (declares ${local[1]})`
      : `${file} (declares ${local[1]}, and does not import the shared decoder)`;
  };

  // ── Positive control ──
  // Plant each shape that has actually escaped this guard and assert it fires.
  // Without these, a regex that later matches NOTHING keeps every run green
  // over a real private copy — the exact failure this block exists to prevent.
  {
    const IMPORT_LINE = "import { decodeEntities } from './_html-entities.mjs';\n";
    const planted = [
      // The senjob escape: singular name, no shared import.
      ['const decodeEntity = (m, r) => m;',
        'x.mjs (declares decodeEntity, and does not import the shared decoder)'],
      // The same name as a function declaration.
      ['function decodeEntity(m) { return m; }',
        'x.mjs (declares decodeEntity, and does not import the shared decoder)'],
      // A re-introduced table rather than a function.
      ['const NAMED_ENTITIES = { amp: "&" };',
        'x.mjs (declares NAMED_ENTITIES, and does not import the shared decoder)'],
      // The original shape: a private copy ALONGSIDE the shared import.
      [IMPORT_LINE + 'function decodeEntities(s) { return s; }',
        'x.mjs (declares decodeEntities)'],
    ];
    const missed = planted.filter(([src, want]) => classifyProvider('x.mjs', src) !== want);
    if (missed.length === 0) {
      pass('positive control: every known-offending shape is still detected');
    } else {
      fail(`guard no longer fires on: ${JSON.stringify(missed.map(([src]) => src.slice(0, 60)))}`);
    }

    // Negative control, so the widened pattern cannot pass by matching
    // everything: importing the shared decoder by destructuring is CORRECT
    // usage and must stay clean.
    const legitimate = IMPORT_LINE + 'const title = decodeEntities(raw);\n';
    if (classifyProvider('x.mjs', legitimate) === null) {
      pass('negative control: importing and calling the shared decoder is not an offence');
    } else {
      fail(`guard flags legitimate usage: ${classifyProvider('x.mjs', legitimate)}`);
    }
  }

  let files;
  try {
    files = readdirSync(dir);
  } catch (e) {
    files = null;
    fail(`cannot read ${dir}: ${e.message}`);
  }

  if (files) {
    const offenders = [];

    for (const file of MIGRATED) {
      let src;
      try {
        src = readFileSync(join(dir, file), 'utf-8');
      } catch (e) {
        offenders.push(`${file} (unreadable: ${e.message})`);
        continue;
      }
      if (!SHARED_IMPORT.test(src)) {
        offenders.push(`${file} (no longer imports the shared decoder)`);
        continue;
      }
      const local = src.match(PRIVATE_DECL);
      if (local) offenders.push(`${file} (declares ${local[1]})`);
    }

    for (const file of files) {
      if (!file.endsWith('.mjs') || file === '_html-entities.mjs') continue;
      if (MIGRATED.includes(file)) continue; // already asserted, and more strictly
      let src;
      try {
        src = readFileSync(join(dir, file), 'utf-8');
      } catch (e) {
        offenders.push(`${file} (unreadable: ${e.message})`);
        continue;
      }
      // NOT `if (!SHARED_IMPORT.test(src)) continue;`. Skipping non-importers
      // is what let senjob through: a brand-new provider that never imports the
      // shared module and simply writes its own decoder is the re-introduction
      // this guard exists to fail on, and it was the one shape it could not
      // see. A provider that declares a decoder is an offender whether or not
      // it also imports the shared one.
      const verdict = classifyProvider(file, src);
      if (verdict) offenders.push(verdict);
    }

    if (offenders.length === 0) {
      pass('no provider both imports the shared decoder and declares a private one');
    } else {
      fail(`private entity decoder re-introduced in: ${offenders.join(', ')}`);
    }
  }
}
