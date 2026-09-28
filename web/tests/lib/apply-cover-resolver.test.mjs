/**
 * apply-cover-resolver.test.mjs — regression tests for resolveTailoredCover()
 * (web/src/lib/apply/cover.ts), the resolver behind the pipeline page's
 * "View cover" link and /api/cover-pdf.
 *
 * Two classes of bug are pinned here.
 *
 * 1. WHAT A COVER LETTER IS CALLED. The writers name covers by SUFFIX —
 *    generate-cover-letter.mjs's default is `{company}-{role}-cover.pdf` and
 *    modes/cover.md's payload is `output/{company-slug}-{role-slug}-cover.pdf`.
 *    A `cover-` PREFIX filter (the shape this resolver was first written with)
 *    matches none of them, so the link would never appear for a real user.
 *    The contract is a `cover` TOKEN plus an explicit `cv-` exclusion, both in
 *    web/src/lib/apply/cv-match.mjs.
 *
 * 2. WHICH APPLICATION A COVER BELONGS TO. #2599 established that resolving a
 *    tailored artifact by company ALONE is a bug: two applications at the same
 *    company get the newest file, not their own. resolveTailoredCv fixed that
 *    for CVs via data/pdf-index.tsv. That manifest cannot carry a cover — its
 *    header is `# report\tpdf\thtml\tformat\tdate` with no kind column, and
 *    updatePDFManifest drops any existing row for a report number, so a cover
 *    generated with --report N EVICTS that report's CV row (#3887). Resolving a
 *    cover through it would sometimes hand back the CV. So the application path
 *    scopes on the tracker row's own company AND role instead, and returns null
 *    rather than guessing.
 *
 * Lives under web/tests/ so the web CI collects it and the core runner never
 * has to know it exists — no test-all.mjs hook, no update-system.mjs
 * registration, and no core-only-install skip guard, because web/ is always
 * present when this suite runs. Same reasoning as apply-cv-resolver.test.mjs;
 * see that file's header.
 *
 * resolveTailoredCover() is TypeScript that reaches web/src/lib/career-ops via
 * the `@/` path alias (Next's tsconfig paths). Node 22 type-strips .ts on
 * import, but it does NOT understand that alias — `npm test` here is plain
 * `node --test`, with no webpack/SWC in the loop. The tiny inline loader below
 * teaches node:module's resolution hook to resolve `@/*` to web/src/* (with
 * extension probing) for the lifetime of this process. Test-only, no build
 * step, no effect on the real Next build.
 *
 * Run (from web/, as `npm test` does):  node --test tests/lib/apply-cover-resolver.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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

const { resolveTailoredCover } = await import('../../src/lib/apply/cover.ts');
const { matchesTailoredCover } = await import('../../src/lib/apply/cv-match.mjs');

/**
 * Provision a throwaway career-ops root with an output/ dir, redirected via the
 * same CAREER_OPS_ROOT override careerOpsRoot() reads (see
 * web/src/lib/career-ops.ts) — no monkeypatching fs needed.
 *
 * `rows` (optional) are written as data/applications.md in the legacy fixed
 * column order parseApplications falls back to, so the applicationNumber path
 * has a real tracker to join against.
 */
