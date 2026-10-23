/** Exclusive, descriptor-relative publication for checked CV generation. */
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./workspace-output.py', import.meta.url));

function runHelper(args, options = {}) {
  try {
    execFileSync('python3', ['-I', '-B', helper, ...args], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024, ...options,
    });
  } catch (cause) {
    let detail;
    try { detail = JSON.parse(String(cause.stderr).trim()); } catch { /* startup failure */ }
    const error = new Error(detail?.error
      ? `${detail.code}: ${detail.error}`
      : 'Checked workspace output requires Python 3 with POSIX directory-relative, no-follow filesystem support.', { cause });
    error.code = detail?.code || cause.code || 'ERR_WORKSPACE_OUTPUT';
    throw error;
  }
}

/**
 * Pin the validated workspace before running any generator. An inherited
 * descriptor keeps the same anchor across the HTML and PDF subprocesses.
 * Unsupported runtimes fail here, before producing either artifact.
 */
export function openWorkspaceOutputRoot(workspace) {
  if (process.platform === 'win32' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW) {
    throw new Error('Checked workspace output requires POSIX directory-relative, no-follow filesystem support.');
  }
  const root = realpathSync(workspace);
  const inherited = process.env.CAREER_OPS_OUTPUT_ROOT_FD;
  let fd;
  let owned = false;
  if (inherited !== undefined) {
    if (!/^\d+$/.test(inherited) || process.env.CAREER_OPS_OUTPUT_ROOT !== root) {
      throw new Error('Inherited output anchor does not match the tracker workspace.');
    }
    fd = Number(inherited);
  } else {
    const expected = statSync(root, { bigint: true });
    fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    owned = true;
    const actual = fstatSync(fd, { bigint: true });
    if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
      closeSync(fd);
      throw new Error('Tracker workspace changed while opening its output anchor.');
    }
  }
  try {
    const identity = fstatSync(fd, { bigint: true });
    if (!identity.isDirectory()) throw new Error('Output anchor is not a directory.');
    if (inherited !== undefined && (
      process.env.CAREER_OPS_OUTPUT_ROOT_DEV !== identity.dev.toString() ||
      process.env.CAREER_OPS_OUTPUT_ROOT_INO !== identity.ino.toString()
    )) throw new Error('Inherited output anchor identity does not match the validated workspace.');
    runHelper(['--check'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return {
      fd, root, dev: identity.dev.toString(), ino: identity.ino.toString(),
      close() { if (owned) { owned = false; closeSync(fd); } },
    };
  } catch (error) {
    if (owned) closeSync(fd);
    throw error;
  }
}

function relativeOutput(outputPath, workspace, anchor) {
  const output = resolve(outputPath);
  // Keep descendant names lexical: canonicalizing them would silently accept
  // symlinks. Only the root may use a platform alias such as macOS /var.
  for (const root of [resolve(workspace), anchor.root]) {
    const path = relative(root, output);
    if (path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
      return path.split(sep).join('/');
    }
  }
  throw new Error(`Refusing to write outside the tracker workspace: ${outputPath}`);
}

/** The directory walk, temporary write, publication, and cleanup all use dirfd. */
export function publishWorkspaceFile(outputPath, content, workspace, anchor) {
  const ownedAnchor = !anchor;
  anchor ||= openWorkspaceOutputRoot(workspace);
  try {
    const path = relativeOutput(outputPath, workspace, anchor);
    runHelper([path, String(0o666)], {
      input: typeof content === 'string' ? Buffer.from(content) : content,
      stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
    });
  } finally {
    if (ownedAnchor) anchor.close();
  }
}

/** Register a protected PDF without reopening the manifest's parent by name. */
export function updateWorkspaceManifest(manifestPath, row, workspace, anchor) {
  const ownedAnchor = !anchor;
  anchor ||= openWorkspaceOutputRoot(workspace);
  try {
    runHelper(['--manifest', relativeOutput(manifestPath, workspace, anchor)], {
      input: JSON.stringify(row), stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
    });
  } finally {
    if (ownedAnchor) anchor.close();
  }
}
