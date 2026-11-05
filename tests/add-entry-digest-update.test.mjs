// tests/add-entry-digest-update.test.mjs — add-entry.mjs `articleDigestUpdate`:
// one dated bullet appended under an existing article-digest entry, every
// other line kept as it was, and the same bullet never added twice (#5677).
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { applyAdd, appendDigestBullet, digestEntries } from '../add-entry.mjs';

console.log('\nadd-entry.mjs — append an update bullet to an existing article-digest entry');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

const DIGEST = [
  '# Article Digest -- Proof Points',
  '',
  '---',
  '',
  '## Widgets — Loader',
  '',
  '**Hero metrics:** 727 of 734 commits',
  '',
  '**Proof points:**',
  '- Rewrote the loader',
  '',
  '---',
  '',
  '## Engine -- Query engine',
  '',
  'A planner for the query engine.',
  '',
  '### Notes',
  '',
  'Benchmarks live elsewhere.',
  '',
].join('\n');
const BULLET = '- Update 2026-10-22: 3 more merged PRs to acme/widgets since 2026-10-15, including #12 "Agent harness"';

/** The text with one line removed, to compare against the original. */
const without = (text, line) => {
  const lines = text.split('\n');
  const i = lines.indexOf(line);
  if (i !== -1) lines.splice(i, 1);
  return lines.join('\n');
};

// ── 1. Entries and placement ────────────────────────────────────────

{
  const entries = digestEntries(DIGEST);
  check(JSON.stringify(entries.map((e) => e.name)) === JSON.stringify(['Widgets', 'Engine']), 'digestEntries: one entry per ## heading, named by the text before the dash');
  check(entries[1].end === DIGEST.split('\n').length, 'digestEntries: a ### heading stays inside its entry');

  const out = appendDigestBullet(DIGEST, 'widgets', BULLET);
  const lines = out.text.split('\n');
  check(out.status === 'appended' && out.entry === 'Widgets', 'appends under the entry the dedupKey names (case- and punctuation-insensitive)');
  check(lines[lines.indexOf('- Rewrote the loader') + 1] === BULLET, 'after a list item: the bullet continues that list');
  check(lines.indexOf(BULLET) < lines.indexOf('## Engine -- Query engine') && lines[lines.indexOf(BULLET) + 2] === '---',
    'the bullet lands at the end of its entry, before the --- separator');
  check(without(out.text, BULLET) === DIGEST, 'every other line is kept byte for byte (existing text is never rewritten)');

  const para = appendDigestBullet(DIGEST, 'Engine', '- Update 2026-10-22: 1 more merged PR to digestco/engine since 2026-10-15');
  const pl = para.text.split('\n');
  const at = pl.indexOf('- Update 2026-10-22: 1 more merged PR to digestco/engine since 2026-10-15');
  check(pl[at - 1] === '' && pl[at - 2] === 'Benchmarks live elsewhere.', 'after a paragraph: a blank line, then the bullet (a ### section inside the entry is included)');
  check(para.text.endsWith('since 2026-10-15\n'), 'the last entry keeps the file\'s trailing newline');
  check(pl.slice(0, at - 1).concat(pl.slice(at + 1)).join('\n') === DIGEST, 'last entry: nothing else changes');

  const bare = appendDigestBullet('## Solo', 'Solo', 'Update 2026-10-22: first update');
  check(bare.text === '## Solo\n\n- Update 2026-10-22: first update', 'an entry with only its heading and no trailing newline gets the bullet, and no newline is added');

  const crlf = DIGEST.replace(/\n/g, '\r\n');
  const c = appendDigestBullet(crlf, 'Widgets', BULLET);
  check(c.text.includes(`- Rewrote the loader\r\n${BULLET}\r\n`) && !/[^\r]\n/.test(c.text), 'a CRLF file keeps CRLF line endings');

  check(appendDigestBullet(DIGEST, 'Gadgets', BULLET).status === 'missing', 'an entry that is not there -> missing, text unchanged');
}

// ── 2. Idempotency ──────────────────────────────────────────────────

{
  const payload = { articleDigestUpdate: { dedupKey: 'Widgets', bullet: BULLET } };
  const cvText = '# CV\n\n## Projects\n\n- **Widgets** -- loader\n';
  const first = applyAdd(payload, { cvText, articleText: DIGEST });
  const second = applyAdd(payload, { cvText, articleText: first.articleDigest });
  check(first.result.articleDigestUpdate.status === 'appended', 'first run: appended');
  check(second.result.articleDigestUpdate.status === 'duplicate' && second.articleDigest === first.articleDigest,
    'the same update twice: the second run is a duplicate and changes nothing');
  check(first.articleDigest.split(BULLET).length === 2, 'the bullet is in the file exactly once');
  const respelled = applyAdd({ articleDigestUpdate: { dedupKey: 'widgets', bullet: `  * ${BULLET.slice(2).replace(/ /g, '  ')}  ` } }, { cvText, articleText: first.articleDigest });
  check(respelled.result.articleDigestUpdate.status === 'duplicate', 'a different list marker or spacing is still the same bullet');
  const other = applyAdd({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: '- Update 2026-10-29: 2 more merged PRs to acme/widgets since 2026-10-22' } }, { cvText, articleText: first.articleDigest });
  check(other.result.articleDigestUpdate.status === 'appended' && other.articleDigest.indexOf(BULLET) < other.articleDigest.indexOf('Update 2026-10-29'),
    'a later, different update is appended after the earlier one');
  check(first.cv === cvText && !('cv' in first.result), 'cv.md is never touched by an update');
}

