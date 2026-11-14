import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { liveServerSkip } from '../helpers/live-server.mjs';

test('select all shown supports filters, partial selections and confirmed batch scoring', { skip: liveServerSkip('INBOX_SELECT_TEST_URL', 'INBOX_SELECT_TEST_ROOT'), timeout: 90000 }, async t => {
  const origin = new URL(process.env.INBOX_SELECT_TEST_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname));
  const root = fs.realpathSync(process.env.INBOX_SELECT_TEST_ROOT);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, '.inbox-undo-fixture'), 'utf8').trim(), 'fictional-only');
  const pipeline = path.join(root, 'data/pipeline.md');
  const extras = Array.from({ length: 23 }, (_, index) => `- [ ] https://example.com/extra-${index} | Fixture Extra ${index} | Engineer | Toronto`).join('\n');
  fs.appendFileSync(pipeline, extras + '\n');
  const before = fs.readFileSync(pipeline, 'utf8');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const runs = [];
  await page.addInitScript(() => { localStorage.setItem('career-ops:config', JSON.stringify({ cliId: 'fixture-cli' })); localStorage.setItem('career-ops:first-score-seen', '1'); });
  await page.route('**/api/clis', route => route.fulfill({ json: { clis: [{ id: 'fixture-cli', installed: true }] } }));
  await page.route('**/api/runs/save', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/run', route => { runs.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: 'Fictional scoring request intercepted; no model was run' } }); });
  const all = () => page.getByRole('checkbox', { name: 'Select all shown jobs', exact: true });
  const checks = () => page.getByRole('checkbox', { name: /^Select (?!all shown jobs)/ });
  const checked = () => page.getByRole('checkbox', { name: /^Select (?!all shown jobs)/, checked: true });
  const filter = () => page.getByPlaceholder('Filter by company or role…', { exact: true });
  async function until(check) {
    for (let i = 0; i < 200; i++) { if (await check()) return; await page.waitForTimeout(50); }
    assert.fail('Expected selection state was not reached');
  }
  await page.goto(`${origin.origin}/pipeline?tab=INBOX`);
  await all().waitFor();
  await until(() => all().isEnabled());
  assert.equal(await checks().count(), 20, 'fresh list is capped at 20');
  await all().check();
  await until(async () => await checked().count() === 20);
  assert.equal(runs.length, 0);
  await page.getByRole('checkbox', { name: 'Select Fixture Alpha Engineer', exact: true }).uncheck();
  await until(() => all().evaluate(input => input.indeterminate));
  await all().check();
  assert.equal(await checked().count(), 20);
  await all().uncheck();
  assert.equal(await checked().count(), 0);

  // Filtered results retain upstream's 20-row cap until See all is requested.
  await filter().fill('Fixture Extra');
  await until(async () => await checks().count() === 20);
  await all().check();
  await until(async () => await checked().count() === 20);
  await page.getByRole('button', { name: /See all 23 matches/ }).click();
  await until(async () => await checks().count() === 23);
  await all().check();
  await until(async () => await checked().count() === 23);

  // Filtered select-all never includes hidden rows. Empty filters disable it.
  await filter().fill('Fixture Alpha');
  await until(async () => await checks().count() === 1);
  await until(async () => await checked().count() === 0);
  await all().check();
  await page.getByRole('button', { name: 'Save to shortlist', exact: true }).click();
  await page.getByRole('button', { name: /^Shortlist.*\(1\)$/ }).waitFor();
  await filter().fill('no matching jobs');
  await until(async () => !await all().isEnabled());
  await until(async () => await page.getByRole('button', { name: 'Save to shortlist', exact: true }).count() === 0);

  await filter().fill('');
  await page.getByRole('button', { name: /See all 25 in inbox/ }).click();
  await until(async () => await checks().count() === 25);
  await all().check();
  assert.equal(await checked().count(), 25);
  await page.getByRole('button', { name: 'Save to shortlist', exact: true }).click();
  await page.getByRole('button', { name: /^Shortlist.*\(25\)$/ }).waitFor();
  assert.equal(runs.length, 0, 'selection and shortlisting spend no tokens');
  await page.getByRole('button', { name: /^Score 25(?! now)/ }).click();
  await page.getByRole('button', { name: 'Score 25 now', exact: true }).waitFor();
  assert.equal(runs.length, 0, 'existing scoring confirmation is retained');
  await page.getByRole('button', { name: 'Score 25 now', exact: true }).click();
  await until(() => runs.length === 25);
  assert.equal(new Set(runs.map(run => run.input)).size, 25, 'already shortlisted jobs are not duplicated');
  assert.ok(runs.every(run => run.kind === 'evaluate' && run.input.startsWith('https://example.com/')));
  assert.equal(fs.readFileSync(pipeline, 'utf8'), before);
});
