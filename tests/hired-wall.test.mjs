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