// ── 3. Guardrails ───────────────────────────────────────────────────

{
  const throws = (payload, articleText, re) => {
    try { applyAdd(payload, { cvText: null, articleText }); return false; } catch (e) { return re.test(e.message); }
  };
  check(throws({ articleDigestUpdate: { dedupKey: 'Gadgets', bullet: BULLET } }, DIGEST, /no entry named "Gadgets"/), 'an update for an entry that is not there fails, naming it');
  check(throws({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: BULLET } }, null, /article-digest\.md not found/), 'no article-digest.md -> fails');
  check(throws({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: '- one\n- two' } }, DIGEST, /one line/), 'a multi-line bullet is rejected');
  check(throws({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: '- ' } }, DIGEST, /one line/), 'an empty bullet is rejected');
  check(throws({ articleDigestUpdate: { dedupKey: '', bullet: BULLET } }, DIGEST, /non-empty dedupKey/), 'a missing dedupKey is rejected');
  const twice = `${DIGEST}\n---\n\n## Widgets -- An older write-up\n\n- Same project, second entry\n`;
  check(appendDigestBullet(twice, 'Widgets', BULLET).status === 'ambiguous'
    && throws({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: BULLET } }, twice, /2 entries named "Widgets"/),
  'two entries with the same name: ambiguous, the update fails and nothing is appended to either');

  const both = applyAdd({
    articleDigest: { dedupKey: 'Gadgets', entry: '## Gadgets — New\n\n- Shipped gadgets' },
    articleDigestUpdate: { dedupKey: 'Gadgets', bullet: '- Update 2026-10-22: first update' },
  }, { cvText: null, articleText: DIGEST });
  check(both.result.articleDigest.status === 'added' && both.result.articleDigestUpdate.status === 'appended'
    && both.articleDigest.endsWith('- Shipped gadgets\n- Update 2026-10-22: first update\n'),
  'one payload can add an entry and then update it');
}

// ── 4. CLI: dry run, write, rerun ───────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'co-add-update-'));
  try {
    const cv = join(dir, 'cv.md');
    const digest = join(dir, 'article-digest.md');
    const cvText = '# CV\n\n## Projects\n\n- **Widgets** -- loader\n';
    writeFileSync(cv, cvText);
    writeFileSync(digest, DIGEST);
    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_CV: cv, CAREER_OPS_ARTICLE_DIGEST: digest };
    const input = JSON.stringify({ articleDigestUpdate: { dedupKey: 'Widgets', bullet: BULLET } });
    const run = (...flags) => spawnSync(NODE, [join(ROOT, 'add-entry.mjs'), '--stdin', ...flags], { input, env, encoding: 'utf8', timeout: 30000 });
    const status = (res) => { try { return JSON.parse(res.stdout).articleDigestUpdate?.status; } catch { return `exit ${res.status}: ${res.stderr.trim()}`; } };

    const dry = run('--dry-run');
    check(dry.status === 0 && status(dry) === 'appended' && readFileSync(digest, 'utf8') === DIGEST, `--dry-run reports appended and writes nothing (got ${status(dry)})`);
    const wrote = run();
    const after = readFileSync(digest, 'utf8');
    check(wrote.status === 0 && status(wrote) === 'appended' && without(after, BULLET) === DIGEST, 'a real run appends the bullet and changes nothing else');
    const again = run();
    check(again.status === 0 && status(again) === 'duplicate' && readFileSync(digest, 'utf8') === after, 'rerunning the same payload is a no-op');
    check(readFileSync(cv, 'utf8') === cvText, 'cv.md is unchanged');
    const missing = spawnSync(NODE, [join(ROOT, 'add-entry.mjs'), '--stdin'], {
      input: JSON.stringify({ articleDigestUpdate: { dedupKey: 'Gadgets', bullet: BULLET } }), env, encoding: 'utf8', timeout: 30000,
    });
    check(missing.status === 1 && /no entry named "Gadgets"/.test(missing.stderr) && readFileSync(digest, 'utf8') === after, 'an unknown entry exits 1 and writes nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
