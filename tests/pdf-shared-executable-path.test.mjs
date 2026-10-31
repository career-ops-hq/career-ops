import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedPdfSocketPath } from '../lib/pdf-server.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('shared painters isolate socket identity by PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-pdf-execpath-'));
  const savedExecPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const savedSocket = process.env.CAREER_OPS_PDF_SOCKET;
  const savedRoot = process.env.CAREER_OPS_ROOT;
  const savedDataDir = process.env.CAREER_OPS_DATA_DIR;
  try {
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    delete process.env.CAREER_OPS_PDF_SOCKET;
    process.env.CAREER_OPS_ROOT = dir;
    delete process.env.CAREER_OPS_DATA_DIR;
    const defaultSocket = sharedPdfSocketPath(ROOT);

    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/custom/chrome';
    const customSocket = sharedPdfSocketPath(ROOT);
    assert.notEqual(defaultSocket, customSocket);

    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '   ';
    const blankSocket = sharedPdfSocketPath(ROOT);
    assert.equal(defaultSocket, blankSocket);
  } finally {
    if (savedExecPath === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    else process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = savedExecPath;
    if (savedSocket === undefined) delete process.env.CAREER_OPS_PDF_SOCKET;
    else process.env.CAREER_OPS_PDF_SOCKET = savedSocket;
    if (savedRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = savedRoot;
    if (savedDataDir === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = savedDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
