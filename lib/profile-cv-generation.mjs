/** Opt-in generation from a checked Profile selection, using the existing CV CLIs. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot, getProfilePath, hasProfileOverride } from '../path-resolver.mjs';
import { pathIsInsideCanonical, resolveTrackerPath, resolveWorkspaceRoot, resolveWorkspaceRootFor } from '../tracker-utils.mjs';
import { resolveTemplate } from '../cv-templates.mjs';
import { loadValidatedProfile } from './career-profile.mjs';
import { verifyCvSelection } from './profile-cv-selection.mjs';
import { resolvePageFormat } from './page-format.mjs';
import { openWorkspaceOutputRoot } from './workspace-output.mjs';

function runScript(name, args, env, anchor) {
  // These are installed code paths, never user-data paths. No shell interpolation.
  const script = fileURLToPath(new URL(`../${name}`, import.meta.url));
  try {
    execFileSync(process.execPath, [script, ...args], { env,
      stdio: ['inherit', 'inherit', 'inherit', anchor.fd], timeout: 120_000 });
  } catch (error) {
    throw new Error(`${name} failed (${error.signal || error.status || error.code}); generation stopped.`);
  }
}

// Inspect active template tokens without counting documentation comments.
// This does not sanitize or rewrite the HTML passed to the existing builder.
function withoutComments(source) {
  let result = '', from = 0;
  while (from < source.length) {
    const start = source.indexOf('<!--', from);
    if (start < 0) return result + source.slice(from);
    result += source.slice(from, start);
    const end = source.indexOf('-->', start + 4);
    if (end < 0) throw new Error('Profile CV template has an unclosed HTML comment.');
    from = end + 3;
  }
  return result;
}

/**
 * Re-read the current Profile and verify before any output write. The builder
 * receives a private snapshot of that same payload, never caller-supplied HTML.
 * This deliberately narrow path requires aligned roots and new output names.
 */
export async function generateProfileCv({ dataRoot = getCareerOpsRoot(), profileFile,
  basePayload, selection, prepared, htmlPath, pdfPath, templatePath, reportNum }) {
  const profile = loadValidatedProfile({ dataRoot, ...(profileFile ? { file: profileFile } : {}) });
  verifyCvSelection({ profile, basePayload, selection }, prepared);

  // The older primitives resolve their sources in slightly different ways.
  // Refuse a split context instead of checking one candidate and printing another.
  const canonical = realpathSync.native ?? realpathSync;
  const root = canonical(dataRoot);
  const rootIdentity = lstatSync(root, { bigint: true });
  const workspace = resolveWorkspaceRootFor(dataRoot);
  const builderWorkspace = resolveWorkspaceRoot(resolveTrackerPath(dataRoot));
  if (root !== canonical(workspace) || root !== canonical(builderWorkspace)) {
    throw new Error('Profile CV generation requires the Data Root and tracker workspace to match; align CAREER_OPS_ROOT and CAREER_OPS_TRACKER.');
  }
  // Hold the validated directory across every child; no child reopens the
  // workspace or traverses output ancestors by an absolute pathname.
  const anchor = openWorkspaceOutputRoot(root);
  try {
    if (anchor.root !== root || anchor.dev !== rootIdentity.dev.toString() || anchor.ino !== rootIdentity.ino.toString()) {
      throw new Error('Tracker workspace changed after validation.');
    }
    const cvPath = join(root, 'cv.md');
    if (!existsSync(cvPath) || !readFileSync(cvPath, 'utf8').trim()) {
      throw new Error(`Profile CV generation requires a non-empty primary source: ${cvPath}`);
    }

    for (const [path, extension] of [[htmlPath, '.html'], [pdfPath, '.pdf']]) {
      if (typeof path !== 'string' || extname(path).toLowerCase() !== extension || !pathIsInsideCanonical(path, workspace)) {
        throw new Error(`Expected a ${extension} output path inside the tracker workspace: ${path}`);
      }
      // lstat catches dangling symlinks too. New destinations avoid overwriting
      // source aliases, hardlinks or an earlier reviewed artifact.
      try { lstatSync(path); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error(`Output already exists; choose a new versioned path: ${path}`);
    }
    if (reportNum !== undefined && !/^\d+$/.test(reportNum)) throw new Error('--report must be a numeric report number.');
    const configPath = hasProfileOverride() ? getProfilePath() : getProfilePath(root);
    const template = templatePath || resolveTemplate('cv', undefined, { profilePath: configPath });
    if (!withoutComments(readFileSync(template, 'utf8')).includes('{{EXPERIENCE}}')) throw new Error('Profile CV template must render {{EXPERIENCE}} outside comments.');
    const partial = join(dirname(template), 'sections', 'experience.html');
    if (existsSync(partial)) {
      const entry = /<!--ENTRY-->([\s\S]*?)<!--\/ENTRY-->/.exec(readFileSync(partial, 'utf8'));
      // Like the builder, remove named block definitions: only direct ENTRY
      // content is guaranteed to render for every selected experience.
      let direct = entry?.[1];
      if (direct) for (const definition of direct.matchAll(/<!--([A-Z][A-Z0-9_]+)-->[\s\S]*?<!--\/\1-->/g)) {
        direct = direct.split(definition[0]).join('');
      }
      if (!direct || !withoutComments(direct).includes('{{BULLETS}}')) {
        throw new Error('Profile CV experience partial must render {{BULLETS}} directly in its ENTRY.');
      }
    }

    const format = resolvePageFormat(prepared.payload.page_format, { profilePath: configPath, country: prepared.payload.country });
    // Preserve the caller's lexical root spelling too: the PDF CLI compares
    // output paths lexically before canonical checks (e.g. macOS /var -> /private/var).
    const env = { ...process.env, CAREER_OPS_ROOT: resolve(dataRoot),
      CAREER_OPS_OUTPUT_ROOT_FD: '3', CAREER_OPS_OUTPUT_ROOT: anchor.root,
      CAREER_OPS_OUTPUT_ROOT_DEV: anchor.dev, CAREER_OPS_OUTPUT_ROOT_INO: anchor.ino };
    const temporary = mkdtempSync(join(tmpdir(), 'career-ops-profile-cv-'));
    try {
      const payloadPath = join(temporary, 'payload.json');
      writeFileSync(payloadPath, JSON.stringify(prepared.payload), { mode: 0o600, flag: 'wx' });
      runScript('cv-title-check.mjs', [payloadPath, '--summary'], env, anchor);
      runScript('verify-cv-structure.mjs', [payloadPath], env, anchor);
      runScript('build-cv-html.mjs', [payloadPath, resolve(htmlPath), resolve(template), '--no-clobber'], env, anchor);
      const pdfArgs = [resolve(htmlPath), resolve(pdfPath), `--format=${format}`, '--kind=cv', '--require-cv-source', '--no-clobber'];
      if (reportNum !== undefined) pdfArgs.push(`--report=${reportNum}`);
      // No skip-fact-check, allow-reorder or allow-nonchronological escape hatch.
      runScript('generate-pdf.mjs', pdfArgs, env, anchor);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } finally {
    anchor.close();
  }
}
