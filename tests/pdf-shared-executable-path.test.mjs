import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('shared painters isolate socket identity by workspace root', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-pdf-data-root-'));
  const workspaceA = mkdtempSync(join(tmpdir(), 'co-pdf-workspace-a-'));
  const workspaceB = mkdtempSync(join(tmpdir(), 'co-pdf-workspace-b-'));
  const savedSocket = process.env.CAREER_OPS_PDF_SOCKET;
  const savedRoot = process.env.CAREER_OPS_ROOT;
  const savedDataDir = process.env.CAREER_OPS_DATA_DIR;
  try {
    delete process.env.CAREER_OPS_PDF_SOCKET;
    process.env.CAREER_OPS_ROOT = dataRoot;
    delete process.env.CAREER_OPS_DATA_DIR;
    assert.notEqual(
      sharedPdfSocketPath(ROOT, workspaceA),
      sharedPdfSocketPath(ROOT, workspaceB),
    );
  } finally {
    if (savedSocket === undefined) delete process.env.CAREER_OPS_PDF_SOCKET;
    else process.env.CAREER_OPS_PDF_SOCKET = savedSocket;
    if (savedRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = savedRoot;
    if (savedDataDir === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = savedDataDir;
    for (const dir of [dataRoot, workspaceA, workspaceB]) rmSync(dir, { recursive: true, force: true });
  }
});

test('shared painters resolve browser settings independently of the render workspace', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-pdf-data-root-'));
  const workspace = mkdtempSync(join(tmpdir(), 'co-pdf-workspace-'));
  const browserRootA = mkdtempSync(join(tmpdir(), 'co-pdf-browser-a-'));
  const browserRootB = mkdtempSync(join(tmpdir(), 'co-pdf-browser-b-'));
  const saved = {
    executable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    autodetect: process.env.CAREER_OPS_BROWSER_AUTODETECT,
    socket: process.env.CAREER_OPS_PDF_SOCKET,
    root: process.env.CAREER_OPS_ROOT,
    dataDir: process.env.CAREER_OPS_DATA_DIR,
  };
  try {
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    delete process.env.CAREER_OPS_BROWSER_AUTODETECT;
    delete process.env.CAREER_OPS_PDF_SOCKET;
    process.env.CAREER_OPS_ROOT = dataRoot;
    delete process.env.CAREER_OPS_DATA_DIR;
    writeFileSync(join(browserRootA, '.env'), 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=browser-a/chrome\n');
    writeFileSync(join(browserRootB, '.env'), 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=browser-b/chrome\n');

    assert.notEqual(
      sharedPdfSocketPath(ROOT, workspace, browserRootA),
      sharedPdfSocketPath(ROOT, workspace, browserRootB),
    );
  } finally {
    for (const [name, value] of [
      ['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', saved.executable],
      ['CAREER_OPS_BROWSER_AUTODETECT', saved.autodetect],
      ['CAREER_OPS_PDF_SOCKET', saved.socket],
      ['CAREER_OPS_ROOT', saved.root],
      ['CAREER_OPS_DATA_DIR', saved.dataDir],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const dir of [dataRoot, workspace, browserRootA, browserRootB]) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