async function withFixture(files, fn, rows) {
  const root = mkdtempSync(join(tmpdir(), 'cover-resolver-'));
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
  if (rows) {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(
      join(root, 'data', 'applications.md'),
      [
        '# Applications Tracker',
        '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        ...rows.map(
          ({ n, company, role }) =>
            `| ${n} | 2026-01-01 | ${company} | ${role} | 4.5/5 | Applied | ✅ | [${n}](../reports/${n}-x-2026-01-01.md) | |`
        ),
        '',
      ].join('\n')
    );
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

// --- what a cover letter is called -----------------------------------------

test('resolveTailoredCover: resolves the name the writers actually produce, {company}-{role}-cover.pdf (a cover- PREFIX filter finds nothing real)', async () => {
  await withFixture([['acme-vp-marketing-cover.pdf']], async (outputDir) => {
    const result = await resolveTailoredCover('Acme');
    assert.equal(result, join(outputDir, 'acme-vp-marketing-cover.pdf'));
  });
});

test('resolveTailoredCover: a cv-*.pdf is never returned as a cover, even when it is newer and carries a "cover" token', async () => {
  await withFixture(
    [
      ['acme-vp-marketing-cover.pdf', -60000],
      ['cv-jane-doe-acme-cover-letter-writer-2026-03-01.pdf', 0],
    ],
    async (outputDir) => {
      const result = await resolveTailoredCover('Acme');
      assert.equal(result, join(outputDir, 'acme-vp-marketing-cover.pdf'));
    }
  );
});

test('resolveTailoredCover: a PDF in output/ that is not a cover at all (an archived JD capture) is never returned', async () => {
  await withFixture([['2026-01-01_acme_vp-marketing.pdf']], async () => {
    const result = await resolveTailoredCover('Acme');
    assert.equal(result, null);
  });
});

test('resolveTailoredCover: "Acme" does not resolve "Acmecorp"\'s cover (token-boundary match)', async () => {
  await withFixture([['acmecorp-engineer-cover.pdf']], async () => {
    const result = await resolveTailoredCover('Acme');
    assert.equal(result, null);
  });
});

test('resolveTailoredCover: a punctuation-only company slugs to nothing and resolves nothing, rather than matching every cover in output/', async () => {
  await withFixture([['acme-vp-marketing-cover.pdf']], async () => {
    const result = await resolveTailoredCover('!!!');
    assert.equal(result, null);
  });
});

test('resolveTailoredCover: newest match wins when a company has several covers and no application number narrows it', async () => {
  await withFixture(
    [
      ['acme-vp-marketing-cover.pdf', -60000],
      ['acme-head-of-growth-cover.pdf', 0],
    ],
    async (outputDir) => {
      const result = await resolveTailoredCover('Acme');
      assert.equal(result, join(outputDir, 'acme-head-of-growth-cover.pdf'));
    }
  );
});

// --- which application a cover belongs to (#2599's rule, applied to covers) --

test('resolveTailoredCover: with an application number, a second application at the SAME company gets ITS OWN cover, not the company\'s newest', async () => {
  await withFixture(
    [
      ['acme-vp-marketing-cover.pdf', -60000],
      ['acme-head-of-growth-cover.pdf', 0],
    ],
    async (outputDir) => {
      // Row 12 is the OLDER of the two covers. Resolving by company alone —
      // the shape #2599 removed from the CV resolver — would hand back
      // acme-head-of-growth-cover.pdf here.
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, join(outputDir, 'acme-vp-marketing-cover.pdf'));
    },
    [
      { n: '12', company: 'Acme', role: 'VP Marketing' },
      { n: '40', company: 'Acme', role: 'Head of Growth' },
    ]
  );
});

test('resolveTailoredCover: with an application number, a cover that identifies no role on this row resolves nothing rather than the wrong application\'s cover', async () => {
  await withFixture(
    [['acme-head-of-growth-cover.pdf']],
    async () => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, null);
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }]
  );
});

test('resolveTailoredCover: an application number naming no tracker row resolves nothing (never falls back to the company scan)', async () => {
  await withFixture(
    [['acme-vp-marketing-cover.pdf']],
    async () => {
      const result = await resolveTailoredCover('Acme', '99');
      assert.equal(result, null);
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }]
  );
});

test('resolveTailoredCover: matches the role slug generate-cover-letter.mjs truncated to 30 chars when building the default filename', async () => {
  // "senior-director-of-product-marketing" is 36 chars; the writer's
  // `.slice(0, 30)` emits "senior-director-of-product-mar".
  await withFixture(
    [['acme-senior-director-of-product-mar-cover.pdf']],
    async (outputDir) => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, join(outputDir, 'acme-senior-director-of-product-mar-cover.pdf'));
    },
    [{ n: '12', company: 'Acme', role: 'Senior Director of Product Marketing' }]
  );
});

// --- the shared matching contract -------------------------------------------

test('matchesTailoredCover: requires a cover token, excludes cv-, and honours the token boundary', () => {
  assert.equal(matchesTailoredCover('acme-vp-marketing-cover.pdf', 'acme'), true);
  assert.equal(matchesTailoredCover('acme-cover-letter.pdf', 'acme'), true);
  assert.equal(matchesTailoredCover('cv-jane-doe-acme-cover.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('acme-vp-marketing.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('acmecorp-engineer-cover.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('acme-vp-marketing-cover.pdf', ''), false);
});
