import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requestPdfRender } from '../lib/pdf-server.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const serverURL = pathToFileURL(join(ROOT, 'lib/pdf-server.mjs')).href;
const rendererURL = pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href;
const painterSource = String.raw`
  import { startPdfServer } from ${JSON.stringify(serverURL)};
  import { renderHtmlToPdf } from ${JSON.stringify(rendererURL)};
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF');
  const browser = {
    async close() {},
    async newPage() {
      return { async goto() {}, async evaluate() {}, async pdf() { return pdf; }, async close() {} };
    },
  };
  const server = await startPdfServer({
    rootDir: ${JSON.stringify(ROOT)},
    launchBrowser: async () => browser,
    render: (_browser, html, outputPath, opts) => renderHtmlToPdf(html, outputPath, {
      ...opts, launchBrowser: async () => browser,
    }),
  });
  process.on('message', async () => { await server.close(); process.disconnect(); });
  process.send({ socketPath: server.socketPath });
`;

async function painter(t, env) {
  const childEnv = { ...process.env, ...env, CAREER_OPS_PDF_SHARED: '', CAREER_OPS_PDF_SOCKET: '' };
  const child = spawn(process.execPath, ['--input-type=module', '-e', painterSource], {
    cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.send('close');
    const timeout = setTimeout(() => child.kill(), 5_000);
    try { await exited; } finally { clearTimeout(timeout); }
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`painter startup timed out: ${output}`)), 15_000);
    child.once('message', (value) => { clearTimeout(timeout); resolve(value); });
    child.once('error', (err) => { clearTimeout(timeout); reject(err); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`painter exited ${code}: ${output}`)); });
  });
}

for (const selection of ['data roots', 'trackers', 'PDF indices']) {
  test(`shared painters keep report mappings in their selected ${selection}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'co-pdf-workspaces-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const roots = [join(dir, 'first'), join(dir, selection === 'PDF indices' ? 'first' : 'second')];
    for (const root of roots) {
      mkdirSync(join(root, 'data'), { recursive: true });
      writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n');
    }
    const indices = selection === 'PDF indices'
      ? [join(dir, 'first-index.tsv'), join(dir, 'second-index.tsv')]
      : roots.map((root) => join(root, 'data', 'pdf-index.tsv'));
    const servers = [];
    for (let i = 0; i < 2; i++) {
      servers.push(await painter(t, {
        CAREER_OPS_ROOT: selection === 'trackers' ? dir : roots[i], CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_TRACKER: selection === 'trackers' ? join(roots[i], 'data', 'applications.md') : '',
        CAREER_OPS_PROFILE: '', CAREER_OPS_PDF_INDEX: selection === 'PDF indices' ? indices[i] : '',
      }));
      const outputPath = join(roots[i], 'output', `cv-${i}.pdf`);
      const result = await requestPdfRender(servers[i].socketPath, {
        html: '<html><body>Test CV</body></html>', outputPath,
        opts: { workspaceRoot: roots[i], reportNum: '7', inputPath: join(roots[i], 'cv.html') },
      });
      assert.equal(result.pageCount, 1);
      assert.ok(readFileSync(outputPath, 'utf8').startsWith('%PDF-'));
    }
    assert.match(readFileSync(indices[0], 'utf8'), /7\toutput\/cv-0\.pdf\t/,
      'the second workspace must not replace the first report mapping');
    assert.match(readFileSync(indices[1], 'utf8'), /7\toutput\/cv-1\.pdf\t/);
    assert.notEqual(servers[0].socketPath, servers[1].socketPath);
  });
}
