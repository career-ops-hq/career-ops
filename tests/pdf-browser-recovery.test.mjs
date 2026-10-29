import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPdfServer, requestPdfRender } from '../lib/pdf-server.mjs';

for (const duringRender of [false, true]) {
  test(`shared PDF painter recovers after Chromium disconnects ${duringRender ? 'during a render' : 'between renders'}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'co-pdf-recover-'));
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\co-pdf-recover-${process.pid}-${Number(duringRender)}`
      : join(dir, 'p.sock');
    const browsers = [];
    const server = await startPdfServer({
      socketPath,
      launchBrowser: async () => {
        const browser = new EventEmitter();
        browser.connected = true;
        browser.close = async () => {};
        browsers.push(browser);
        return browser;
      },
      render: async (browser, html, outputPath) => {
        if (html === 'crash') {
          browser.connected = false;
          browser.emit('disconnected');
        }
        if (!browser.connected) throw new Error('Browser has been closed');
        writeFileSync(outputPath, html);
        return { outputPath, pageCount: 1, size: Buffer.byteLength(html) };
      },
    });
    const request = (html) => requestPdfRender(socketPath, { html, outputPath: join(dir, `${html}.pdf`), opts: {} });
    try {
      await request('first');
      if (duringRender) {
        await assert.rejects(request('crash'), /Browser has been closed/);
      } else {
        browsers[0].connected = false;
        browsers[0].emit('disconnected');
      }
      const results = await Promise.all([request('second'), request('third')]);
      assert.equal(browsers.length, 2, 'concurrent requests must share one replacement browser');
      for (const result of results) assert.equal(result.pageCount, 1);
      assert.equal(readFileSync(join(dir, 'second.pdf'), 'utf8'), 'second');
      assert.equal(readFileSync(join(dir, 'third.pdf'), 'utf8'), 'third');
      assert.equal(readFileSync(join(dir, 'first.pdf'), 'utf8'), 'first');
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
