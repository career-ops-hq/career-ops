/**
 * updater-generated-template-artifact.test.mjs — #3636 regression coverage.
 *
 * `apply()`'s stale-file prune treats any git-tracked file under `templates/`
 * as a prunable system file, because `SYSTEM_PATHS` carries a directory-prefix
 * entry (`'templates/'`) and `USER_PATHS` has no carve-out for that directory
 * at all. The project's documented per-application CV/cover-letter naming
 * convention (`templates/cv-{candidate}-{company-slug}.html` /
 * `templates/cover-{candidate}-{company-slug}.html`, see modes/pdf.md /
 * modes/_custom.md) writes exactly that kind of file, and it never exists
 * upstream (it is per-user, per-application data) — so `staleSystemFiles()`
 * always flagged it as stale, and `apply()` deleted it via `unlinkSync`,
 * silently and permanently (211 files in the reporter's case).
 *
 * `isGeneratedTemplateArtifact()` recognizes those generated files by
 * basename rather than directory, since both the generated files and the real
 * system template files (`cv-template.html`, `cv-template.zh-minimal.html`,
 * `cover-letter-template.html`, ...) share the `templates/` prefix that
 * `pathMatchesManifest()`'s prefix/exact matching can't split. This suite
 * pins: (a) a generated file survives the stale-prune and the
 * locally-modified-system-file warning even when it has no upstream
 * counterpart, and (b) real system template files keep updating/pruning
 * normally — the carve-out must not accidentally swallow them.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, isGeneratedTemplateArtifact, staleSystemFiles, locallyModifiedSystemFiles } from '../update-system.mjs';

console.log('\n🧪 Testing generated-template-artifact carve-out (#3636)...');

// ── 1. isGeneratedTemplateArtifact: basename classification ──
{
  const generated = [
    'templates/cv-jane-doe-acme-corp.html',
    'templates/cover-jane-doe-acme-corp.html',
    'templates/cv-yuting-sun-robert-half-instructional-designer.html',
  ];
  const notGenerated = [
    'templates/cv-template.html',
    'templates/cv-template.zh-minimal.html',
    'templates/cv-template.compact.html',
    'templates/cv-template.executive.html',
    'templates/cv-template.jake.html',
    'templates/cv-template.leadership.html',
    'templates/cv-template.tex',
    'templates/cover-letter-template.html',
    'templates/resume-template.html',
    'templates/states.yml',
    'templates/README.md',
    'templates/packs/cv-x.html', // nested — the carve-out is directly under templates/ only
    'output/cv-jane-doe-acme-corp.html', // right basename, wrong directory
  ];

  const wrongGenerated = generated.filter((f) => !isGeneratedTemplateArtifact(f));
  const wrongSystem = notGenerated.filter((f) => isGeneratedTemplateArtifact(f));

  if (wrongGenerated.length === 0) {
    pass('every documented generated-CV/cover-letter filename is recognized');
  } else {
    fail(`generated filenames not recognized: ${JSON.stringify(wrongGenerated)}`);
  }
  if (wrongSystem.length === 0) {
    pass('real system template files and non-templates/ paths are never misclassified as generated');
  } else {
    fail(`non-generated paths misclassified as generated: ${JSON.stringify(wrongSystem)}`);
  }
}

// ── 2. staleSystemFiles: the actual #3636 repro ──
//    A generated CV absent upstream must survive the prune; a real stale
//    custom template (not the generated naming pattern) is still pruned.
{
  const local = [
    'templates/cv-jane-doe-acme-corp.html',
    'templates/cover-jane-doe-acme-corp.html',
    'templates/cv-template.html',
    'templates/cv-template.custom.html', // a genuinely stale, non-generated file
  ];
  const remote = ['templates/cv-template.html'];
  const system = ['templates/'];

  const stale = staleSystemFiles(local, remote, system);

  if (!stale.includes('templates/cv-jane-doe-acme-corp.html') && !stale.includes('templates/cover-jane-doe-acme-corp.html')) {
    pass('generated per-application CV/cover-letter files are never pruned as stale (#3636)');
  } else {
    fail(`generated files were selected for pruning: ${JSON.stringify(stale)}`);
  }
  if (stale.includes('templates/cv-template.custom.html')) {
    pass('a real stale template file (no upstream counterpart, not a generated artifact) is still pruned');
  } else {
    fail('the carve-out over-widened: a genuinely stale non-generated file was excluded too');
  }
  if (!stale.includes('templates/cv-template.html')) {
    pass('a system template file still shipped upstream is never treated as stale');
  } else {
    fail('templates/cv-template.html was incorrectly flagged as stale');
  }
}

// ── 3. staleSystemFiles: real system template files are still pruned when ──
//    upstream genuinely removes them — the carve-out must not blanket-protect
//    every cv-/cover- file, only the generated-output naming shape.
{
  const local = ['templates/cv-template.zh-minimal.html', 'templates/cover-letter-template.html'];
  const remote = ['templates/cv-template.html']; // upstream dropped both variants
  const system = ['templates/'];

  const stale = staleSystemFiles(local, remote, system);
  if (stale.includes('templates/cv-template.zh-minimal.html') && stale.includes('templates/cover-letter-template.html')) {
    pass('real system template files upstream removed are still pruned as stale');
  } else {
    fail(`system template removal was not detected: ${JSON.stringify(stale)}`);
  }
}

// ── 4. locallyModifiedSystemFiles: no needless "at risk"/.bak noise ──
//    A generated file has no upstream counterpart by construction, so before
//    the fix it always "differed from upstream" and got reported (and backed
//    up to .bak) as if it were a locally-edited system file.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-generated-artifact-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'templates'), { recursive: true });
  writeFileSync(join(dir, 'templates', 'cv-template.html'), 'shipped template\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');
  // Install-only: a generated CV, committed, with no upstream counterpart.
  writeFileSync(join(dir, 'templates', 'cv-jane-doe-acme-corp.html'), 'my generated cv\n');
  g('add', '-A');
  g('commit', '-qm', 'my generated cv');

  const atRisk = locallyModifiedSystemFiles(['templates/'], 'upstream', { git: g, root: dir });
  if (!atRisk.includes('templates/cv-jane-doe-acme-corp.html')) {
    pass('a generated CV with no upstream counterpart is never reported as a locally-modified system file');
  } else {
    fail(`generated CV was flagged as at-risk (would get a needless .bak): ${JSON.stringify(atRisk)}`);
  }
}
