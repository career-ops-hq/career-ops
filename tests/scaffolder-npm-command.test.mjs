// tests/scaffolder-npm-command.test.mjs — `npx @santifer/career-ops init` must be able to run npm on Windows
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { npmCommand } from '../scaffolder/bin/npm-command.mjs';

console.log('\nscaffolder — launching npm install (Windows EINVAL on npm.cmd)');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, actual, expected) => {
  if (same(actual, expected)) pass(name);
  else fail(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const NPM_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';

// 1. Platform branches.
check('macOS/Linux still run npm directly',
  npmCommand(['install'], { platform: 'linux', env: { npm_execpath: NPM_CLI } }),
  { file: 'npm', args: ['install'] });

check('Windows under npx runs npm-cli.js with the current Node, never npm.cmd',
  npmCommand(['install'], { platform: 'win32', env: { npm_execpath: NPM_CLI }, execPath: NODE_EXE }),
  { file: NODE_EXE, args: [NPM_CLI, 'install'] });

check('Windows without npm_execpath falls back to one fixed cmd.exe command line',
  npmCommand(['install'], { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } }),
  { file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', 'npm install'] });

check('Windows with no ComSpec still finds cmd.exe',
  npmCommand(['install'], { platform: 'win32', env: {} }).file,
  'cmd.exe');

// pnpm dlx / bunx also set npm_execpath, to their own binary: running that as
// "npm" would install with a different package manager.
for (const other of ['C:\\pnpm\\pnpm.cjs', 'C:\\Users\\me\\.bun\\bin\\bun.exe', 'C:\\yarn\\yarn.js']) {
  check(`Windows ignores a non-npm npm_execpath (${other.split('\\').pop()})`,
    npmCommand(['install'], { platform: 'win32', env: { npm_execpath: other, ComSpec: 'cmd.exe' } }).args,
    ['/d', '/s', '/c', 'npm install']);
}

// 2. Arguments joined into a cmd.exe command line must not carry shell syntax.
for (const bad of ['install & calc', 'a|b', '"x"', '%PATH%', '']) {
  try {
    npmCommand([bad], { platform: 'win32', env: {} });
    fail(`npmCommand should refuse ${JSON.stringify(bad)}`);
  } catch {
    pass(`npmCommand refuses ${JSON.stringify(bad)}`);
  }
}

// 0. The usage text must name the package that is actually published. It said
//    `npx career-ops init`, and "career-ops" (unscoped) is not ours on npm: a
//    user copying the tool's own instruction would run whatever sits there.
{
  const pkgName = JSON.parse(readFileSync(join(ROOT, 'scaffolder/package.json'), 'utf-8')).name;
  const usage = readFileSync(join(ROOT, 'scaffolder/bin/cli.mjs'), 'utf-8');
  if (usage.includes(`npx ${pkgName} init`)) pass(`usage text says npx ${pkgName} init`);
  else fail(`usage text does not name the published package (${pkgName})`);
  if (/npx career-ops\b/.test(usage)) fail('usage text still tells users to run the unscoped `npx career-ops`');
  else pass('usage text never names the unscoped package');
}

// 3. The published package must ship every module cli.mjs imports, or
//    `npx @santifer/career-ops` dies with ERR_MODULE_NOT_FOUND before it starts.
const pkg = JSON.parse(readFileSync(join(ROOT, 'scaffolder/package.json'), 'utf-8'));
const cli = readFileSync(join(ROOT, 'scaffolder/bin/cli.mjs'), 'utf-8');
const localImports = [...cli.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((m) => `bin/${m[1]}`);
if (localImports.length === 0) fail('found no local imports in scaffolder/bin/cli.mjs — has the import style changed?');
for (const file of localImports) {
  if (pkg.files.includes(file)) pass(`scaffolder package ships ${file}`);
  else fail(`scaffolder/package.json "files" is missing ${file}, which bin/cli.mjs imports`);
}

// 4. On Windows, actually run npm through both paths the scaffolder can take.
if (process.platform === 'win32') {
  const runs = (label, cmd) => {
    try {
      const out = execFileSync(cmd.file, cmd.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
      if (/^\d+\.\d+\.\d+/.test(out)) pass(`${label}: npm --version → ${out}`);
      else fail(`${label}: unexpected npm --version output ${JSON.stringify(out)}`);
    } catch (err) {
      fail(`${label}: ${err.code || ''} ${err.message.split('\n')[0]}`);
    }
  };
  runs('Windows cmd.exe fallback', npmCommand(['--version'], { env: { ComSpec: process.env.ComSpec } }));
  // test-all is usually run with plain `node`, so npm_execpath is unset here;
  // the npm bundled next to node.exe stands in for the one npx would export.
  const bundled = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = process.env.npm_execpath || (existsSync(bundled) ? bundled : null);
  if (npmCli) runs('Windows npm-cli.js path', npmCommand(['--version'], { env: { npm_execpath: npmCli } }));
}
