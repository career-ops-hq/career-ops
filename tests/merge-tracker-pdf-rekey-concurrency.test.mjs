import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeTracker } from '../merge-tracker.mjs';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { applyManifestRow } from '../generate-pdf.mjs';
import { parsePdfIndex } from '../find.mjs';

test('re-evaluation keeps a CV published after the initial manifest read', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'career-ops-tracker-pdf-rekey-'));
  const tracker = join(workspace, 'applications.md');
  const manifest = join(workspace, 'pdf-index.tsv');
  const adds = join(workspace, 'adds');
  try {
    mkdirSync(adds);
    mkdirSync(join(workspace, 'output'));
    mkdirSync(join(workspace, 'reports'));
    const prior = 'output/cv-previous.pdf';
    const fresh = 'output/cv-new.pdf';
    for (const pdf of [prior, fresh]) writeFileSync(join(workspace, pdf), '%PDF-1.4\n');
    writeFileSync(join(workspace, 'reports/001-acme-2026-01-04.md'), '# Old evaluation\n');
    writeFileSync(join(workspace, 'reports/002-acme-2026-02-01.md'), '# New evaluation\n');
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 3 | 2026-01-04 | Acme | Backend Engineer, Payments | 4.5/5 | Evaluated | ✅ | [1](reports/001-acme-2026-01-04.md) | first |',
      '',
    ].join('\n'));
    writeFileSync(join(adds, '002-acme.tsv'), [
      'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes',
      '2\t2026-02-01\tAcme\tBackend Engineer, Payments\t3.9/5\tEvaluated\t❌\t[2](reports/002-acme-2026-02-01.md)\tre-eval',
      '',
    ].join('\n'));
    const header = '# report\tpdf\thtml\tformat\tdate\tkind';
    writeFileSync(manifest, header + '\n1\t' + prior + '\t\tletter\t2026-01-04\tcv\n');
    const lock = await acquirePipelineLock(manifest);
    let published = false;
    try {
      const code = await mergeTracker({
        appsFile: tracker, dataRoot: workspace, additionsDir: adds, pdfIndexFile: manifest,
        batchStateFile: join(workspace, 'no-batch.tsv'),
        logger: {
          log(message) {
            if (published || !message.startsWith('🔽 Update:')) return;
            // The renderer publishes under the manifest lock before the re-key acquires it.
            const rows = applyManifestRow(readFileSync(manifest, 'utf8').split('\n'), {
              reportNum: '002', pdf: fresh, html: '', format: 'letter', date: '2026-02-01', kind: 'cv',
            });
            writeFileSync(manifest, [header, ...rows, ''].join('\n'));
            published = true;
            lock.release();
          },
          warn() {}, error(message) { console.error(message); },
        },
      });
      assert.equal(code, 0);
      assert.equal(published, true);
      const links = parsePdfIndex(readFileSync(manifest, 'utf8'));
      assert.equal(links.get('2'), fresh, 'the CV recorded by the renderer should remain linked to report 2');
      assert.equal(links.get('1'), prior, 'the prior report should retain its own CV');
      assert.match(readFileSync(tracker, 'utf8'), /✅ \| \[2\]/, 'tracker should reflect the new report’s available CV');
    } finally {
      lock.release();
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
