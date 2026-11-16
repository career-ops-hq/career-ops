// tests/hired-wall.test.mjs — the Hired Wall's promises, pinned.
//
// The wall makes three public claims (HIRED.md header): count == entries,
// numbers are permanent, and privacy levels render what they say they render.
// Plus the storage boundary: untrusted issue fields cannot break the ledger
// comment or smuggle markup into the card/SVG. Each claim gets an assertion
// here so the next refactor cannot quietly soften a public promise.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT } from './helpers.mjs';
import { parseLedger, ledgerLine, renderCard, rebuildWall, buildSvg } from '../hired-wall-build.mjs';
const wallApi = await import('../hired-wall-build.mjs');
import { hiredRows, weeksFromScanHistory, buildIssueUrl } from '../hired-share.mjs';

console.log('\nHired Wall — ledger, cards, SVG, share flow');

const FIXTURE_AVATAR = join(ROOT, 'tests', 'fixtures', 'avatar-8x8.png');

// ── ledger round-trip ────────────────────────────────────────────────────────
{
  const e = { n: 7, level: 'handle', handle: 'someone', role: 'ML Engineer', sector: 'Fintech', geo: 'remote EU', weeks: 6, link: 'https://github.com/career-ops-hq/career-ops/issues/9', withdrawn: false };
  const parsed = parseLedger(ledgerLine(e))[0];
  if (parsed && parsed.n === 7 && parsed.handle === 'someone' && parsed.weeks === 6 && parsed.role === 'ML Engineer' && parsed.sector === 'Fintech') {
    pass('ledger line round-trips through parseLedger');
  } else fail(`ledger round-trip lost data: ${JSON.stringify(parsed)}`);
}

// ── privacy levels render what they promise ─────────────────────────────────
{
  const roleCard = renderCard({ n: 2, level: 'role', handle: 'leakyname', role: 'PM', geo: 'Berlin', weeks: 4, link: 'https://github.com/x/y/issues/1', story: 'hi' });
  if (!roleCard.includes('leakyname')) pass('role-level card never shows the handle');
  else fail('role-level card LEAKED the handle — privacy level 2 broken');

  const countCard = renderCard({ n: 3, level: 'count', handle: 'x', role: 'Dev', link: 'https://github.com/x/y/issues/2' });
  if (countCard.includes('kept private') && !countCard.includes('Dev')) pass('count-level entry shows no card content at all');
  else fail(`count-level entry leaked content: ${countCard}`);

  const withdrawn = renderCard({ n: 4, level: 'handle', handle: 'gone', role: 'X', link: 'https://github.com/x/y/issues/3', withdrawn: true, story: 'secret' });
  if (withdrawn.includes('withdrawn') && !withdrawn.includes('secret') && !withdrawn.includes('gone')) {
    pass('withdrawn entry keeps its number and drops story and identity');
  } else fail(`withdrawn entry leaked: ${withdrawn}`);
}

// ── count == entries, and rebuild preserves stories ─────────────────────────
{
  const wall = ['# Wall', '', '<!-- ENTRIES -->', '',
    ledgerLine({ n: 1, level: 'handle', handle: 'a', role: 'Dev', link: 'https://github.com/x/y/issues/1' }), '> first story',
    ledgerLine({ n: 2, level: 'count', role: 'PM', link: 'https://github.com/x/y/issues/2' }), '',
    '<!-- /ENTRIES -->'].join('\n');
  const { text, entries } = rebuildWall(wall);
  if (entries.length === 2) pass('count equals ledger entries (count-level included)');
  else fail(`expected 2 entries, got ${entries.length}`);
  if (text.includes('> first story')) pass('rebuild preserves the story quote verbatim');
  else fail('rebuild dropped the story quote');
  const again = rebuildWall(text);
  if (again.text === text) pass('rebuild is idempotent');
  else fail('rebuild is not idempotent — second pass changed the file');
}

// ── SVG: fixture avatar inlined, XML escaped, placeholders on short walls ───
{
  const entries = [{ n: 1, level: 'handle', handle: 'a', role: 'Dev <script>', geo: 'ES & EU', weeks: 5, link: 'https://github.com/x/y/issues/1', story: 'quotes "and" <tags> survive & escape' }];
  const svg = await buildSvg(entries, { fixture: FIXTURE_AVATAR });
  if (svg.includes('data:image/png;base64,')) pass('avatar is inlined as a base64 data URI (GitHub sanitizes external refs)');
  else fail('SVG has no inlined avatar');
  if (!svg.includes('<script>') && svg.includes('&amp;')) pass('SVG escapes untrusted text');
  else fail('SVG carries unescaped untrusted text');
  if ((svg.match(/The next card is yours/g) || []).length === 2) pass('short wall renders invitation placeholders for empty slots');
  else fail('placeholder slots missing on a 1-entry wall');
}

