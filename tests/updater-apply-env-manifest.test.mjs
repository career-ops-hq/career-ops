/**
 * updater-apply-env-manifest.test.mjs — a target manifest can select `.env`
 * for apply()'s checkout even though it may contain local configuration.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkoutSystemPathsBatched,
  manifestProbes,
  rejectUserLayerPaths,
  USER_PATHS,
} from '../update-system.mjs';
import { fail, makeUpdaterRepo, pass, rmSync } from './helpers.mjs';

console.log('\n🧪 Testing apply() against a target manifest containing .env...');

const { dir, g } = makeUpdaterRepo({ prefix: 'co-apply-env-manifest-' });
try {
  writeFileSync(join(dir, '.env'), 'installed value\n');
  g('add', '.env');
  g('commit', '-qm', 'installed');
  const installed = g('rev-parse', 'HEAD');

  writeFileSync(join(dir, '.env'), 'target value\n');
  g('add', '.env');
  g('commit', '-qm', 'target');
  const target = g('rev-parse', 'HEAD');
  const upstreamFiles = g('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(Boolean);

  g('checkout', '-q', installed);
  writeFileSync(join(dir, '.env'), 'local configuration\n');

  const { kept, refused } = rejectUserLayerPaths(
    ['.env'],
    USER_PATHS,
    manifestProbes({
      trackedOutput: g('ls-files', '-z'),
      upstreamOutput: upstreamFiles.join('\0'),
      root: dir,
    }),
  );
  if (kept.includes('.env') && !refused.includes('.env')) {
    pass('the current manifest guard lets .env reach apply checkout');
  } else {
    fail(`fixture no longer reproduces the unfiltered .env entry (kept=${JSON.stringify(kept)}, refused=${JSON.stringify(refused)})`);
  }

  checkoutSystemPathsBatched(kept, [], upstreamFiles, target, { git: g });
  const actual = readFileSync(join(dir, '.env'), 'utf8');
  if (actual === 'local configuration\n') {
    pass('apply checkout preserves the local .env content');
  } else {
    fail(`apply checkout overwrote local .env content: ${JSON.stringify(actual)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
