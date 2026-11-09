import { liveServerSkip } from '../helpers/live-server.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Fictional jobs exercise the existing Greenhouse reader, with no live requests.
function listing(jobs) { return { jobs }; }
function row(id, title, releasedAt = null, attributes = {}) {
  return { id, title, first_published: releasedAt,
    absolute_url: attributes.applicationTarget || `https://employer.example/jobs/${id}`,
    location: { name: 'London' } };
}

test('Explore adds URLs, searches a saved website and schedules new-job notices while preserving an existing monitor', {
  skip: liveServerSkip('PORTAL_MONITOR_TEST_URL', 'PORTAL_MONITOR_TEST_ROOT', 'PORTAL_MONITOR_TEST_PRELOAD'),
  timeout: 120000,
}, async t => {
  const origin = new URL(process.env.PORTAL_MONITOR_TEST_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname));
  const root = fs.realpathSync(process.env.PORTAL_MONITOR_TEST_ROOT);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, '.portal-monitor-fixture'), 'utf8').trim(), 'fictional-only');
  for (const file of ['data/portal-monitors.json', 'data/pipeline.md', 'data/scheduled-jobs.json', 'data/applications.md', 'data/scan-history.tsv', 'data/status-log.tsv']) fs.rmSync(path.join(root, file), { force: true });
  const fixture = path.join(root, 'data/website-fixture.json');
  const publish = jobs => fs.writeFileSync(fixture, JSON.stringify(listing(jobs)));
  const today = new Date().toISOString();
  const first = [row(100, 'AI working student fixture', today), row(101, 'AI internship without a date')];
  publish(first);

  const { addMonitor } = await import('../../../portal-monitor.mjs');
  const legacy = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-secondary', name: 'Legacy fixture', keywords: ['robotics'] }, {
    provider: { id: 'greenhouse', fetch: async () => [{ title: 'Robotics role', company: 'Fixture', url: 'https://example.org/jobs/77' }] },
  });
  const before = JSON.parse(fs.readFileSync(path.join(root, 'data/portal-monitors.json'), 'utf8'));
  const legacyBefore = before.sources.find(source => source.id === legacy.id);

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chrome' }), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // A UI test must never install or modify the real user's OS schedule.
  await page.route('**/api/scheduler', route => route.fulfill({ json: { platform: 'darwin', task: { exists: true, enabled: true, lastRun: null } } }));
  await page.route('**/api/portals/monitors', route => {
    if (route.request().postDataJSON()?.action === 'install-schedule') return route.abort();
    return route.continue();
  });

  await page.goto(`${origin.origin}/explore`);
  await page.getByRole('button', { name: 'Add URL', exact: true }).click();
  await page.getByLabel('URL', { exact: true }).fill('https://boards.greenhouse.io/fixture-primary');
  assert.equal(await page.getByLabel('Job board or careers page').isChecked(), true);
  await page.getByLabel('Source name (optional)').fill('Fictional careers');
  await page.getByRole('button', { name: 'Test website' }).click();
  await page.getByText(/Found 2 listings/).waitFor();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByText(/Fictional careers was added and selected/).waitFor();
  const source = page.getByLabel('Fictional careers');
  await source.waitFor();
  assert.equal(await source.isChecked(), true);
  const afterAdd = JSON.parse(fs.readFileSync(path.join(root, 'data/portal-monitors.json'), 'utf8'));
  const addedSource = afterAdd.sources.find(item => item.name === 'Fictional careers');
  assert.equal(addedSource.autoMonitor, false);
  assert.deepEqual(afterAdd.sources.find(item => item.id === legacy.id), legacyBefore);

  for (const ats of ['Greenhouse', 'Lever', 'Ashby', 'Workday']) {
    const button = page.getByRole('button', { name: ats, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
  const discover = page.getByRole('button', { name: 'Discover (free)' });
  assert.equal(await discover.isEnabled(), true);
  await discover.click();
  await page.getByText('AI working student fixture', { exact: true }).first().waitFor();
  await page.getByText('AI internship without a date', { exact: true }).first().waitFor();
  await page.getByText(/date filter could not be applied/).waitFor();
  assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false, 'an Explore search is read-only');
  await page.getByRole('button', { name: /Refine search/ }).click();
  // Empty ATS selections must survive URL restoration/reload.
  assert.equal(new URL(page.url()).searchParams.get('ats'), '', `website-only search should save an empty ATS selection: ${page.url()}`);
  await page.reload({ waitUntil: 'networkidle' });
  const sourceToggle = page.getByRole('button', { name: 'Greenhouse', exact: true });
  const reopen = page.getByRole('button', { name: /Refine search/ });
  if (await reopen.isVisible()) await reopen.click();
  await sourceToggle.waitFor();
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Greenhouse' && button.getAttribute('aria-pressed') === 'false'), null, { timeout: 5000 });
  } catch (error) {
    console.error('Restored selection:', JSON.stringify({ url: page.url(), ats: await sourceToggle.getAttribute('aria-pressed'), website: await page.getByLabel('Fictional careers').isChecked() }));
    throw error;
  }
  assert.equal(await page.getByRole('button', { name: 'Greenhouse', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByLabel('Fictional careers').isChecked(), true);

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Daily fixture search');
  await page.getByLabel('Repeat every').fill('1');
  await page.getByLabel('Schedule unit').selectOption('days');
  await page.getByRole('button', { name: 'Add scheduled scan' }).click();
  await page.getByText('Scheduled scan created.').waitFor();
  const scheduledFile = path.join(root, 'data/scheduled-jobs.json');
  const scheduled = JSON.parse(fs.readFileSync(scheduledFile, 'utf8')).jobs.find(job => job.name === 'Daily fixture search');
  assert.deepEqual(scheduled.filters.ats, []);
  assert.deepEqual(scheduled.filters.websiteIds, [addedSource.id]);

  function runWorker() {
    const output = spawnSync(process.execPath, [path.join(codeRoot, 'web/scripts/scheduled-jobs-runner.mjs'), '--job', scheduled.id], {
      cwd: codeRoot, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(process.env.PORTAL_MONITOR_TEST_PRELOAD).href}`,
        PORTAL_TEST_FIXTURE_DATA: fixture, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root,
        CAREER_OPS_PROFILE: path.join(root, 'config/profile.yml'), CAREER_OPS_PORTALS: path.join(root, 'portals.yml'),
        CAREER_OPS_SCHEDULED_JOBS_PATH: scheduledFile, CAREER_OPS_PIPELINE: path.join(root, 'data/pipeline.md'),
        CAREER_OPS_TRACKER: path.join(root, 'data/applications.md'), CAREER_OPS_SCAN_HISTORY: path.join(root, 'data/scan-history.tsv') },
    });
    assert.equal(output.status, 0, output.stderr || output.stdout);
    return JSON.parse(output.stdout);
  }
  const baseline = runWorker();
  assert.equal(baseline.rolesFound, 0);
  assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false, 'first website scan establishes a baseline');
  publish([...first, row(102, 'AI engineer newly discovered without a date', null, {
    applicationMethod: 'forward', applicationTarget: 'https://employer.example/jobs/102',
  })]);
  const next = runWorker();
  assert.equal(next.rolesFound, 1);
  const pipelineFile = path.join(root, 'data/pipeline.md');
  assert.match(fs.readFileSync(pipelineFile, 'utf8'), /AI engineer newly discovered without a date/);
  assert.match(fs.readFileSync(pipelineFile, 'utf8'), /employer\.example\/jobs\/102.*source: Fictional careers/);
  const afterRuns = JSON.parse(fs.readFileSync(path.join(root, 'data/portal-monitors.json'), 'utf8'));
  assert.deepEqual(afterRuns.sources.find(item => item.id === legacy.id), legacyBefore, 'scheduled Explore search must not alter legacy monitoring');
  assert.equal(afterRuns.notices.filter(notice => !notice.read).length, 1);

  await page.reload();
  await page.getByRole('status').filter({ hasText: '1 newly found job' }).waitFor();
  // Manually saved LinkedIn jobs never require a website adapter or email.
  const refine = page.getByRole('button', { name: /Refine search/ });
  if (await refine.count()) await refine.click();
  await page.getByRole('button', { name: 'Add URL', exact: true }).click();
  await page.getByLabel('URL', { exact: true }).fill('https://www.linkedin.com/jobs/view/fixture-1234567890/?trk=fixture');
  assert.equal(await page.getByLabel('Individual job').isChecked(), true);
  await page.getByLabel('Job title (optional, for one URL)').fill('Fictional LinkedIn position');
  const addPanel = page.getByRole('heading', { name: 'Add a job or website URL' }).locator('..').locator('..');
  await addPanel.getByRole('button', { name: 'Add to inbox', exact: true }).click();
  await page.getByText(/1 job added to your inbox/).waitFor();
  assert.match(fs.readFileSync(pipelineFile, 'utf8'), /Fictional LinkedIn position/);
  await page.getByRole('complementary').getByRole('link', { name: 'Pipeline', exact: true }).click();
  await page.getByText('Fictional LinkedIn position', { exact: false }).first().waitFor();
  const websiteRow = page.locator('li').filter({ hasText: 'AI engineer newly discovered without a date' }).last();
  const linkedinRow = page.locator('li').filter({ hasText: 'Fictional LinkedIn position' }).last();
  await websiteRow.getByTitle('Source: Fictional careers', { exact: true }).waitFor();
  await linkedinRow.getByText('LinkedIn', { exact: true }).waitFor();
  const sourceFilter = page.getByRole('button', { name: 'Fictional careers', exact: true });
  await sourceFilter.click();
  assert.equal(await linkedinRow.count(), 0, 'source filter excludes jobs from other sources');
  await sourceFilter.click();
  // Seed the tracker through the core merger so this test does not depend on
  // a local inbox-move helper or any personal automation.
  const additions = path.join(root, 'batch/tracker-additions');
  fs.mkdirSync(additions, { recursive: true });
  fs.writeFileSync(path.join(root, 'data/applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n');
  fs.writeFileSync(path.join(additions, 'fixture.tsv'), [
    '#\tDate\tCompany\tRole\tStatus\tScore\tPDF\tReport\tNotes\tURL',
    '1\t2026-10-27\tFictional employer\tAI engineer newly discovered without a date\tApplied\t—\t❌\t—\tFixture\thttps://employer.example/jobs/102', '',
  ].join('\n'));
  const { mergeTracker } = await import('../../../merge-tracker.mjs');
  assert.equal(await mergeTracker({ appsFile: path.join(root, 'data/applications.md'), dataRoot: root,
    additionsDir: additions, logger: { log() {}, warn() {}, error() {} } }), 0);
  await page.goto(`${origin.origin}/pipeline?tab=APPLIED`);
  const snapshot = await (await page.request.get(`${origin.origin}/api/pipeline`)).json();
  assert.equal(snapshot.applications.find(app => app.role === 'AI engineer newly discovered without a date')?.source, 'Fictional careers', JSON.stringify(snapshot.applications));
  const applicationRow = page.locator('tr').filter({ hasText: 'AI engineer newly discovered without a date' });
  await applicationRow.getByText('Fictional careers', { exact: true }).waitFor();

  await page.goto(`${origin.origin}/portals`);
  await page.getByRole('heading', { name: 'Saved websites' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add URL', exact: true }).count(), 0);
  await page.getByRole('heading', { name: /Fictional careers/ }).first().waitFor();
  await page.goto(`${origin.origin}/scheduled-scans`);
  await page.getByText('Daily fixture search', { exact: true }).first().waitFor();
  await page.getByText('Legacy fixture', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'New Scheduled Scan' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Scheduled Scan' });
  await dialog.getByLabel('Scan Engine').selectOption('portals');
  await dialog.getByText(/This scan checks your configured companies and job boards/).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Greenhouse', exact: true }).count(), 0);
  await dialog.getByLabel('Fictional careers').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin.origin}/explore`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.PORTAL_MONITOR_SCREENSHOT) await page.screenshot({ path: process.env.PORTAL_MONITOR_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
});
