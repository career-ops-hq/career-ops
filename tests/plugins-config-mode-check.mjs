// Spawned by plugins-config-atomic.test.mjs. Not a discovered suite: test-all
// only runs *.test.mjs, and a discovered suite must not call process.exit().
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.umask(0o077);
const dir = process.env.CO_PLUGINS_DIR;
if (!dir) throw new Error('CO_PLUGINS_DIR is required');
const file = join(dir, 'config', 'plugins.yml');
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(file, 'plugins: {}\n');
chmodSync(file, 0o640);
const { setPluginEnabled } = await import(new URL('../plugins.mjs', import.meta.url));
setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
const mode = statSync(file).mode & 0o777;
if (mode !== 0o640) throw new Error(`mode ${mode.toString(8)}`);
