/** Capture browser JD evidence before scan handoff; failures remain explicit and retryable. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeUrl } from '../url-key.mjs';

const exec = promisify(execFile);
const extractor = fileURLToPath(new URL('../browser-extract.mjs', import.meta.url));
export const JD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** IBM adds a locale path while keeping the same public job ID. */
export function samePostingUrl(requested, actual) {
  if (normalizeUrl(requested) === normalizeUrl(actual)) return true;
  try {
    const source = new URL(requested);
    const final = new URL(actual);
    return source.origin === 'https://careers.ibm.com' && final.origin === source.origin
      && source.pathname === '/careers/JobDetail'
      && /^\/[a-z]{2}_[A-Z]{2}\/careers\/JobDetail$/.test(final.pathname)
      && source.searchParams.size === 1 && final.searchParams.size === 1
      && /^\d+$/.test(source.searchParams.get('jobId') || '')
      && source.searchParams.get('jobId') === final.searchParams.get('jobId');
  } catch { return false; }
}

export function scanJdPath(url, root = process.cwd()) {
  const key = createHash('sha256').update(normalizeUrl(url)).digest('hex');
  return resolve(root, 'data/scan-jds', `${key}.json`);
}

export function readScanJd(url, root = process.cwd(), now = Date.now()) {
  try {
    const record = JSON.parse(readFileSync(scanJdPath(url, root), 'utf8'));
    const age = now - Date.parse(record.retrieved_at);
    return record.requested_url === normalizeUrl(url) && samePostingUrl(record.requested_url, record.url)
      && record.status === 'captured'
      && typeof record.text === 'string' && record.text.trim() && record.text.length <= 100000
      && age >= 0 && age < JD_MAX_AGE_MS ? record : null;
  } catch { return null; }
}

export async function captureScanJds(offers, root = process.cwd(), extract = async url => {
  const { stdout } = await exec(process.execPath, [extractor, url, '--max-chars', '100000', '--timeout', '30000'],
    { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}) {
  const counts = { captured: 0, reused: 0, failed: 0 };
  for (const url of new Set(offers.map(offer => normalizeUrl(offer.url)))) {
    if (readScanJd(url, root)) { counts.reused++; continue; }
    let record;
    try {
      const snapshot = await extract(url);
      if (typeof snapshot.text !== 'string' || !snapshot.text.trim() || snapshot.text.length > 100000)
        throw new Error('Empty or truncated browser JD');
      if (!samePostingUrl(url, snapshot.url))
        throw new Error('Browser page redirected away from the requested posting');
      record = { ...snapshot, requested_url: url, retrieved_at: new Date().toISOString(), status: 'captured' };
      counts.captured++;
    } catch (error) {
      record = { requested_url: url, retrieved_at: new Date().toISOString(), status: 'failed', reason: String(error.message).slice(0, 1500) };
      counts.failed++;
    }
    const target = scanJdPath(url, root);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record) + '\n');
    renameSync(temporary, target);
  }
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, root] = process.argv.slice(2);
  if (!url || !root) {
    console.error('Usage: node lib/scan-jd.mjs <posting-url> <capture-root>');
    process.exitCode = 2;
  } else {
    const counts = await captureScanJds([{ url }], root);
    process.stdout.write(JSON.stringify({ counts, snapshot: readScanJd(url, root) }));
  }
}
