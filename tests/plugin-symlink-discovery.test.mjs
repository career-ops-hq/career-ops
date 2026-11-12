// tests/plugin-symlink-discovery.test.mjs — discoverPlugins() must treat a
// symlinked plugin directory as a plugin directory (#3140).
//
// plugins.local/ exists so a developer can work on a plugin from its own
// checkout, and linking that checkout in is the natural way to do it.
// readdirSync does not follow links, so a symlinked entry reports
// isDirectory() === false and a bare isDirectory() filter drops it with no
// warning at all: the plugin never appears in `plugins.mjs list` even though
// config/plugins.yml enables it.
//
// Discovery is only the first gate. An enabled plugin still has to survive
// pluginStatus(), lockGate() -- which derives its trust source from
// manifest.dir and hashes that whole tree -- and the entry import, and every
// one of those sees the LINK path rather than the resolved checkout. So the
// second half of this file drives loadPlugins() end to end on a symlinked
// plugin and calls the hook it returns.
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

// A directory SYMLINK needs SeCreateSymbolicLinkPrivilege on Windows, which a
// non-elevated shell lacks unless Developer Mode is on. All three links below
// threw EPERM there, losing every check in this file as one opaque suite
// failure (#3259). A junction needs no privilege, and it is what test-all.mjs's
// e2e fixture and generate-pdf-page-budget.test.mjs already use for exactly
// this reason. The swap is invisible to what this suite asserts: discovery
// still walks the link, readdirSync still reports isDirectory() === false for
// it -- the bug #3140 is about -- and stat() through a DANGLING junction throws
// just as it does through a dangling symlink, which the `gone-away` case
// depends on. Junctions add two constraints, both already met at all three
// sites: the target is absolute and on a local volume, since every one is
// built from mkdtempSync(). The type argument is ignored off Windows.
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
const linkPlugin = (target, linkPath) => symlinkSync(target, linkPath, LINK_TYPE);

const { discoverPlugins, pluginRoots, loadPlugins } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);

console.log('\nplugins/_engine.mjs — symlinked plugin discovery (#3140)');

const check = (desc, condition, details = '') => {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
};

const manifest = (id) => JSON.stringify({
  id,
  apiVersion: 1,
  description: `${id} test plugin`,
  hooks: ['ingest'],
  requiredEnv: [],
  allowedHosts: [],
  humanInTheLoop: true,
});

/** Write a complete, valid plugin into `dir`, with the manifest id `id`. */
function writePlugin(dir, id, entryBody = 'export default {};\n') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), manifest(id));
  writeFileSync(join(dir, 'index.mjs'), entryBody);
  return dir;
}

/** Write config/plugins.yml under `root` enabling (or disabling) `id`. */
function writePluginConfig(root, id, enabled) {
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'plugins.yml'), `plugins:\n  ${id}:\n    enabled: ${enabled}\n`);
}

const tmp = mkdtempSync(join(tmpdir(), 'cops-plugin-symlink-'));
const tmpEnabled = mkdtempSync(join(tmpdir(), 'cops-plugin-symlink-load-'));

