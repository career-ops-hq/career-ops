import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importMailDrop } from './linkedin-mail-drop.mjs';

export const LINKEDIN_DROP_DIR = join('data', 'linkedin-alerts');

/**
 * @param {string} root
 * @param {{ log?: (line: string) => void }} [options]
 */
export async function pollLinkedInInbox(root, { log = () => {} } = {}) {
  const dir = join(root, LINKEDIN_DROP_DIR);
  const report = {};
  if (existsSync(dir)) {
    try {
      report.drop = await importMailDrop({ root, dir });
      if (report.drop.skipped.length + report.drop.unreadable.length > 0) log(`linkedin drop: ${report.drop.message}`);
    } catch (err) {
      report.dropError = err instanceof Error ? err.message : String(err);
      log(`linkedin drop: ${report.dropError}`);
    }
  }
  return report;
}
