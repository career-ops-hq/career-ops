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
 *    for CVs via data/pdf-index.tsv. Since #3959 that manifest keys each row on
 *    report number AND artifact kind, so a tracker row's cover is looked up
 *    there first, by report number and kind "cover": the recorded file wins
 *    whatever it is called, and the report's CV row is never returned as its
 *    cover. Without a cover row, the application path scopes on the tracker
 *    row's own company AND role, and returns null rather than guessing.
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
 *
 * `manifest` (optional) is a list of data/pdf-index.tsv lines. With it, a stub
 * tracker-utils.mjs stands in for the code checkout pdf-index.ts loads the
 * manifest path from (web CI installs web dependencies alone, so the real core
 * module is not importable); the temp dir is both roots. Without it the code
 * root still points at the temp dir, where no tracker-utils.mjs exists, so the
 * manifest lookup finds nothing and the filename match decides.
 */
async function withFixture(files, fn, rows, manifest) {
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
          ({ n, company, role, reportCell }) =>
            `| ${n} | 2026-01-01 | ${company} | ${role} | 4.5/5 | Applied | ✅ | ${reportCell ?? `[${n}](../reports/${n}-x-2026-01-01.md)`} | |`
        ),
        '',
      ].join('\n')
    );
  }
  for (const { n, reportFile } of rows ?? []) {
    if (!reportFile) continue;
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(join(root, 'reports', reportFile), `# Report ${n}\n`);
  }
  if (manifest) {
    mkdirSync(join(root, 'data'), { recursive: true });
    // Static source: both paths derive from the arguments pdf-index.ts passes
    // (the data root, then the tracker path), so no fixture value is spliced
    // into the module text.
    writeFileSync(join(root, 'tracker-utils.mjs'), [
      "import path from 'node:path';",
      "export const resolveTrackerPath = (rootDir) => path.join(rootDir, 'data', 'applications.md');",
      "export const resolvePdfIndexPath = (trackerPath) => path.join(path.dirname(trackerPath), 'pdf-index.tsv');",
    ].join('\n'));
    writeFileSync(join(root, 'data', 'pdf-index.tsv'), manifest.join('\n') + '\n');
  }
  const prev = process.env.CAREER_OPS_ROOT;
  const prevCode = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  try {
    return await fn(outputDir);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    if (prevCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = prevCode;
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

// --- the report -> PDF manifest (#3959: one row per report AND kind) --------

const MANIFEST_HEADER = '# report\tpdf\thtml\tformat\tdate\tkind - written by generate-pdf.mjs, do not edit';

test('resolveTailoredCover: with an application number, the manifest\'s cover row wins even when its filename carries no role slug', async () => {
  // A cover written with --out to a name of the user's choosing: the filename
  // match alone finds nothing here, since "letter" is not the role slug.
  await withFixture(
    [['acme-letter-cover.pdf', -60000], ['acme-vp-marketing-cover.pdf', 0]],
    async (outputDir) => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, join(outputDir, 'acme-letter-cover.pdf'));
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }],
    [
      MANIFEST_HEADER,
      '12\toutput/cv-jane-doe-acme-2026-01-01.pdf\t\tletter\t2026-01-01\tcv',
      '12\toutput/acme-letter-cover.pdf\t\tletter\t2026-01-01\tcover',
    ]
  );
});

test('resolveTailoredCover: the same report\'s CV row is never returned as its cover', async () => {
  await withFixture(
    [['cv-jane-doe-acme-2026-01-01.pdf']],
    async () => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, null);
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }],
    [MANIFEST_HEADER, '12\toutput/cv-jane-doe-acme-2026-01-01.pdf\t\tletter\t2026-01-01\tcv']
  );
});

test('resolveTailoredCover: with no cover row in the manifest, the filename match still resolves this row\'s cover', async () => {
  await withFixture(
    [['cv-jane-doe-acme-2026-01-01.pdf'], ['acme-vp-marketing-cover.pdf']],
    async (outputDir) => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, join(outputDir, 'acme-vp-marketing-cover.pdf'));
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }],
    [MANIFEST_HEADER, '12\toutput/cv-jane-doe-acme-2026-01-01.pdf\t\tletter\t2026-01-01\tcv']
  );
});

