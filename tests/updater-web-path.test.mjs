/**
 * updater-web-path.test.mjs — the web UI is part of the system layer.
 *
 * apply() checks out only paths declared in SYSTEM_PATHS. Keep this manifest
 * contract explicit so upgrades cannot leave an older web/ beside new core code.
 */

import { readFileSync } from 'fs';
import { pass, fail } from './helpers.mjs';
import { extractArrayFromSource } from '../update-system.mjs';

const source = readFileSync(new URL('../update-system.mjs', import.meta.url), 'utf8');
const systemPaths = extractArrayFromSource(source, 'SYSTEM_PATHS') || [];

console.log('\n🧪 Testing updater web path coverage...');

if (systemPaths.includes('web/')) {
  pass('SYSTEM_PATHS includes web/ so apply() updates the web UI');
} else {
  fail('SYSTEM_PATHS omits web/ so apply() leaves a stale web UI behind');
}
