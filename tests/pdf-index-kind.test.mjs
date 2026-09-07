// tests/pdf-index-kind.test.mjs — a report's CV and its cover letter are two
// artifacts, and generating one must never delete the other (#3887).
//
// data/pdf-index.tsv held one row per report number, and both documents are
// rendered through renderHtmlToPdf() and indexed under the same --report. The
// second render therefore evicted the first, so the apply flow uploaded a cover
// letter to an employer as the tailored CV. The manifest could not say what a
// row was, so the eviction had nothing but the report number to key on. The
// kind column is that key; these cases pin both halves of it.
import { pass, fail } from './helpers.mjs';
import { applyManifestRow, resolveArtifactKind, ARTIFACT_KINDS } from '../generate-pdf.mjs';

console.log('\nPDF manifest keys on report number and artifact kind (#3887)');

const HEADER = '# report\tpdf\thtml\tformat\tdate\tkind — written by generate-pdf.mjs, do not edit';
const cvRow = '7\toutput/cv-acme-2026-09-05.pdf\t\tletter\t2026-09-05\tcv';
const coverRow = '7\toutput/cover-acme-2026-09-05.pdf\t\tletter\t2026-09-05\tcover';

const row = (over = {}) => ({
  reportNum: '7', pdf: 'output/x.pdf', html: '', format: 'letter', date: '2026-09-06', ...over,
});
const paths = (lines) => lines.map((l) => l.split('\t')[1]);
const kinds = (lines) => lines.map((l) => l.split('\t')[5]);

// The bug, in both orders. Neither order was safe before: cover-after-CV served
// the cover as the CV, CV-after-cover left the cover unresolvable.
{
  const out = applyManifestRow([HEADER, cvRow], row({ pdf: 'output/cover-acme-2026-09-05.pdf', kind: 'cover' }));
  const p = paths(out);
  p.includes('output/cv-acme-2026-09-05.pdf') && p.includes('output/cover-acme-2026-09-05.pdf') && p.length === 2
    ? pass('a cover letter for report 7 leaves report 7 CV row in place')
    : fail(`a cover evicted the CV row: ${JSON.stringify(p)}`);
}
{
  const out = applyManifestRow([HEADER, coverRow], row({ pdf: 'output/cv-acme-2026-09-05.pdf', kind: 'cv' }));
  const p = paths(out);
  p.includes('output/cv-acme-2026-09-05.pdf') && p.includes('output/cover-acme-2026-09-05.pdf') && p.length === 2
    ? pass('a CV for report 7 leaves report 7 cover-letter row in place')
    : fail(`a CV evicted the cover row: ${JSON.stringify(p)}`);
}

// Superseding still works, which is the behaviour the eviction existed for.
{
  const out = applyManifestRow([HEADER, cvRow, coverRow], row({ pdf: 'output/cv-acme-2026-09-06.pdf', kind: 'cv' }));
  const p = paths(out);
  p.length === 2 && p.includes('output/cover-acme-2026-09-05.pdf') && p.includes('output/cv-acme-2026-09-06.pdf')
    ? pass('a regenerated CV supersedes only the CV row')
    : fail(`regenerated CV did not supersede cleanly: ${JSON.stringify(p)}`);
}
{
  const out = applyManifestRow([HEADER, cvRow, coverRow], row({ pdf: 'output/cover-acme-2026-09-06.pdf', kind: 'cover' }));
  const p = paths(out);
  p.length === 2 && p.includes('output/cv-acme-2026-09-05.pdf') && p.includes('output/cover-acme-2026-09-06.pdf')
    ? pass('a regenerated cover letter supersedes only the cover row')
    : fail(`regenerated cover did not supersede cleanly: ${JSON.stringify(p)}`);
}

// A manifest written by an older version has five columns and no kind. It keeps
// today's meaning for CV lookups, so existing manifests are not invalidated.
{
  const legacy = '7\toutput/cv-old-2026-09-01.pdf\t\tletter\t2026-09-01';
  const out = applyManifestRow([HEADER, legacy], row({ pdf: 'output/cv-new-2026-09-06.pdf', kind: 'cv' }));
  paths(out).length === 1 && paths(out)[0] === 'output/cv-new-2026-09-06.pdf'
    ? pass('an incoming CV claims a legacy kind-less row rather than duplicating it')
    : fail(`legacy row was not claimed by the CV: ${JSON.stringify(paths(out))}`);
}
{
  const legacy = '7\toutput/cv-old-2026-09-01.pdf\t\tletter\t2026-09-01';
  const out = applyManifestRow([HEADER, legacy], row({ pdf: 'output/cover-acme-2026-09-06.pdf', kind: 'cover' }));
  paths(out).length === 2 && paths(out).includes('output/cv-old-2026-09-01.pdf')
    ? pass('an incoming cover letter leaves a legacy kind-less row alone')
    : fail(`cover guessed at an unmarked row: ${JSON.stringify(paths(out))}`);
}

