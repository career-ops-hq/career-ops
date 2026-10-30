import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pass, fail, getBash } from './helpers.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

check('tailoring two same-company reports retains both application-specific CVs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tailor-report-identity-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'config/profile.yml'), 'name: Jane Doe\n');
    writeFileSync(join(root, 'cv.md'), '# Jane Doe\nVerified experience.\n');
    const jd = join(root, 'jd.txt');
    writeFileSync(jd, 'A local test posting.');
    const stub = join(root, 'endpoint.cjs');
    writeFileSync(stub, `globalThis.fetch = async (url) => {
      if (String(url) !== 'http://127.0.0.1:7777/v1/chat/completions') throw new Error('Unexpected network request');
      return { ok: true, json: async () => ({ choices: [{ message: { content: process.env.TEST_TAILORED_HTML } }] }) };
    };`);
    const outputs = [];
    for (const number of ['001', '002']) {
      const report = join(root, 'reports', number + '-acme-2026-01-01.md');
      writeFileSync(report, '# Evaluation: Acme — Engineer\n\nTwo different requisitions.');
      const html = `<html><body>Verified CV for application ${number}</body></html>`;
      const result = spawnSync(process.execPath, ['--require', stub, 'openai-tailor.mjs', '--jd', jd, '--report', report, '--url', 'http://127.0.0.1:7777/v1', '--model', 'local-fixture'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', OPENAI_API_KEY: '', TEST_TAILORED_HTML: html },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const path = result.stdout.match(/Tailored HTML saved: (.+)/)?.[1];
      assert.ok(path, result.stdout);
      outputs.push({ path, html, nextPdf: result.stdout.match(/node generate-pdf\.mjs .+ (output\/\S+\.pdf) --format/)?.[1] });
    }
    assert.notEqual(outputs[0].path, outputs[1].path, 'second report overwrote the first report CV');
    assert.notEqual(outputs[0].nextPdf, outputs[1].nextPdf, 'the suggested PDF outputs collide');
    assert.equal(readdirSync(join(root, 'output')).filter(name => name.endsWith('.html')).length, 2);
    for (const output of outputs) assert.equal(readFileSync(output.path, 'utf8'), output.html);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const reportFilename of [
  '003-acme senior engineer.md',
  "003-acme team's report.md",
  '003-acme-$TEST_REPORT_FRAGMENT-$(printf injected)-`printf extra`;report.md',
]) {
  check(`the suggested PDF command preserves literal report paths: ${reportFilename}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'tailor-pdf-command-'));
    try {
      mkdirSync(join(root, 'config'));
      mkdirSync(join(root, 'reports'));
      writeFileSync(join(root, 'config/profile.yml'), 'name: Jane Doe\n');
      writeFileSync(join(root, 'cv.md'), '# Jane Doe\nVerified experience.\n');
      const jd = join(root, 'jd.txt');
      const report = join(root, 'reports', reportFilename);
      writeFileSync(jd, 'A local test posting.');
      writeFileSync(report, '# Evaluation: Acme — Engineer\n');
      const stub = join(root, 'endpoint.cjs');
      writeFileSync(stub, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '<html><body>Verified CV</body></html>' } }] }) });`);
      const result = spawnSync(process.execPath, ['--require', stub, 'openai-tailor.mjs', '--jd', jd, '--report', report, '--url', 'http://127.0.0.1:7777/v1', '--model', 'local-fixture'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', OPENAI_API_KEY: '' },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const command = result.stdout.split('\n').find(line => line.trim().startsWith('node generate-pdf.mjs '));
      assert.ok(command, result.stdout);
      writeFileSync(join(root, 'generate-pdf.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
      const pdf = spawnSync(getBash(), ['-c', command.trim()], {
        cwd: root, encoding: 'utf8', env: { ...process.env, TEST_REPORT_FRAGMENT: 'expanded' },
      });
      assert.equal(pdf.error, undefined);
      assert.equal(pdf.status, 0, pdf.stdout + pdf.stderr);
      const stem = `output/cv-jane-doe-${reportFilename.replace(/\.md$/i, '')}`;
      assert.deepEqual(JSON.parse(pdf.stdout.trim()), [`${stem}.html`, `${stem}.pdf`, '--format=letter', '--report=003']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
