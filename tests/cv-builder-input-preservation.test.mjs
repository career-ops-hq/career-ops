// A render output must never replace the JSON payload it was built from.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, pass, fail, warn } from './helpers.mjs';

const html = {
  candidate: { name: 'Test Candidate', email: 'candidate@example.invalid' },
  summary: 'Builds test systems.',
  experience: [{ company: 'Fictional Ltd', role: 'Engineer', dates: '2024 - Present', bullets: ['Built test systems.'] }],
  education: [{ title: 'BSc', org: 'Test University', year: '2024' }],
};
const latex = {
  name: 'Test Candidate', email: 'candidate@example.invalid',
  experience: html.experience,
  education: [{ institution: 'Test University', degree: 'BSc', dates: '2024' }],
};
const formats = [
  { name: 'HTML', script: 'build-cv-html.mjs', payload: html, args: (input, output) => [input, output], rendered: /<!DOCTYPE html>/ },
  { name: 'Markdown', script: 'build-cv-html.mjs', payload: html, args: (input, output) => [input, '--markdown', output], rendered: /^# Test Candidate/m },
  { name: 'LaTeX', script: 'build-cv-latex.mjs', payload: latex, args: (input, output) => [input, output], rendered: /\\documentclass/ },
];

function check(label, fn) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-cv-input-'));
  try { if (fn(root) !== false) pass(label); else warn(`${label}: case-sensitive filesystem, alias unavailable`); }
  catch (err) { fail(`${label}: ${err.message}`); process.exitCode = 1; }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
}
function run(root, format, args, zeroInode = false) {
  const preload = `import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const stat = fs.stat;
    fs.stat = async (...args) => {
      const result = await stat(...args);
      result.ino = args[1]?.bigint ? 0n : 0;
      return result;
    };
    syncBuiltinESMExports();`;
  return spawnSync(process.execPath, [...(zeroInode ? ["--import", `data:text/javascript,${encodeURIComponent(preload)}`] : []), join(ROOT, format.script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: '' },
  });
}

for (const format of formats) {
  for (const alias of ['same path', 'directory alias', 'hard link']) {
    check(`${format.name} preserves its payload through ${alias}`, root => {
      const input = join(root, 'payload.json');
      const original = JSON.stringify(format.payload);
      writeFileSync(input, original);
      let output = input;
      if (alias === 'directory alias') {
        const dir = join(root, 'alias');
        symlinkSync(root, dir, 'junction');
        output = join(dir, 'payload.json');
      } else if (alias === 'hard link') {
        output = join(root, 'rendered.txt');
        linkSync(input, output);
      }
      const result = run(root, format, format.args(input, output));
      assert.equal(readFileSync(input, 'utf8'), original, 'source JSON was overwritten');
      assert.equal(result.status, 1, result.stderr || result.error?.message);
      assert.match(result.stderr, /Output path is the input file/);
    });
  }
  check(`${format.name} preserves a case-only alias without inode identity`, root => {
    const input = join(root, 'payload.json');
    const output = join(root, 'PAYLOAD.JSON');
    const original = JSON.stringify(format.payload);
    writeFileSync(input, original);
    // Only a case-insensitive filesystem can expose this alias.
    if (!existsSync(output)) return false;
    const result = run(root, format, format.args(input, output), true);
    assert.equal(readFileSync(input, 'utf8'), original, 'case alias overwrote source JSON');
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, /Output path is the input file/);
  });
  check(`${format.name} renders a distinct existing file without inode identity`, root => {
    const input = join(root, 'payload.json');
    const output = join(root, 'rendered.txt');
    const original = JSON.stringify(format.payload);
    writeFileSync(input, original);
    writeFileSync(output, 'Previous output');
    const result = run(root, format, format.args(input, output), true);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(readFileSync(input, 'utf8'), original);
    assert.match(readFileSync(output, 'utf8'), format.rendered);
  });
  check(`${format.name} still renders to a separate output file`, root => {
    const input = join(root, 'payload.json');
    const output = join(root, 'rendered.txt');
    const original = JSON.stringify(format.payload);
    writeFileSync(input, original);
    const result = run(root, format, format.args(input, output));
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(readFileSync(input, 'utf8'), original);
    assert.match(readFileSync(output, 'utf8'), format.rendered);
  });
}

check('HTML preview preserves an input at its default output path', root => {
  mkdirSync(join(root, 'output'));
  const input = join(root, 'output', 'cv-preview.html');
  const original = JSON.stringify(html);
  writeFileSync(input, original);
  const result = run(root, formats[0], ['--preview', input]);
  assert.equal(readFileSync(input, 'utf8'), original, 'preview replaced its source JSON');
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.match(result.stderr, /Output path is the input file/);
});
