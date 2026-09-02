/**
 * apply-cv-resolver.test.mjs — regression tests for resolveTailoredCv()
 * (web/src/lib/apply/cv.ts), the resolver behind the apply flow's tailored-CV
 * upload.
 *
 * Before PR #2156's CodeRabbit fixups, this resolver had a loose "first
 * token" fallback that let a multi-word company match a cv-*.pdf that was
 * never tailored for it, and it hand-rolled its own copy of the matching
 * regex that could drift from the twin resolver in
 * web/src/app/api/cv-pdf/route.ts. Both now import the SAME contract from
 * web/src/lib/apply/cv-match.mjs — see that file's header comment.
 *
 * Lives under web/tests/ so the web CI collects it and the core runner never
 * has to know it exists — no test-all.mjs hook, no update-system.mjs
 * registration, and no core-only-install skip guard, because web/ is always
 * present when this suite runs.
 *
 * resolveTailoredCv() is TypeScript that reaches web/src/lib/career-ops via
 * the `@/` path alias (Next's tsconfig paths). Node 22 type-strips .ts on
 * import, but it does NOT understand that alias — `npm test` here is plain
 * `node --test`, with no webpack/SWC in the loop. The tiny inline loader
 * below teaches node:module's resolution hook to resolve `@/*` to web/src/*
 * (with extension probing) for the lifetime of this process. Test-only, no
 * build step, no effect on the real Next build.
 *
 * Run (from web/, as `npm test` does):  node --test tests/lib/apply-cv-resolver.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const ALIAS_EXTS = ['.ts', '.tsx', '.mjs', '.js', '.mts'];
const loaderSrc = [
  "import { existsSync } from 'node:fs';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  `const WEB_SRC = ${JSON.stringify(WEB_SRC)};`,
  `const EXTS = ${JSON.stringify(ALIAS_EXTS)};`,
  'function resolveWithExt(base) {',
  '  for (const ext of EXTS) { if (existsSync(base + ext)) return base + ext; }',
  '  if (existsSync(base)) return base;',
  '  return null;',
  '}',
  'export async function resolve(specifier, context, nextResolve) {',
  "  if (specifier.startsWith('@/')) {",
  '    const rel = specifier.slice(2);',
  '    const base = path.join(WEB_SRC, rel);',
  '    const resolved = resolveWithExt(base);',
  '    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };',
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n');
register('data:text/javascript,' + encodeURIComponent(loaderSrc), pathToFileURL(WEB_SRC + '/'));

const { resolveTailoredCv } = await import('../../src/lib/apply/cv.ts');
const { sortNewestFirst } = await import('../../src/lib/apply/cv-match.mjs');

// Provision a throwaway career-ops root with an output/ dir, redirected via
// the same CAREER_OPS_ROOT override career-ops.ts's careerOpsRoot() reads
// (see web/src/lib/career-ops.ts) — no monkeypatching fs needed.
async function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'cv-resolver-'));
  const outputDir = join(root, 'output');
  mkdirSync(outputDir, { recursive: true });
  for (const [name, mtimeOffsetMs] of files) {
    const p = join(outputDir, name);
    writeFileSync(p, 'stub-pdf-bytes');
    if (mtimeOffsetMs !== undefined) {
      const t = new Date(Date.now() + mtimeOffsetMs);
      utimesSync(p, t, t);
    }
  }
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return await fn(outputDir);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
  }
}

test('resolveTailoredCv: a multi-word company does NOT match a file whose first token happens to be a DIFFERENT, unrelated company (no loose first-token fallback)', async () => {
  await withFixture([['cv-jane-doe-meta-recruiter-2026-01-01.pdf']], async () => {
    // "Meta Platforms" -> slug "meta-platforms". The fixture file was
    // tailored for a company slugged plainly "meta" — a real "first
    // token" fallback would wrongly attach it to a "Meta Platforms"
    // application.
    const result = await resolveTailoredCv('Meta Platforms');
    assert.equal(result, null);
  });
});

test('resolveTailoredCv: "Meta" does not resolve a file for "Metabase" (token-boundary match)', async () => {
  await withFixture([['cv-jane-doe-metabase-engineer-2026-01-01.pdf']], async () => {
    const result = await resolveTailoredCv('Meta');
    assert.equal(result, null);
  });
});

test('resolveTailoredCv: a real cv-<slug>-*.pdf matches its company', async () => {
  await withFixture([['cv-jane-doe-acme-engineer-2026-01-01.pdf']], async (outputDir) => {
    const result = await resolveTailoredCv('Acme');
    assert.equal(result, join(outputDir, 'cv-jane-doe-acme-engineer-2026-01-01.pdf'));
  });
});

test('resolveTailoredCv: newest match wins when multiple CVs exist for the same company', async () => {
  await withFixture(
    [
      ['cv-jane-doe-acme-engineer-2026-01-01.pdf', -60000],
      ['cv-jane-doe-acme-engineer-2026-02-01.pdf', 0],
    ],
    async (outputDir) => {
      const result = await resolveTailoredCv('Acme');
      assert.equal(result, join(outputDir, 'cv-jane-doe-acme-engineer-2026-02-01.pdf'));
    }
  );
});

test('resolveTailoredCv: a cover-*.pdf is never returned, even if newer than the CV', async () => {
  await withFixture(
    [
      ['cv-jane-doe-acme-engineer-2026-01-01.pdf', -60000],
      ['cover-jane-doe-acme-2026-03-01.pdf', 0],
    ],
    async (outputDir) => {
      const result = await resolveTailoredCv('Acme');
      assert.equal(result, join(outputDir, 'cv-jane-doe-acme-engineer-2026-01-01.pdf'));
    }
  );
});

test('sortNewestFirst: drops a file that vanishes between readdir and stat instead of throwing (TOCTOU)', async () => {
  await withFixture([['exists.pdf', 0]], (outputDir) => {
    const result = sortNewestFirst(outputDir, ['exists.pdf', 'vanished-before-stat.pdf']);
    assert.deepEqual(result, [basename(join(outputDir, 'exists.pdf'))]);
  });
});

test('sortNewestFirst: drops a directory entry instead of returning it (readdirSync can list a dir named cv-*.pdf; a caller\'s later readFileSync on that path would 500)', async () => {
  await withFixture([['exists.pdf', 0]], (outputDir) => {
    mkdirSync(join(outputDir, 'cv-not-a-file.pdf'));
    const result = sortNewestFirst(outputDir, ['exists.pdf', 'cv-not-a-file.pdf']);
    assert.deepEqual(result, [basename(join(outputDir, 'exists.pdf'))]);
  });
});
