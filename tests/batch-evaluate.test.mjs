import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import { processPipelineBatch, processOffer, PATHS } from '../batch-evaluate-gemini.mjs';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbatch-evaluate.test.mjs — processPipelineBatch and processOffer artifacts');

async function testProcessOffer() {
  const work = mkdtempSync(join(tmpdir(), 'cops-batcheval-'));
  const oldReports = PATHS.reports;
  const oldAdditions = PATHS.trackerAdditions;

  try {
    const reportsDir = join(work, 'reports');
    const additionsDir = join(work, 'tracker-additions');
    
    PATHS.reports = reportsDir;
    PATHS.trackerAdditions = additionsDir;
    
    // reserve-report-num.mjs respects these env vars
    process.env.CAREER_OPS_REPORTS_DIR = reportsDir;
    process.env.CAREER_OPS_TRACKER = join(work, 'applications.md');

    // Create a dummy applications.md to satisfy reserve-report-num.mjs
    mkdirSync(work, { recursive: true });
    import('fs').then(fs => fs.writeFileSync(join(work, 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n'));

    const mockBrowser = {
      newPage: async () => ({
        url: () => 'https://example.com/job',
        route: async () => {},
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => 'Valid JD Text of sufficient length (more than 100 characters). '.repeat(5),
        close: async () => {}
      })
    };

    const mockEvaluate = async () => `
---SCORE_SUMMARY---
COMPANY: Acme Corp
ROLE: Senior Engineer
SCORE: 4.5
ARCHETYPE: Tech Lead
LEGITIMACY: High Confidence
---END_SUMMARY---
`;

    const inputLine = '- [ ] https://example.com/job | Acme Corp | Senior Engineer';
    const result = await processOffer(mockBrowser, inputLine, 1, mockEvaluate);

    if (result.processed && result.line === '- [x] https://example.com/job | Acme Corp | Senior Engineer') {
      pass('processOffer returns processed: true and marks the pipeline line with [x]');
    } else {
      fail(`processOffer returned unexpected result: ${JSON.stringify(result)}`);
    }

    const reports = readdirSync(reportsDir).filter(f => !f.includes('-RESERVED.md'));
    if (reports.length === 1 && reports[0].includes('acme-corp') && reports[0].endsWith('.md')) {
      pass(`processOffer writes a markdown report: ${reports[0]}`);
      const content = readFileSync(join(reportsDir, reports[0]), 'utf-8');
      if (content.includes('**Score:** 4.5')) {
        pass('report contains the correct score');
      } else {
        fail('report missing the score');
      }
    } else {
      fail(`processOffer report write failed: ${reports}`);
    }

    const additions = readdirSync(additionsDir);
    if (additions.length === 1 && additions[0].includes('acme-corp') && additions[0].endsWith('.tsv')) {
      pass(`processOffer emits a TSV row for the tracker: ${additions[0]}`);
      const tsv = readFileSync(join(additionsDir, additions[0]), 'utf-8');
      if (tsv.includes('Acme Corp\tSenior Engineer\tEvaluated\t4.5/5')) {
        pass('TSV row contains the correct evaluation data');
      } else {
        fail(`TSV row has wrong content: ${tsv}`);
      }
    } else {
      fail(`processOffer tracker TSV write failed: ${additions}`);
    }

  } finally {
    PATHS.reports = oldReports;
    PATHS.trackerAdditions = oldAdditions;
    delete process.env.CAREER_OPS_REPORTS_DIR;
    delete process.env.CAREER_OPS_TRACKER;
    rmSync(work, { recursive: true, force: true });
  }
}

async function testDeadPostingOutcome() {
  const work = mkdtempSync(join(tmpdir(), 'cops-batcheval-dead-'));
  const oldReports = PATHS.reports;
  const oldAdditions = PATHS.trackerAdditions;

  try {
    PATHS.reports = join(work, 'reports');
    PATHS.trackerAdditions = join(work, 'tracker-additions');
    const mockBrowser = {
      newPage: async () => ({
        url: () => 'https://example.com/job', route: async () => {}, goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => 'Expired job posting content. '.repeat(8),
        close: async () => {}
      })
    };
    const result = await processOffer(
      mockBrowser,
      '- [ ] https://example.com/job | Acme Corp | Senior Engineer',
      1,
      async () => '---DEAD_POSTING---\nThis posting has expired.',
      async () => ({ result: 'expired' })
    );

    if (result.processed && result.outcome === 'dead-posting'
      && result.line === '- [x] ~~Acme Corp | Senior Engineer~~ — oferta nieaktywna') {
      pass('dead-posting marker resolves the pipeline entry without a score');
    } else {
      fail(`dead-posting marker returned unexpected result: ${JSON.stringify(result)}`);
    }
    let pagesClosed = 0;
    const goneBrowser = {
      newPage: async () => {
        let reads = 0;
        return {
          url: () => 'https://example.com/job', route: async () => {},
          goto: async () => ({ status: () => 410 }),
          waitForTimeout: async () => {},
          evaluate: async () => ++reads === 1 ? 'Job not found' : [],
          close: async () => { pagesClosed++; }
        };
      }
    };
    const verified = await processOffer(goneBrowser,
      '- [ ] https://example.com/job', 2, async () => { throw new Error('short page must bypass model'); });
    if (verified.processed && verified.outcome === 'dead-posting' && pagesClosed === 2) {
      pass('default liveness verifier confirms HTTP 410 and closes both pages');
    } else { fail(`default verifier failed: ${JSON.stringify(verified)}, closed=${pagesClosed}`); }
    const urlOnly = '- [ ] https://example.com/job';
    const closed = await processOffer(mockBrowser, urlOnly, 2,
      async () => '---DEAD_POSTING---', async () => ({ result: 'expired' }));
    if (closed.line === '- [x] ~~https://example.com/job~~ — oferta nieaktywna') {
      pass('URL-only closed posting preserves its source URL');
    } else { fail(`lost source URL: ${closed.line}`); }
    for (const verdict of ['active', 'uncertain']) {
      const pending = await processOffer(mockBrowser, urlOnly, 3,
        async () => '---DEAD_POSTING---', async (_browser, url) => {
          if (url !== 'https://example.com/job') throw new Error('wrong verification URL');
          return { result: verdict };
        });
      if (!pending.processed && pending.line === urlOnly) {
        pass(`${verdict} posting stays pending despite model closure marker`);
      } else { fail(`model closed ${verdict} posting`); }
    }
    for (const scrapeFails of [false, true]) {
      for (const verdict of ['active', 'uncertain', 'expired']) {
        let evaluated = false;
        const browser = { newPage: async () => ({
          url: () => 'https://example.com/job', route: async () => {},
          goto: async () => { if (scrapeFails) throw new Error('navigation failed'); },
          waitForTimeout: async () => {}, evaluate: async () => 'Job not found', close: async () => {}
        }) };
        const result = await processOffer(browser, urlOnly, 5,
          async () => { evaluated = true; return '---DEAD_POSTING---'; },
          async () => ({ result: verdict }));
        if (!evaluated && (verdict === 'expired'
          ? result.processed && result.outcome === 'dead-posting'
          : !result.processed && result.line === urlOnly)) {
          pass(`${scrapeFails ? 'failed' : 'short'} scrape respects independent ${verdict} verdict`);
        } else { fail(`unsafe scrape fallback: ${JSON.stringify(result)}`); }
      }
    }
    const failedCheck = await processOffer(mockBrowser, urlOnly, 4,
      async () => '---DEAD_POSTING---', async () => { throw new Error('verification unavailable'); });
    if (!failedCheck.processed && failedCheck.line === urlOnly) {
      pass('liveness verification errors leave the entry pending');
    } else { fail('verification error closed the entry'); }
    if (!existsSync(PATHS.reports) && !existsSync(PATHS.trackerAdditions)) {
      pass('dead posting writes no report or tracker addition');
    } else {
      fail('dead posting unexpectedly wrote evaluation artifacts');
    }
  } finally {
    PATHS.reports = oldReports;
    PATHS.trackerAdditions = oldAdditions;
    rmSync(work, { recursive: true, force: true });
  }
}

async function testProcessPipelineBatch() {
  const pendingIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const concurrency = 4;
  let activeCount = 0;
  let maxActiveCount = 0;
  let processedCount = 0;

  const mockProcessorFn = async (lineIdx, runIdx) => {
    activeCount++;
    if (activeCount > maxActiveCount) {
      maxActiveCount = activeCount;
    }
    
    // Delay to trigger concurrency overlap
    await new Promise(resolve => setTimeout(resolve, 20));
    
    processedCount++;
    activeCount--;
    return { line: `Processed ${lineIdx}`, processed: true };
  };

  await processPipelineBatch(pendingIndices, concurrency, mockProcessorFn);

  if (processedCount === 10) {
    pass('processPipelineBatch processes all items');
  } else {
    fail(`processPipelineBatch processed ${processedCount} instead of 10 items`);
  }

  if (maxActiveCount <= concurrency) {
    pass(`concurrency upper bound respected (max ${maxActiveCount} <= limit ${concurrency})`);
  } else {
    fail(`concurrency upper bound violated (max ${maxActiveCount} > limit ${concurrency})`);
  }

  if (maxActiveCount > 1) {
    pass(`concurrency lower bound respected (max ${maxActiveCount} > 1, did not serialize)`);
  } else {
    fail(`concurrency lower bound violated (max ${maxActiveCount} <= 1, execution serialized)`);
  }
}

async function run() {
  try {
    await testProcessPipelineBatch();
    await testProcessOffer();
    await testDeadPostingOutcome();
  } catch (err) {
    fail(`batch-evaluate tests crashed: ${err.message}`);
  }
}

// Top-level await, not a floating `run()`: this suite is imported in-process by
// test-all.mjs, and it sets CAREER_OPS_TRACKER for its own fixture. Without the
// await the import resolves immediately, the async work keeps running alongside
// later sections, and that variable stays pointed at this temp directory for a
// window whose length depends on how fast the fixture runs — which is exactly
// how the intermittent macOS-only page-budget failure in #3162 happened: a
// valid repo path got compared against this fixture's root. The finally below
// does restore it, but only once the work finishes. Awaiting here means the
// import does not resolve until the environment is clean again.
await run();
