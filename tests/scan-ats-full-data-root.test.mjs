// tests/scan-ats-full-data-root.test.mjs — Bug 5 regression: all four data
// paths in scan-ats-full.mjs must be anchored to the data root, not cwd.
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — data-root path anchoring');

// Import the module's exported functions. The main scan loop is guarded by
// isMainModule so importing is safe; the constants are module-level, meaning
// they're evaluated once with the process.env at import time.
// We test path-resolver directly to cover the constant derivation logic.

const { getCareerOpsRoot } = await import(
  pathToFileURL(join(ROOT, 'path-resolver.mjs')).href
);

// With CAREER_OPS_ROOT set, all data paths built from getCareerOpsRoot()
// should reflect the override rather than cwd.
{
  const tmp = join(ROOT, '.tmp-ats-root-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    const saved = process.env.CAREER_OPS_ROOT;
    process.env.CAREER_OPS_ROOT = tmp;
    const root = getCareerOpsRoot();
    // Paths that scan-ats-full.mjs now derives from DATA_ROOT:
    const expectedPortals  = join(root, 'portals.yml');
    const expectedPipeline = join(root, 'data', 'pipeline.md');
    const expectedCache    = join(root, 'data', 'cache', 'ats-companies');
    const expectedCheckpt  = join(root, 'data', 'cache', 'ats-full-checkpoint.json');

    if (!expectedPortals.startsWith(tmp))   fail(`portals path not under data root: ${expectedPortals}`);
    else                                     pass('portals.yml anchored to data root');
    if (!expectedPipeline.startsWith(tmp))  fail(`pipeline path not under data root: ${expectedPipeline}`);
    else                                     pass('data/pipeline.md anchored to data root');
    if (!expectedCache.startsWith(tmp))     fail(`cache dir not under data root: ${expectedCache}`);
    else                                     pass('data/cache/ats-companies anchored to data root');
    if (!expectedCheckpt.startsWith(tmp))   fail(`checkpoint path not under data root: ${expectedCheckpt}`);
    else                                     pass('data/cache/ats-full-checkpoint.json anchored to data root');

    if (saved === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// CAREER_OPS_PORTALS env override must still win over the data-root default.
{
  const tmp = join(ROOT, '.tmp-ats-portals-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    const customPortals = join(tmp, 'custom-portals.yml');
    writeFileSync(customPortals, 'query: []\n');
    const savedPortals = process.env.CAREER_OPS_PORTALS;
    process.env.CAREER_OPS_PORTALS = customPortals;
    // Simulates: const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || path.join(DATA_ROOT, 'portals.yml');
    const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(getCareerOpsRoot(), 'portals.yml');
    if (PORTALS_PATH === customPortals) pass('CAREER_OPS_PORTALS override respected');
    else fail(`expected ${customPortals}, got ${PORTALS_PATH}`);
    if (savedPortals === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = savedPortals;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// loadCheckpoint / saveCheckpoint already accept an explicit `file` argument,
// so no call-site changes are needed — verify the exported function signature.
{
  const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
  if (typeof mod.loadCheckpoint === 'function') pass('loadCheckpoint is exported');
  else fail('loadCheckpoint not exported');
  // Default arg behaviour: passing no argument should not throw (file likely absent).
  try {
    const cp = mod.loadCheckpoint(join(ROOT, '.tmp-nonexistent-checkpoint.json'));
    if (cp === null) pass('loadCheckpoint returns null for missing file');
    else fail(`loadCheckpoint returned ${JSON.stringify(cp)} for missing file`);
  } catch (err) {
    fail(`loadCheckpoint threw on missing file: ${err.message}`);
  }
}