// "007" and "7" are the same report: zero-padded report-link form vs unpadded
// tracker-# form. The kind key must not reintroduce a padding split.
{
  const padded = '007\toutput/cv-acme-2026-09-05.pdf\t\tletter\t2026-09-05\tcv';
  const out = applyManifestRow([HEADER, padded], row({ pdf: 'output/cv-acme-2026-09-06.pdf', kind: 'cv' }));
  paths(out).length === 1
    ? pass('a padded report number still supersedes its unpadded twin within a kind')
    : fail(`padding split the key: ${JSON.stringify(paths(out))}`);
}

// One row per PDF path, whatever kind claims it.
{
  const out = applyManifestRow([HEADER, cvRow], row({ pdf: 'output/cv-acme-2026-09-05.pdf', kind: 'cv' }));
  paths(out).length === 1
    ? pass('re-rendering the same PDF path does not duplicate its row')
    : fail(`duplicate path rows: ${JSON.stringify(paths(out))}`);
}

// The column is appended last so the five existing columns keep their index:
// find.mjs, outcome.mjs and the web reader all parse this file positionally.
{
  const out = applyManifestRow([HEADER], row({ pdf: 'output/cover-acme-2026-09-06.pdf', kind: 'cover' }));
  const f = out[0].split('\t');
  f.length === 6 && f[0] === '7' && f[1] === 'output/cover-acme-2026-09-06.pdf' && f[3] === 'letter' && f[5] === 'cover'
    ? pass('kind is the sixth column, leaving the first five in place')
    : fail(`column layout changed: ${JSON.stringify(f)}`);
}
{
  const out = applyManifestRow([HEADER], row({ pdf: 'output/whatever.pdf' }));
  kinds(out)[0] === 'cv'
    ? pass('a row written with no kind is recorded as a CV, not left blank')
    : fail(`undeclared kind was written as ${JSON.stringify(kinds(out)[0])}`);
}

// resolveArtifactKind: a caller that forgets to declare a cover is the normal
// case, so the default is derived from the name rather than assumed to be cv.
const kindCases = [
  ['cover', 'output/cv-acme.pdf', 'cover', 'declared', 'an explicit kind overrides the filename'],
  [undefined, 'output/cover-acme-2026-09-05.pdf', 'cover', 'name', 'a cover- prefix reads as a cover letter'],
  [undefined, 'output/acme-vp-marketing-cover.pdf', 'cover', 'name', 'a -cover suffix reads as a cover letter'],
  [undefined, 'output/cv-acme-2026-09-05.pdf', 'cv', 'name', 'a cv- prefix reads as a CV'],
  [undefined, 'output/cv-covered-bridge-group.pdf', 'cv', 'name', 'a cv- prefix wins over a company named "Covered..."'],
  [undefined, 'output/discover-weekly-brief.pdf', 'cv', 'default', 'an unanchored "cover" inside a name is not a cover letter'],
  [undefined, 'output/acme.pdf', 'cv', 'default', 'a name that signals nothing falls back to CV'],
];
for (const [explicit, path, wantKind, wantSource, label] of kindCases) {
  const got = resolveArtifactKind(explicit, path);
  got.kind === wantKind && got.source === wantSource
    ? pass(`resolveArtifactKind: ${label}`)
    : fail(`resolveArtifactKind(${JSON.stringify(explicit)}, ${JSON.stringify(path)}) = ${JSON.stringify(got)}, wanted ${wantKind}/${wantSource}`);
}
{
  const got = resolveArtifactKind('resume', 'output/cv-acme.pdf');
  got.kind === null
    ? pass('resolveArtifactKind returns null for an unrecognized declared kind so the caller can reject it')
    : fail(`unrecognized kind silently resolved to ${JSON.stringify(got)}`);
}
{
  ARTIFACT_KINDS.includes('cv') && ARTIFACT_KINDS.includes('cover') && ARTIFACT_KINDS.length === 2
    ? pass('ARTIFACT_KINDS names exactly the kinds the manifest keys on')
    : fail(`ARTIFACT_KINDS = ${JSON.stringify(ARTIFACT_KINDS)}`);
}
