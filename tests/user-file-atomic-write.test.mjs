// tests/user-file-atomic-write.test.mjs — add-entry.mjs (cv.md, article-digest.md)
// and fix-slugs.mjs (portals.yml) replace the user's file atomically.
//
// Both used to overwrite it in place with a bare writeFileSync, which truncates
// first: a crash or a full disk mid-write left the only copy empty or cut
// short. The replacement is now a temp file renamed over the original, written
// through the real path so a symlinked cv.md stays a symlink, with the
// original's permission bits.
import {
  mkdtempSync, writeFileSync, readFileSync, symlinkSync, lstatSync, statSync, chmodSync, existsSync,
  readdirSync, mkdirSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, warn, rmSync, stripJsComments, ROOT, NODE } from './helpers.mjs';
import { replaceUserFile } from '../tracker-utils.mjs';

console.log('\nuser files (cv.md, article-digest.md, portals.yml) are replaced atomically');

const IS_WINDOWS = process.platform === 'win32';
const tmp = mkdtempSync(join(tmpdir(), 'co-user-file-'));
try {
  // ── 1. replaceUserFile: a new inode, the same content, the same mode ──
  {
    const file = join(tmp, 'portals.yml');
    writeFileSync(file, 'tracked_companies: []\n');
    if (!IS_WINDOWS) chmodSync(file, 0o600);
    const before = statSync(file);
    replaceUserFile(file, 'tracked_companies:\n  - name: Acme\n');
    const after = statSync(file);
    if (readFileSync(file, 'utf8') === 'tracked_companies:\n  - name: Acme\n') pass('replaceUserFile writes the new content');
    else fail(`replaceUserFile content = ${JSON.stringify(readFileSync(file, 'utf8'))}`);
    if (IS_WINDOWS) {
      warn('skipping inode/mode checks on Windows');
    } else {
      if (after.ino !== before.ino) pass('replaceUserFile renames a new file into place instead of truncating the original');
      else fail('replaceUserFile wrote the original file in place (same inode)');
      if ((after.mode & 0o777) === 0o600) pass('replaceUserFile keeps the original permission bits');
      else fail(`replaceUserFile mode = ${(after.mode & 0o777).toString(8)}, expected 600`);
    }
    const leftovers = readdirSync(tmp).filter((f) => f.endsWith('.tmp'));
    if (leftovers.length === 0) pass('replaceUserFile leaves no temp file behind');
    else fail(`replaceUserFile left temp files: ${leftovers.join(', ')}`);
  }

  // ── 1a. A read-only file is refused, as the in-place write refused it. A
  //    rename needs only the directory to be writable, so without the check
  //    the file would be replaced.
  {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (IS_WINDOWS || isRoot) {
      warn('skipping the read-only case (Windows or root: mode bits do not deny the write)');
    } else {
      const file = join(tmp, 'read-only-cv.md');
      writeFileSync(file, '# Locked\n');
      chmodSync(file, 0o444);
      let threw = null;
      try { replaceUserFile(file, '# Changed\n'); } catch (e) { threw = e; }
      if (threw && ['EACCES', 'EPERM'].includes(threw.code) && readFileSync(file, 'utf8') === '# Locked\n') {
        pass('replaceUserFile refuses a read-only file and leaves it unchanged');
      } else {
        fail(`replaceUserFile on a read-only file: threw=${threw?.code}, content=${JSON.stringify(readFileSync(file, 'utf8'))}`);
      }
      chmodSync(file, 0o644);
    }
  }

  // ── 1b. A dangling symlink (article-digest.md before its first entry): the
  //    link stays and its target is created, as an in-place write would do.
  {
    const dir = join(tmp, 'dangling');
    mkdirSync(dir);
    const link = join(dir, 'article-digest.md');
    let linked = false;
    try { symlinkSync(join('targets', 'digest.md'), link); linked = true; } catch (e) { warn(`skipping the dangling-symlink case: ${e.code || e.message}`); }
    if (linked) {
      mkdirSync(join(dir, 'targets'));
      replaceUserFile(link, '# Article Digest\n');
      if (lstatSync(link).isSymbolicLink() && readFileSync(join(dir, 'targets', 'digest.md'), 'utf8') === '# Article Digest\n') {
        pass('replaceUserFile creates a dangling symlink\'s target and keeps the link');
      } else {
        fail(`replaceUserFile replaced the dangling symlink (isSymbolicLink=${lstatSync(link).isSymbolicLink()})`);
      }
    }
  }

  // ── 2. add-entry.mjs end to end, with cv.md a symlink to the real file ──
  {
    const realDir = join(tmp, 'real');
    const dataRoot = join(tmp, 'data-root');
    mkdirSync(realDir);
    mkdirSync(dataRoot);
    const realCv = join(realDir, 'cv.md');
    writeFileSync(realCv, '# Jane Doe\n\n## Projects\n\n**Existing Project** — something\n');
    const linkCv = join(dataRoot, 'cv.md');
    let linked = false;
    try { symlinkSync(realCv, linkCv); linked = true; } catch (e) { warn(`skipping the symlink case: ${e.code || e.message}`); }

    if (linked) {
      const digest = join(dataRoot, 'article-digest.md');
      const payload = join(tmp, 'payload.json');
      writeFileSync(payload, JSON.stringify({
        cv: { section: 'Projects', dedupKey: 'New Project', entry: '**New Project** — shipped it' },
        articleDigest: { dedupKey: 'New Project', entry: '## New Project\n\n**Hero metrics:** none' },
      }));
      const realBefore = statSync(realCv);
      let out = '';
      try {
        out = execFileSync(NODE, [join(ROOT, 'add-entry.mjs'), payload], {
          encoding: 'utf8', timeout: 30000,
          env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_CV: linkCv, CAREER_OPS_ARTICLE_DIGEST: digest },
        });
      } catch (e) {
        out = `${e.stdout || ''}${e.stderr || ''}`;
      }
      if (lstatSync(linkCv).isSymbolicLink()) pass('add-entry.mjs keeps a symlinked cv.md a symlink');
      else fail('add-entry.mjs replaced the symlinked cv.md with a regular file');
      if (readFileSync(realCv, 'utf8').includes('**New Project**')) pass('add-entry.mjs writes the entry into the symlink target');
      else fail(`add-entry.mjs did not update the symlink target: ${out.slice(0, 300)}`);
      if (!IS_WINDOWS && statSync(realCv).ino !== realBefore.ino) pass('add-entry.mjs replaces cv.md atomically (new inode)');
      else if (!IS_WINDOWS) fail('add-entry.mjs wrote cv.md in place (same inode)');
      if (existsSync(digest) && readFileSync(digest, 'utf8').includes('New Project')) pass('add-entry.mjs creates article-digest.md through the same writer');
      else fail(`add-entry.mjs did not write article-digest.md: ${out.slice(0, 300)}`);
    }
  }

  // ── 3. Structural: neither writer goes back to an in-place write. fix-slugs'
  //    --fix path needs live board probes, so it is pinned here rather than run.
  {
    const inPlace = ['add-entry.mjs', 'fix-slugs.mjs'].filter((f) => {
      const src = stripJsComments(readFileSync(join(ROOT, f), 'utf8'));
      return /\bwriteFileSync\s*\(/.test(src) || !/\breplaceUserFile\s*\(/.test(src);
    });
    if (inPlace.length === 0) pass('add-entry.mjs and fix-slugs.mjs write user files only through replaceUserFile()');
    else fail(`these writers still overwrite a user file in place: ${inPlace.join(', ')}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