// ── the storage boundary: --add sanitizes hostile fields end-to-end ─────────
{
  const dir = mkdtempSync(join(tmpdir(), 'hired-wall-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'HIRED.md'), '# W\n\n<!-- ENTRIES -->\n\n<!-- /ENTRIES -->\n');
  execFileSync(process.execPath, [join(ROOT, 'hired-wall-build.mjs'), '--add',
    '--root', dir, '--level', 'role',
    '--role', 'Dev" --> <img onerror=x>', '--story', 'a "quoted" story --> with terminators',
    '--link', 'https://github.com/career-ops-hq/career-ops/issues/99',
    '--avatar-fixture', FIXTURE_AVATAR]);
  const out = readFileSync(join(dir, 'HIRED.md'), 'utf8');
  const entries = parseLedger(out);
  // The danger is live markup: after clean() the angle brackets are gone, so
  // the WORD "onerror" may survive as inert text. Assert no tag can render.
  const storedSection = (out.split('<!-- ENTRIES -->')[1] ?? '')
    .replace(/<!-- hire [^>]*-->|<!-- \/ENTRIES -->/g, '')
    .replace(/<a href="https:\/\/github\.com[^>]*>|<img src="https:\/\/github\.com[^>]*>|<\/a>/g, '');
  if (entries.length === 1 && !storedSection.includes('<')) {
    pass('hostile role/story fields are neutralized before storage');
  } else fail(`hostile fields survived: entries=${entries.length}`);
  const count = JSON.parse(readFileSync(join(dir, 'docs', 'hired-count.json'), 'utf8')).count;
  if (count === 1) pass('count JSON tracks the ledger');
  else fail(`count JSON says ${count}, ledger has 1`);
  // A non-allowlisted link must be refused entirely.
  let refused = false;
  try {
    execFileSync(process.execPath, [join(ROOT, 'hired-wall-build.mjs'), '--add', '--root', dir,
      '--level', 'role', '--role', 'X', '--link', 'https://evil.example/phish',
      '--avatar-fixture', FIXTURE_AVATAR], { stdio: 'pipe' });
  } catch { refused = true; }
  const after = parseLedger(readFileSync(join(dir, 'HIRED.md'), 'utf8'));
  if (refused && after.length === 1) pass('non-github/santifer.io link is refused');
  else fail('a foreign link was accepted into the ledger');
  rmSync(dir, { recursive: true, force: true });
}

// ── writing is opt-in: no --rebuild/--add means no writes (#4896) ───────────
{
  const dir = mkdtempSync(join(tmpdir(), 'hired-wall-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const wall = '# W\n\n<!-- ENTRIES -->\n\n<!-- /ENTRIES -->\n';
  const countJson = '{\n  "count": 0,\n  "updatedAt": "2000-01-01"\n}\n';
  writeFileSync(join(dir, 'HIRED.md'), wall);
  writeFileSync(join(dir, 'docs', 'hired-count.json'), countJson);
  writeFileSync(join(dir, 'docs', 'hired-wall.svg'), 'old-svg');
  const unchanged = () => readFileSync(join(dir, 'HIRED.md'), 'utf8') === wall
    && readFileSync(join(dir, 'docs', 'hired-count.json'), 'utf8') === countJson
    && readFileSync(join(dir, 'docs', 'hired-wall.svg'), 'utf8') === 'old-svg';
  for (const extra of [[], ['--fetch-avatars']]) {
    let refused = false;
    try {
      execFileSync(process.execPath, [join(ROOT, 'hired-wall-build.mjs'), '--root', dir, ...extra], { stdio: 'pipe' });
    } catch { refused = true; }
    const label = ['--root', ...extra].join(' ');
    if (refused && unchanged()) pass(`no action flag (${label}) exits non-zero and writes nothing`);
    else fail(`no action flag (${label}): refused=${refused}, files unchanged=${unchanged()}`);
  }
  execFileSync(process.execPath, [join(ROOT, 'hired-wall-build.mjs'), '--rebuild', '--root', dir], { stdio: 'pipe' });
  if (readFileSync(join(dir, 'docs', 'hired-wall.svg'), 'utf8').startsWith('<svg')) pass('--rebuild still writes the derived surfaces');
  else fail('--rebuild did not regenerate docs/hired-wall.svg');
  rmSync(dir, { recursive: true, force: true });
}

// ── share flow: tracker detection, weeks math, prefilled URL ────────────────
{
  const tracker = ['| # | Fecha | Empresa | Puesto | Score | Estado | PDF | Report | Notas |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-08-20 | Acme | Data Engineer | 4.5 | Hired | ✅ | [12](reports/12.md) | — |',
    '| 2 | 2026-08-21 | Beta | PM | 3.9 | Applied | ❌ | [13](reports/13.md) | — |'].join('\n');
  const rows = hiredRows(tracker);
  if (rows.length === 1 && rows[0].report === '12' && rows[0].role === 'Data Engineer') {
    pass('hiredRows finds exactly the Hired tracker rows');
  } else fail(`hiredRows: ${JSON.stringify(rows)}`);

  const weeks = weeksFromScanHistory('2026-07-01\tx\ty\n2026-07-15\tx\ty\n', '2026-08-20');
  if (weeks === 7) pass('weeks derive from the EARLIEST scan date (7 weeks)');
  else fail(`weeks math wrong: ${weeks}`);

  const url = buildIssueUrl({ role: 'Data Engineer', story: 'a & b', feature: '', timeToHire: '7 weeks', anonymity: 'role' });
  if (url.startsWith('https://github.com/career-ops-hq/career-ops/issues/new?') &&
      url.includes('template=i-got-hired.yml') &&
      url.includes('anonymity=Role+and+location+only') &&
      url.includes('story=a+%26+b')) {
    pass('prefilled issue URL carries template, anonymity option text and encoded story');
  } else fail(`prefilled URL malformed: ${url}`);
}

// ── the handle lane: the one field the storage boundary left unescaped ──────
// A hostile handle cannot arrive through `--add` (it strips the charset at
// ingest), but the ledger is a hand-editable file and `--rebuild` re-renders
// whatever it holds. renderCard escaped every sibling field and interpolated
// this one raw into href/src/alt, and avatarDataUri put it into a URL path.
{
  const hostile = 'x"><img src=y onerror=1>';
  const card = renderCard({ n: 9, level: 'handle', handle: hostile, role: 'Dev', link: 'https://github.com/a/b/issues/1' });
  // The credited card legitimately contains ONE avatar <img>; what must not
  // survive is the injected tag or attribute. Assert the injected payload, not
  // the presence of an image.
  if (!card.includes('onerror=') && !card.includes('<img src=y') && (card.match(/<img /g) || []).length === 1) {
    pass('a handle carrying markup cannot render into the card');
  } else fail(`hostile handle survived into the card: ${card}`);

  // The ledger's handle field is `[^\s]+`, so a payload carrying a space cannot
  // survive the format at all; the reachable case is a whitespace-free one.
  const ledgerHostile = 'x"><img/src=y/onerror=1>';
  const rebuilt = parseLedger(ledgerLine({ n: 10, level: 'handle', handle: ledgerHostile, role: 'Dev', link: 'https://github.com/a/b/issues/2' }))[0];
  const rebuiltCard = rebuilt ? renderCard(rebuilt) : '';
  if (rebuiltCard && !rebuiltCard.includes('onerror=') && !rebuiltCard.includes('<img src=y')) {
    pass('a rebuild from a hostile ledger line re-renders neutrally');
  } else fail(`rebuild re-emitted hostile markup from the ledger: ${JSON.stringify(rebuiltCard)}`);

  // A well-formed handle must still produce a working link — the fix is a
  // charset rule, not the removal of the credited card.
  const good = renderCard({ n: 11, level: 'handle', handle: 'octocat', role: 'Dev', link: 'https://github.com/a/b/issues/3' });
  if (good.includes('href="https://github.com/octocat"') && good.includes('**@octocat**')) pass('a valid handle still renders as a credited card');
  else fail(`valid handle lost its card: ${good}`);

  // The URL lane: nothing that changes the requested path or query may survive.
  if (typeof wallApi.avatarUrl !== 'function') {
    fail('avatarUrl is not exported, so the avatar request URL cannot be asserted');
  } else {
    const url = wallApi.avatarUrl('a/b?c#d');
    const injected = wallApi.avatarUrl('x"><img src=y onerror=1>');
    if (url === 'https://github.com/abcd.png?size=64' && injected === 'https://github.com/ximgsrcyonerror1.png?size=64') {
      pass('the avatar URL is built from the sanitized handle only');
    } else fail(`avatar URL kept separators: ${url} / ${injected}`);
  }
}

// ── one identity for every surface: the card and the README strip agree ─────
// The strip used to print the raw field while the avatar beside it used the
// sanitized one, so a credited card could read @a/b?c#d next to a picture of
// abcd, and an entry whose handle sanitized away showed a bare @ in the strip
// while its markdown card fell back to the role.
{
  const handle = 'a/b?c#d';
  const svg = await buildSvg([{ n: 12, level: 'handle', handle, role: 'Data Engineer', geo: 'remote EU', link: 'https://github.com/a/b/issues/4' }], { fetchAvatars: false });
  if (svg.includes('@abcd') && !svg.includes('a/b?c#d')) pass('the strip credits the same sanitized login the card does');
  else fail(`strip label disagrees with the sanitized handle: ${svg.slice(0, 400)}`);

  const degenerate = await buildSvg([{ n: 13, level: 'handle', handle: '///', role: 'Data Engineer', sector: 'Fintech', link: 'https://github.com/a/b/issues/5' }], { fetchAvatars: false });
  if (degenerate.includes('Data Engineer') && degenerate.includes('Fintech') && !degenerate.includes('@')) {
    pass('a handle that sanitizes away falls back to the role in the strip, as the card does');
  } else fail(`strip did not fall back to the role: ${degenerate.slice(0, 400)}`);

  const card = renderCard({ n: 14, level: 'handle', handle: '///', role: 'Data Engineer', sector: 'Fintech', link: 'https://github.com/a/b/issues/6' });
  if (card.includes('**Data Engineer**') && card.includes('Fintech')) pass('the card falls back to role and sector together, without repeating the role');
  else fail(`card fallback is inconsistent: ${card}`);
}
