import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';

const cli = fileURLToPath(new URL('../generate-latex.mjs', import.meta.url));

for (const blocked of [true, false]) {
  const label = blocked ? 'LaTeX CLI fails when the compiled PDF cannot be delivered' : 'LaTeX CLI succeeds after delivering the compiled PDF';
  const root = mkdtempSync(join(tmpdir(), 'latex-finalize-'));
  try {
    const input = join(root, 'source.tex');
    const output = join(root, 'delivery.pdf');
    const stub = join(root, 'engine.cjs');
    writeFileSync(input, '\\documentclass{article}\n\\begin{document}Verified text.\\end{document}\n');
    if (blocked) mkdirSync(output);
    writeFileSync(stub, `
const cp = require('node:child_process');
const fs = require('node:fs');
cp.execFileSync = (command, args) => {
  if (!String(command).includes('tectonic')) throw new Error('Unexpected executable: ' + command);
  if (args[0] !== '--version') fs.writeFileSync(args.at(-1).replace(/\\.tex$/, '.pdf'), '%PDF-local-fixture');
  return Buffer.from('fixture engine');
};
require('node:module').syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ['--require', stub, cli, input, output, '--compile-only'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(result.error, undefined);
    const report = JSON.parse(result.stdout);
    assert.equal(report.compiled, true, result.stdout + result.stderr);
    if (blocked) {
      assert.match(report.postCompileError, /Failed to finalize PDF/);
      assert.equal(report.pdf, undefined);
      assert.equal(result.status, 1, 'engine success concealed the failed PDF delivery');
    } else {
      assert.equal(report.postCompileError, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(report.pdf.path, 'utf8'), '%PDF-local-fixture');
    }
    pass(label);
  } catch (error) { fail(`${label}: ${error.message}`); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
