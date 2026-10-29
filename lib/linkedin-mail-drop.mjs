import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { LINKEDIN_IMPORT_MAX_CHARS, linkedInOffers, planLinkedInImport } from './linkedin-import.mjs';
import { resolveTrackerPath } from '../path-resolver.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';

const MAIL_EXT = new Set(['.eml', '.txt', '.mbox']);

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function mailDropFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MAIL_EXT.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(dir, name));
}

// Only a missing file reads as empty. An unreadable tracker would hide the
// jobs already in it, and the import would add them a second time.
function readIf(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

// Saved .eml and .mbox files keep each MIME part in its transfer encoding,
// and a job link inside a base64 part is invisible until decoded. Spaces and
// tabs inside a base64 line are ignored, the way MIME requires. Decoding stops
// once the text handed to the planner is over the character limit, so a huge
// part is not expanded on every poll.
function decodeBase64Parts(text, maxChars) {
  const limit = maxChars + 1;
  const lines = text.split(/\r?\n/);
  let out = '';
  let pending = false;
  const push = (chunk) => {
    if (out.length >= limit) return;
    const room = limit - out.length;
    out += chunk.length > room ? chunk.slice(0, room) : chunk;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^content-transfer-encoding:\s*base64\s*$/i.test(line)) pending = true;
    push(i === 0 ? line : `\n${line}`);
    if (out.length >= limit) return out;
    if (!pending || line !== '') continue;
    pending = false;
    let end = i + 1;
    const body = [];
    let encoded = 0;
    while (end < lines.length) {
      const compact = lines[end].replace(/[ \t]/g, '');
      if (compact.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) break;
      // Four-byte UTF-8 is the smallest decoded character count this part can
      // produce. Past the limit, stop without building the decoded text.
      if (out.length + Math.floor((encoded + compact.length) * 3 / 16) >= limit) {
        return out + 'x'.repeat(limit - out.length);
      }
      body.push(compact);
      encoded += compact.length;
      end += 1;
    }
    if (body.length > 0) push(`\n${Buffer.from(body.join(''), 'base64').toString('utf8')}`);
    i = end - 1;
    if (out.length >= limit) return out;
  }
  return out;
}

// JS string length counts UTF-16 code units. The planner keeps the decoded
// text, not the base64 lines. One CJK character is one unit and three UTF-8
// bytes, and base64 stores those three bytes as four ASCII characters. MIME
// wraps that at 76 characters and adds CRLF. The smallest header that starts
// a part is the encoding line and a blank line, and the decoder inserts one
// more newline before the decoded text. A file bigger than this cannot fit
// the character limit. Twice or three times the limit is too small: base64
// CJK text can be larger than that and still fit. Spaces and tabs inside a
// base64 line can push a smaller message past this size, and those files are
// skipped before the read.
const BASE64_HEADER = 'Content-Transfer-Encoding: base64\r\n\r\n';
const headerChars = 'Content-Transfer-Encoding: base64\n'.length + 1;
const base64Chars = (LINKEDIN_IMPORT_MAX_CHARS - headerChars) * 4;
export const MAIL_BYTES_OVER_LIMIT = Buffer.byteLength(BASE64_HEADER) + base64Chars + 2 * Math.ceil(base64Chars / 76);

export function mailReadFailure(err) {
  const code = err && err.code;
  if (code === 'ERR_FS_FILE_TOO_LARGE' || code === 'ERR_STRING_TOO_LONG') return 'skipped';
  return 'unreadable';
}

// One descriptor for the size check and the read. A path checked and then
// opened again can be replaced by the mail app in between, and the second
// open can be larger than the limit. Bytes past the checked size are not read.
function readBoundedMail(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size > MAIL_BYTES_OVER_LIMIT) return { kind: 'skipped' };
    const buf = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const n = readSync(fd, buf, offset, size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    return { kind: 'text', text: buf.subarray(0, offset).toString('utf8') };
  } finally {
    closeSync(fd);
  }
}

