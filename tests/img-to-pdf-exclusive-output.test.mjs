import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pass, fail, rmSync } from './helpers.mjs';

const cli = fileURLToPath(new URL('../img-to-pdf.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'image-pdf-exclusive-'));
const input = join(root, 'input.png');
const preload = join(root, 'browser.cjs');
writeFileSync(input, 'synthetic image; decoded by the browser stand-in');
writeFileSync(preload, `
  const { createRequire } = require('node:module');
  const { writeFileSync, existsSync } = require('node:fs');
  const { join } = require('node:path');
  const { chromium } = createRequire(${JSON.stringify(cli)})('playwright');
  const root = process.env.IMAGE_TEST_ROOT;
  const id = process.env.IMAGE_TEST_ID;
  chromium.launch = async () => ({
    async newPage() {
      return {
        async setContent() {},
        async waitForFunction() {},
        async evaluate() { return { width: 96, height: 96 }; },
        async pdf() {
          if (process.env.IMAGE_TEST_RACE) {
            writeFileSync(join(root, 'ready-' + id), 'ready');
            const end = Date.now() + 5000;
            while (!existsSync(join(root, 'ready-1')) || !existsSync(join(root, 'ready-2'))) {
              if (Date.now() > end) throw new Error('both renderers did not reach the write barrier');
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          return Buffer.from('%PDF-synthetic-' + id);
        },
      };
    },
    async close() { writeFileSync(join(root, 'closed-' + id), 'closed'); },
  });
`);

function run(id, output, { force = false, race = false } = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, ['--require', preload, cli, input, output, ...(force ? ['--force'] : [])], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, IMAGE_TEST_ROOT: root, IMAGE_TEST_ID: id, IMAGE_TEST_RACE: race ? '1' : '' },
    }, (error, stdout, stderr) => resolve({ id, status: error ? error.code : 0, stdout, stderr }));
  });
}

try {
  try {
    const output = join(root, 'race.pdf');
    const results = await Promise.all([run('1', output, { race: true }), run('2', output, { race: true })]);
    const winners = results.filter(result => result.status === 0);
    assert.equal(winners.length, 1, JSON.stringify(results));
    const loser = results.find(result => result.status !== 0);
    assert.equal(loser.status, 1);
    assert.match(loser.stderr, /EEXIST|already exists/);
    assert.equal(readFileSync(output, 'utf8'), '%PDF-synthetic-' + winners[0].id);
    assert.ok(existsSync(join(root, 'closed-1')) && existsSync(join(root, 'closed-2')));
    pass('concurrent image conversions keep the winning PDF and reject the other writer');
  } catch (error) { fail(`image conversion race: ${error.message}`); }

  try {
    const output = join(root, 'existing.pdf');
    writeFileSync(output, 'original PDF');
    const denied = await run('denied', output);
    assert.equal(denied.status, 1);
    assert.equal(readFileSync(output, 'utf8'), 'original PDF');
    const forced = await run('forced', output, { force: true });
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(readFileSync(output, 'utf8'), '%PDF-synthetic-forced');
    pass('only an explicit --force overwrites an existing image PDF');
  } catch (error) { fail(`image conversion force: ${error.message}`); }
} finally { rmSync(root, { recursive: true, force: true }); }
