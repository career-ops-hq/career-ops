import { pass, fail, ROOT } from './helpers.mjs';
import { processPipelineBatch, processOffer, PATHS } from '../batch-evaluate-gemini.mjs';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
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
  } catch (err) {
    fail(`batch-evaluate tests crashed: ${err.message}`);
  }
}

run();
