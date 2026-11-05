import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';
import { checkoutSystemPathsBatched } from '../update-system.mjs';

const { dir, g } = makeUpdaterRepo({ prefix: 'co-updater-web-stale-' });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

mkdirSync(join(dir, 'web', 'src'), { recursive: true });
writeFileSync(join(dir, 'web', 'src', 'version.txt'), 'old web\n');
g('add', '-A');
g('commit', '-qm', 'installed version');
const installed = g('rev-parse', 'HEAD');

writeFileSync(join(dir, 'web', 'src', 'version.txt'), 'target web\n');
g('add', '-A');
g('commit', '-qm', 'target version');
const target = g('rev-parse', 'HEAD');
g('checkout', '-q', installed);

const targetFiles = g('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(Boolean);
checkoutSystemPathsBatched(SYSTEM_PATHS, [], targetFiles, target, { git: g });

const actual = readFileSync(join(dir, 'web', 'src', 'version.txt'), 'utf8');
if (actual === 'target web\n') pass('apply manifest checkout updates an existing web/');
else fail(`apply manifest checkout leaves existing web/ stale: got ${JSON.stringify(actual)}, wanted ${JSON.stringify('target web\n')}`);
