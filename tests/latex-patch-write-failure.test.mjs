import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { buildManifest } from '../lib/latex-content.mjs';

const cli = fileURLToPath(new URL('../patch-latex-content.mjs', import.meta.url));
const tex = String.raw`\documentclass{article}
\begin{document}
\resumeSubheading{Corp}{2024}{Engineer}{Remote}
\resumeItem{Original verified experience.}
\end{document}
`;

for (const destination of ['source', 'existing', 'new', 'success']) {
  const root = mkdtempSync(join(tmpdir(), 'latex-patch-save-'));
  const label = destination === 'success' ? 'a successful in-place LaTeX patch keeps the complete CV'
    : `an interrupted LaTeX patch preserves the ${destination} destination`;
  try {
    const source = join(root, 'source.tex');
    const output = ['source', 'success'].includes(destination) ? source : join(root, 'tailored.tex');
    const patches = join(root, 'patches.json');
    const hook = join(root, 'fail-write.cjs');
    const { slots } = buildManifest(source, tex);
    assert.ok(slots.length > 0);
    writeFileSync(source, tex);
    if (destination === 'existing') writeFileSync(output, 'Previous complete tailored CV.');
    writeFileSync(patches, JSON.stringify({ slots, patches: [{ id: slots[0].id, text: 'Updated verified experience.' }] }));
    writeFileSync(hook, `
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
function canonical(file) {
  try { return fs.realpathSync(file); }
  catch { return path.join(fs.realpathSync(path.dirname(file)), path.basename(file)); }
}
const target = process.env.LATEX_FAIL_TARGET ? canonical(process.env.LATEX_FAIL_TARGET) : '';
const write = fs.writeFileSync;
const asyncWrite = fsp.writeFile;
function interrupted(file, data, options) {
  const name = canonical(String(file));
  if (target && (name === target || (path.dirname(name) === path.dirname(target) && path.basename(name).startsWith('.' + path.basename(target) + '.') && name.endsWith('.tmp')))) {
    write(file, String(data).slice(0, 12), options);
    throw Object.assign(new Error('injected partial disk-full write'), { code: 'ENOSPC' });
  }
  return false;
}
fs.writeFileSync = (file, data, options) => interrupted(file, data, options) || write(file, data, options);
fsp.writeFile = async (file, data, options) => interrupted(file, data, options) || asyncWrite(file, data, options);
require('node:module').syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ['--require', hook, cli, source, patches, output], {
      encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', LATEX_FAIL_TARGET: destination === 'success' ? '' : output },
    });
    assert.equal(result.error, undefined);
    if (destination === 'success') {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(source, 'utf8'), tex.replace('Original verified experience.', 'Updated verified experience.'));
    } else {
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /injected partial disk-full write/);
      assert.equal(readFileSync(source, 'utf8'), tex, 'the user-owned source CV must survive a failed save');
      if (destination === 'existing') assert.equal(readFileSync(output, 'utf8'), 'Previous complete tailored CV.');
      if (destination === 'new') assert.ok(!existsSync(output), 'a partial CV must not remain at the advertised output path');
      assert.ok(!readdirSync(root).some(name => name.endsWith('.tmp')));
    }
    pass(label);
  } catch (error) { fail(`${label}: ${error.message}`); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
