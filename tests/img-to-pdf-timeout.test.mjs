import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { convertImageToPdf } from '../img-to-pdf.mjs';
import { pass, fail } from './helpers.mjs';

const root = mkdtempSync(join(tmpdir(), 'image-pdf-timeout-'));
const input = join(root, 'invalid.png');
writeFileSync(input, 'not an image');
const originalLaunch = chromium.launch;
let waitCall;
let closed = false;
let pdfRequested = false;
chromium.launch = async () => ({
  async newPage() {
    return {
      async setContent() {},
      async waitForFunction(fn, arg, options) {
        waitCall = { arg, options };
        throw new Error('simulated decode timeout');
      },
      async pdf() { pdfRequested = true; },
    };
  },
  async close() { closed = true; },
});

try {
  await assert.rejects(convertImageToPdf(input, join(root, 'output.pdf')), /Image failed to decode within 10s/);
  assert.equal(waitCall.arg, undefined, 'timeout is not a page-function argument');
  assert.equal(waitCall.options?.timeout, 10_000, 'Playwright receives the advertised 10s timeout');
  assert.equal(closed, true, 'browser is closed after decode failure');
  assert.equal(pdfRequested, false, 'failed decoding never produces a PDF');
  pass('image decoding passes a 10s Playwright timeout and closes the browser on failure');
} catch (err) {
  fail(`image decoding timeout: ${err.message}`);
} finally {
  chromium.launch = originalLaunch;
  rmSync(root, { recursive: true, force: true });
}
