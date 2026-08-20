// tests/plugin-symlink-discovery.test.mjs — discoverPlugins() must treat a
// symlinked plugin directory as a plugin directory (#3140).
//
// plugins.local/ exists so a developer can work on a plugin from its own
// checkout, and linking that checkout in is the natural way to do it.
// readdirSync does not follow links, so a symlinked entry reports
// isDirectory() === false and a bare isDirectory() filter drops it with no
// warning at all: the plugin never appears in `plugins.mjs list` even though
// config/plugins.yml enables it.
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const { discoverPlugins, pluginRoots } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);

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
function writePlugin(dir, id) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), manifest(id));
  writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
  return dir;
}

const tmp = mkdtempSync(join(tmpdir(), 'cops-plugin-symlink-'));

try {
  const local = join(tmp, 'plugins.local');
  mkdirSync(local, { recursive: true });

  // A plugin living in its own checkout, linked into plugins.local/ under the
  // id it declares. The manifest id must match the LINK name, not the target
  // directory name, which is what a developer linking `career-ops-plugin-demo`
  // in as `demo` actually gets.
  const externalCheckout = writePlugin(join(tmp, 'checkouts', 'career-ops-plugin-demo'), 'demo');
  symlinkSync(externalCheckout, join(local, 'demo'));

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
  symlinkSync(join(tmp, 'checkouts', 'gone-away'), join(local, 'dangling'));

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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