function park(file) {
  const dir = join(dirname(file), 'imported');
  mkdirSync(dir, { recursive: true });
  const base = file.slice(dirname(file).length + 1);
  let dest = join(dir, base);
  let n = 1;
  while (existsSync(dest)) {
    dest = join(dir, `${base}.${n}`);
    n += 1;
  }
  renameSync(file, dest);
}

/**
 * The pipeline and tracker resolve the way scan.mjs resolves them, so
 * CAREER_OPS_PIPELINE and CAREER_OPS_TRACKER point here too.
 *
 * The scheduled poll and linkedin-watch.mjs can run at once, so a real import
 * holds a lock on the folder from listing to parking. Without it both read the
 * same pipeline, add the same job, and the second park fails.
 *
 * @param {{ root: string, dir: string, dryRun?: boolean }} input
 * @returns {Promise<{ added: number, already: number, found: number, skipped: string[], unreadable: string[], message: string }>}
 */
export function importMailDrop(input) {
  if (input.dryRun) return importUnlocked(input);
  return withPipelineLock(join(input.dir, '.import'), () => importUnlocked(input));
}

async function importUnlocked({ root, dir, dryRun = false }) {
  const files = mailDropFiles(dir);
  const pipelinePath = process.env.CAREER_OPS_PIPELINE || join(root, 'data', 'pipeline.md');
  const historyPath = process.env.CAREER_OPS_SCAN_HISTORY || join(root, 'data', 'scan-history.tsv');
  const applicationsPath = resolveTrackerPath(root);
  let seen = `${readIf(pipelinePath)}\n${readIf(applicationsPath)}`;
  const added = [];
  const already = [];
  let found = 0;
  const parked = [];
  const skipped = [];
  const unreadable = [];
  for (const file of files) {
    let text;
    try {
      const read = readBoundedMail(file);
      if (read.kind === 'skipped') {
        skipped.push(basename(file));
        continue;
      }
      text = read.text;
    } catch (err) {
      if (mailReadFailure(err) === 'skipped') skipped.push(basename(file));
      else unreadable.push(basename(file));
      continue;
    }
    const plan = planLinkedInImport(decodeBase64Parts(text, LINKEDIN_IMPORT_MAX_CHARS), seen);
    found += plan.found;
    if (plan.error) {
      skipped.push(basename(file));
      continue;
    }
    for (const job of plan.added) {
      added.push(job);
      seen += `\n${job.url}`;
    }
    already.push(...plan.already);
    parked.push(file);
  }
  if (!dryRun && added.length > 0) {
    const { appendToPipeline, appendToScanHistory } = await import('../scan.mjs');
    const { localToday } = await import('./local-today.mjs');
    const offers = linkedInOffers(added);
    mkdirSync(dirname(pipelinePath), { recursive: true });
    await appendToPipeline(offers, { pipelinePath });
    await appendToScanHistory(offers, localToday(), 'added', { historyPath });
  }
  if (!dryRun) {
    for (const file of parked) park(file);
  }
  const jobs = `${added.length} LinkedIn job${added.length === 1 ? '' : 's'}`;
  let message = added.length === 0
    ? (found === 0 ? 'No LinkedIn jobs found in the alert folder.' : `${already.length} LinkedIn job${already.length === 1 ? ' was' : 's were'} already in your list.`)
    : dryRun ? `${jobs} found. Nothing was saved.` : `${jobs} added.`;
  if (skipped.length > 0) {
    message += ` Skipped ${skipped.length === 1 ? 'a file' : `${skipped.length} files`} too large to read: ${skipped.join(', ')}. Split it into smaller files or export single emails.`;
  }
  if (unreadable.length > 0) {
    message += ` Could not read ${unreadable.join(', ')}. Check the file permissions; it stays in the folder for the next run.`;
  }
  return { added: added.length, already: already.length, found, skipped, unreadable, message };
}