try {
  const local = join(tmp, 'plugins.local');
  mkdirSync(local, { recursive: true });

  // A plugin living in its own checkout, linked into plugins.local/ under the
  // id it declares. The manifest id must match the LINK name, not the target
  // directory name, which is what a developer linking `career-ops-plugin-demo`
  // in as `demo` actually gets.
  const externalCheckout = writePlugin(join(tmp, 'checkouts', 'career-ops-plugin-demo'), 'demo');
  linkPlugin(externalCheckout, join(local, 'demo'));

  // A plain directory plugin alongside it — the sibling that must keep working.
  writePlugin(join(local, 'regular'), 'regular');

  const ids = () => discoverPlugins(pluginRoots(tmp)).map(p => p.id).sort();

  const found = ids();
  check(
    'a symlinked plugin directory is discovered',
    found.includes('demo'),
    `discovered: ${JSON.stringify(found)}`,
  );
  check(
    'the symlinked plugin resolves to its real checkout directory',
    discoverPlugins(pluginRoots(tmp)).find(p => p.id === 'demo')?.dir === join(local, 'demo'),
  );
  check(
    'a plain directory plugin is still discovered alongside a symlinked one',
    found.includes('regular'),
    `discovered: ${JSON.stringify(found)}`,
  );

  // A dangling symlink (the checkout was moved or deleted) must be skipped
  // quietly. Resolving it throws, and an unguarded resolve takes down
  // discovery for every other plugin in the root, not just the dead link.
  linkPlugin(join(tmp, 'checkouts', 'gone-away'), join(local, 'dangling'));

  let afterDangling;
  let threw = null;
  try {
    afterDangling = ids();
  } catch (err) {
    threw = err;
  }

  check(
    'a dangling symlink in a plugin root does not throw',
    threw === null,
    threw ? `${threw.constructor.name}: ${threw.message}` : '',
  );
  check(
    'a dangling symlink does not suppress the other plugins in its root',
    Array.isArray(afterDangling) && afterDangling.includes('demo') && afterDangling.includes('regular'),
    `discovered: ${JSON.stringify(afterDangling)}`,
  );
  check(
    'a dangling symlink is not itself reported as a plugin',
    Array.isArray(afterDangling) && !afterDangling.includes('dangling'),
    `discovered: ${JSON.stringify(afterDangling)}`,
  );

  // --- the enabled load path -------------------------------------------------
  // Its own root, so the only plugin in play is the symlinked one and an empty
  // result cannot be mistaken for a pass. The hook records that it really ran.
  const loadLocal = join(tmpEnabled, 'plugins.local');
  mkdirSync(loadLocal, { recursive: true });
  const linkedCheckout = writePlugin(
    join(tmpEnabled, 'checkouts', 'career-ops-plugin-linked'),
    'linked',
    'export default { ingest: async (ctx) => ({ ran: true, dryRun: ctx.dryRun }) };\n',
  );
  linkPlugin(linkedCheckout, join(loadLocal, 'linked'));
  writePluginConfig(tmpEnabled, 'linked', true);

  const firstLoad = await loadPlugins('ingest', { root: tmpEnabled, dryRun: true });
  check(
    'an enabled symlinked plugin is returned by loadPlugins',
    firstLoad.length === 1 && firstLoad[0].id === 'linked',
    `loaded: ${JSON.stringify(firstLoad.map(p => p.id))}`,
  );

  // The hook has to be genuinely importable and callable from the link path:
  // importHook() resolves manifest.entry against manifest.dir, which is the link.
  let hookResult = null;
  if (firstLoad.length === 1) hookResult = await firstLoad[0].hook(firstLoad[0].ctx);
  check(
    'the ingest hook of a symlinked plugin imports and runs',
    hookResult?.ran === true && hookResult?.dryRun === true,
    `hook returned: ${JSON.stringify(hookResult)}`,
  );

  // lockGate() pins an unpinned plugin on first load, which means it hashed the
  // tree behind the link and classified the source from the link path. A silent
  // failure in either leaves no entry at all, so assert the entry, not the load.
  let lock = null;
  try { lock = JSON.parse(readFileSync(join(tmpEnabled, 'plugins.lock'), 'utf8')); } catch { /* asserted below */ }
  const pinned = lock?.plugins?.linked;
  check(
    'lockGate pins the tree behind the symlink on first load',
    typeof pinned?.integrity === 'string' && pinned.integrity.startsWith('sha256-')
      && Object.keys(pinned.files || {}).sort().join(',') === 'index.mjs,manifest.json',
    `lock entry: ${JSON.stringify(pinned)}`,
  );
  check(
    'a symlinked plugin under plugins.local is pinned as a local, not bundled, source',
    pinned?.source === 'local',
    `source: ${JSON.stringify(pinned?.source)}`,
  );

  // Second load hits the pinned branch instead of the unpinned one: the tree
  // must re-hash through the link to the SAME integrity or the gate rejects it.
  const secondLoad = await loadPlugins('ingest', { root: tmpEnabled, dryRun: true });
  let relock = null;
  try { relock = JSON.parse(readFileSync(join(tmpEnabled, 'plugins.lock'), 'utf8')); } catch { /* asserted below */ }
  check(
    'a symlinked plugin still loads once its tree is pinned in plugins.lock',
    secondLoad.length === 1 && secondLoad[0].id === 'linked'
      && relock?.plugins?.linked?.integrity === pinned?.integrity,
    `loaded: ${JSON.stringify(secondLoad.map(p => p.id))}, integrity stable: ${relock?.plugins?.linked?.integrity === pinned?.integrity}`,
  );

  // Same fixture, config flipped: proves the assertions above are reading the
  // enabled path and not an empty array that happens to satisfy them.
  writePluginConfig(tmpEnabled, 'linked', false);
  const disabledLoad = await loadPlugins('ingest', { root: tmpEnabled, dryRun: true });
  check(
    'a discovered symlinked plugin is not loaded while config/plugins.yml disables it',
    disabledLoad.length === 0,
    `loaded: ${JSON.stringify(disabledLoad.map(p => p.id))}`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(tmpEnabled, { recursive: true, force: true });
}