test('resolveTailoredCover: a cover row pointing outside output/ resolves nothing rather than widening to the filename match', async () => {
  await withFixture(
    [['acme-vp-marketing-cover.pdf']],
    async () => {
      const result = await resolveTailoredCover(undefined, '12');
      assert.equal(result, null);
    },
    [{ n: '12', company: 'Acme', role: 'VP Marketing' }],
    [MANIFEST_HEADER, '12\treports/012-acme-2026-01-01.md\t\tletter\t2026-01-01\tcover']
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

test('matchesTailoredCover: an over-budget draft beside the cover is never the cover', () => {
  // generate-pdf.mjs keeps a render that ran over its page budget as
  // {name}.overflow.pdf (then .overflow-2.pdf, ...) next to the real path, and
  // writes it after the deliverable, so newest-first would pick it.
  assert.equal(matchesTailoredCover('acme-vp-marketing-cover.overflow.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('acme-vp-marketing-cover.overflow-2.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('acme-vp-marketing-cover.pdf', 'acme'), true);
});

test('matchers: report-leading names from lib/output-names.mjs (#6667)', async () => {
  const { matchesTailoredCv, matchesTailoredCover } = await import('../../src/lib/apply/cv-match.mjs');
  // The new layout: {NNN}-{company}-{kind}-{candidate}-{date}.pdf
  assert.equal(matchesTailoredCv('024-zep-cv-avery-quinn-2026-11-07.pdf', 'zep'), true);
  assert.equal(matchesTailoredCover('024-zep-cv-avery-quinn-2026-11-07.pdf', 'zep'), false);
  assert.equal(matchesTailoredCover('024-zep-cover-avery-quinn-2026-11-07.pdf', 'zep'), true);
  assert.equal(matchesTailoredCv('024-zep-cover-avery-quinn-2026-11-07.pdf', 'zep'), false);
  // buildOutputName refuses a name with a cv/cover word in a slug, so a standard
  // name has one kind token and a name with two is not one this repo wrote:
  // neither matcher claims it, whatever slug the tracker gives.
  for (const [name, slug] of [
    ['024-acme-cv-tools-cover-jane-smith-2026-11-07.pdf', 'acme-cv-tools'],
    ['024-acme-cv-tools-cover-jane-smith-2026-11-07.pdf', 'acme'],
    ['024-acme-cv-cover-dana-2026-11-07.pdf', 'acme'],
    ['024-zep-cover-robin-cover-jones-2026-11-07.pdf', 'zep'],
  ]) {
    assert.equal(matchesTailoredCv(name, slug), false, name);
    assert.equal(matchesTailoredCover(name, slug), false, name);
  }
  // The company match is exact (cv.ts, #2352): Acme does not claim Acme Bank,
  // and a tracker slug that is only the front of the company finds nothing.
  assert.equal(matchesTailoredCv('024-acme-bank-cv-jane-smith-2026-11-07.pdf', 'acme'), false);
  assert.equal(matchesTailoredCover('024-acme-bank-cover-jane-smith-2026-11-07.pdf', 'acme'), false);
  assert.equal(matchesTailoredCv('330-veeva-systems-cv-robin-jones-2026-11-07.pdf', 'veeva'), false);
  assert.equal(matchesTailoredCv('330-veeva-systems-cv-robin-jones-2026-11-07.pdf', 'veeva-systems'), true);
  // The company is a prefix match: a candidate called Zep is not the company.
  assert.equal(matchesTailoredCv('024-acme-cv-zep-smith-2026-11-07.pdf', 'zep'), false);
  assert.equal(matchesTailoredCover('024-acme-cover-zep-smith-2026-11-07.pdf', 'zep'), false);
  assert.equal(matchesTailoredCv('024-acme-cv-robin-jones-2026-11-07.pdf', 'robin'), false);
  // Variants, drafts and other companies keep their existing behavior.
  assert.equal(matchesTailoredCv('024-zep-cv-avery-quinn-2026-11-07-ats.pdf', 'zep'), true);
  assert.equal(matchesTailoredCv('024-zep-cv-avery-quinn-2026-11-07.overflow.pdf', 'zep'), false);
  assert.equal(matchesTailoredCv('024-zepellin-cv-avery-quinn-2026-11-07.pdf', 'zep'), false);
  assert.equal(matchesTailoredCv('cv-avery-quinn-zep-2026-11-07.pdf', 'zep'), true);
  // An accented company slugs the same way here as in lib/output-names.mjs.
  const { companySlug } = await import('../../src/lib/company-slug.mjs');
  const { kebab } = await import('../../../lib/output-names.mjs');
  assert.equal(companySlug('Zoë Café').slug, kebab('Zoë Café'));
  assert.equal(matchesTailoredCv('031-zoe-cafe-cv-dana-quinn-2026-11-09.pdf', companySlug('Zoë Café').slug), true);
});

test('matchers agree with buildOutputName for every name it will write (#6667)', async () => {
  const { buildOutputName } = await import('../../../lib/output-names.mjs');
  const { kebab } = await import('../../../lib/output-names.mjs');
  const { matchesTailoredCv, matchesTailoredCover, standardKind } = await import('../../src/lib/apply/cv-match.mjs');
  const companies = ['Acme', 'CV Tools', 'Cover Systems', 'Cover Genius', 'The CV Centre', 'Zoë Café'];
  const candidates = ['Jane Smith', 'Jane Cover', 'Cover Dana', 'Robin Cv Jones'];
  let built = 0;
  let refused = 0;
  const bad = [];
  for (const company of companies) {
    for (const candidate of candidates) {
      for (const kind of ['cv', 'cover']) {
        let name;
        try {
          name = buildOutputName({ report: 24, company, kind, candidate, date: '2026-11-07' });
        } catch {
          refused += 1;
          continue;
        }
        built += 1;
        const slug = kebab(company);
        const wantCv = kind === 'cv';
        if (standardKind(name) !== kind) bad.push(`${name} -> kind ${standardKind(name)}`);
        if (matchesTailoredCv(name, slug) !== wantCv) bad.push(`${name} cv-match`);
        if (matchesTailoredCover(name, slug) !== !wantCv) bad.push(`${name} cover-match`);
      }
    }
  }
  assert.deepEqual(bad, []);
  // Both sides are exercised: names with kind words at the edges are written
  // and read back, and the ones with a kind word inside a slug are refused.
  assert.ok(built > 0 && refused > 0, `built=${built} refused=${refused}`);
  for (const [company, candidate, kind] of [['Cover Systems', 'Jane Smith', 'cover'], ['Acme', 'Jane Cover', 'cover'], ['Cover Genius', 'Dana Quinn', 'cover'], ['CV Tools', 'Jane Smith', 'cover']]) {
    const name = buildOutputName({ report: 24, company, kind, candidate, date: '2026-11-07' });
    assert.equal(standardKind(name), kind, name);
  }
});

test('an accented company is found under both its folded and its legacy slug', async () => {
  const { companySlug } = await import('../../src/lib/company-slug.mjs');
  const { matchesTailoredCover, matchesTailoredCv, matchesCompanyKeys } = await import('../../src/lib/apply/cv-match.mjs');
  const key = companySlug('Zoë Café');
  assert.deepEqual(key.keys, ['zoe-cafe', 'zo-caf']);
  const anyKey = (match, name) => matchesCompanyKeys(match, name, key.keys);
  // The standard name uses the folded slug; covers written without --report and
  // older CVs carry the slug that dropped the accented letters.
  assert.equal(anyKey(matchesTailoredCover, '031-zoe-cafe-cover-dana-quinn-2026-11-09.pdf'), true);
  assert.equal(anyKey(matchesTailoredCover, 'zo-caf--engineer-cover.pdf'), true);
  assert.equal(anyKey(matchesTailoredCv, 'cv-dana-quinn-zo-caf-2026-11-09.pdf'), true);
  assert.equal(anyKey(matchesTailoredCover, 'acme-engineer-cover.pdf'), false);
  // An unaccented company has a single key.
  assert.deepEqual(companySlug('Acme Co').keys, ['acme-co']);
});

test('a legacy key never claims a standard-layout file or a kind word (#6667)', async () => {
  const { companySlug } = await import('../../src/lib/company-slug.mjs');
  const { matchesTailoredCover, matchesTailoredCv, matchesCompanyKeys } = await import('../../src/lib/apply/cv-match.mjs');
  // "Café" has the legacy key "caf"; the company CAF owns this standard name.
  const cafe = companySlug('Café');
  assert.deepEqual(cafe.keys, ['cafe', 'caf']);
  assert.equal(matchesCompanyKeys(matchesTailoredCv, '031-caf-cv-dana-quinn-2026-11-09.pdf', cafe.keys), false);
  assert.equal(matchesCompanyKeys(matchesTailoredCover, '031-caf-cover-dana-quinn-2026-11-09.pdf', cafe.keys), false);
  assert.equal(matchesCompanyKeys(matchesTailoredCv, '031-cafe-cv-dana-quinn-2026-11-09.pdf', cafe.keys), true);
  // A legacy key that is a kind word is dropped, so "CVé" cannot pick up any cv-*.pdf.
  assert.deepEqual(companySlug('CVé').keys, ['cve']);
  assert.deepEqual(companySlug('Coveré').keys, ['covere']);
  assert.equal(matchesCompanyKeys(matchesTailoredCv, 'cv-acme-2026-11-09.pdf', companySlug('CVé').keys), false);
  assert.equal(matchesCompanyKeys(matchesTailoredCover, 'acme-role-cover.pdf', companySlug('Coveré').keys), false);
});

test('a standard cover is selected by the row\'s report number, not a role token (#6667)', async () => {
  await withFixture(
    [['031-acme-cover-dana-quinn-2026-11-09.pdf'], ['032-acme-cover-dana-quinn-2026-11-09.pdf']],
    async (outputDir) => {
      assert.equal(await resolveTailoredCover(undefined, '31'), join(outputDir, '031-acme-cover-dana-quinn-2026-11-09.pdf'));
      assert.equal(await resolveTailoredCover(undefined, '32'), join(outputDir, '032-acme-cover-dana-quinn-2026-11-09.pdf'));
      assert.equal(await resolveTailoredCover(undefined, '33'), null);
    },
    [
      { n: '31', company: 'Acme', role: 'Engineer' },
      { n: '32', company: 'Acme', role: 'Designer' },
      { n: '33', company: 'Acme', role: 'Analyst' },
    ]
  );
});

test('Zoë does not claim a standard file written for Zo (#6667)', async () => {
  const { companySlug } = await import('../../src/lib/company-slug.mjs');
  const { matchesTailoredCover, matchesTailoredCv, matchesCompanyKeys } = await import('../../src/lib/apply/cv-match.mjs');
  const { keys } = companySlug('Zoë');
  assert.deepEqual(keys, ['zoe', 'zo']);
  assert.equal(matchesCompanyKeys(matchesTailoredCv, '024-zo-cv-jane-smith-2026-11-07.pdf', keys), false);
  assert.equal(matchesCompanyKeys(matchesTailoredCover, '024-zo-cover-jane-smith-2026-11-07.pdf', keys), false);
  assert.equal(matchesCompanyKeys(matchesTailoredCv, '024-zoe-cv-jane-smith-2026-11-07.pdf', keys), true);
});

test('a legacy cover keeps the unfolded role spelling the writer emits (#6667)', async () => {
  await withFixture(
    [['acme-d-veloppeur-cover.pdf']],
    async (outputDir) => {
      assert.equal(await resolveTailoredCover(undefined, '31'), join(outputDir, 'acme-d-veloppeur-cover.pdf'));
    },
    [{ n: '31', company: 'Acme', role: 'Développeur' }]
  );
});

test('a standard cover resolves from the report file when the tracker row has no report link (#6667)', async () => {
  await withFixture(
    [['031-acme-cover-dana-quinn-2026-11-09.pdf']],
    async (outputDir) => {
      assert.equal(await resolveTailoredCover(undefined, '31'), join(outputDir, '031-acme-cover-dana-quinn-2026-11-09.pdf'));
    },
    [{ n: '31', company: 'Acme', role: 'Engineer', reportCell: '—', reportFile: '031-acme-2026-11-09.md' }]
  );
});

test('a standard cover whose report slug carries the role is still found by report number (#6667)', async () => {
  await withFixture(
    [
      ['031-acme-engineer-cover-dana-quinn-2026-11-09.pdf'],
      ['031-acme-engineer-cv-dana-quinn-2026-11-09.pdf'],
    ],
    async (outputDir) => {
      assert.equal(
        await resolveTailoredCover(undefined, '31'),
        join(outputDir, '031-acme-engineer-cover-dana-quinn-2026-11-09.pdf')
      );
    },
    [{ n: '31', company: 'Acme', role: 'Engineer' }]
  );
});

test('an ATS CV is never matched as a cover (#6667)', async () => {
  const { matchesTailoredCover } = await import('../../src/lib/apply/cv-match.mjs');
  assert.equal(matchesTailoredCover('024-zep-cv-avery-cover-2026-11-07.ats.pdf', 'zep'), false);
});
