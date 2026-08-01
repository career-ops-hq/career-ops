#!/usr/bin/env node
// manifesto.mjs — read The CareerOps Manifesto and open the signing page.
// Zero dependencies. No network calls beyond opening your own browser.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = 'https://career-ops.org/manifesto';

try {
  const text = readFileSync(join(here, 'MANIFESTO.md'), 'utf8');
  const lines = text.split('\n');
  // the opening couplet (lines 5-6 of the manifesto)
  console.log('\n  ' + lines[4] + '\n  ' + lines[5] + '\n');
} catch {
  console.log('');
}
console.log('Read it:  MANIFESTO.md  ·  ' + PAGE);
console.log('Sign it:  takes 10 seconds, becomes a public signature with your name on the wall.');
console.log('');

const openers = { darwin: 'open', win32: 'start', linux: 'xdg-open' };
const cmd = openers[process.platform] || 'xdg-open';
try {
  const child = spawn(cmd, [PAGE], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32'
  });
  child.on('error', () => {});
  child.unref();
} catch {
  // no opener available: the URL is printed above
}
