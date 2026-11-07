import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { liveServerSkip } from '../helpers/live-server.mjs';

test('add, edit, delete, undo and persist job notes without changing status or other fields', { skip: liveServerSkip('JOB_NOTES_TEST_URL', 'JOB_NOTES_TEST_ROOT'), timeout: 90000 }, async t => {
  const origin = new URL(process.env.JOB_NOTES_TEST_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname));
  const root = fs.realpathSync(process.env.JOB_NOTES_TEST_ROOT);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, '.inline-status-fixture'), 'utf8').trim(), 'fictional-only');
  const tracker = path.join(root, 'data/applications.md');
  const initial = fs.readFileSync(tracker, 'utf8');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const row = () => page.locator('tbody tr').filter({ has: page.getByRole('link', { name: '#11', exact: true }) });
  const notes = () => row().getByRole('button', { name: /^Notes for/ });
  const dialog = () => page.getByRole('dialog', { name: 'Job notes', exact: true });
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  // Notes adds a column beside the existing resume link, including virtual rows.
  await page.getByRole('columnheader', { name: 'resume', exact: true }).waitFor();
  await page.getByRole('columnheader', { name: 'Notes', exact: true }).waitFor();
  assert.equal(await page.getByRole('columnheader').count(), 9);
  assert.equal(await row().locator('td').count(), 9);
  await notes().click();
  await dialog().getByLabel('New note', { exact: true }).fill('Ask for an internal referral');
  await dialog().getByRole('button', { name: 'Add note', exact: true }).click();
  await dialog().getByText('Ask for an internal referral', { exact: true }).waitFor();
  await dialog().getByLabel('New note', { exact: true }).fill('Tailor the CV before Friday');
  await dialog().getByRole('button', { name: 'Add note', exact: true }).click();
  await dialog().getByText('Tailor the CV before Friday', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: 'Edit note 2', exact: true }).click();
  await dialog().getByLabel('Edit note', { exact: true }).fill('Referral requested; waiting for a reply');
  await dialog().getByRole('button', { name: 'Save note', exact: true }).click();
  await dialog().getByText('waiting for a reply', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: 'Close notes', exact: true }).click();
  await page.reload();
  await notes().click();
  await dialog().getByText('Referral requested', { exact: true }).waitFor();
  await dialog().getByText('Tailor the CV before Friday', { exact: true }).waitFor();
  const expected = initial.replace('| Fictional fixture only |', '| Fictional fixture only; Referral requested; waiting for a reply; Tailor the CV before Friday |');
  assert.equal(fs.readFileSync(tracker, 'utf8'), expected);
  // An old status cannot be written back by a notes-only request.
  const stale = await page.request.post(`${origin.origin}/api/notes`, { data: { n: '11', status: 'Applied', note: 'Do not save' } });
  assert.equal(stale.status(), 409);
  assert.equal(fs.readFileSync(tracker, 'utf8'), expected);
  // Failed saves preserve the draft for a retry.
  await page.route('**/api/notes', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture tracker busy' }) }));
  await dialog().getByLabel('New note', { exact: true }).fill('Keep this draft');
  await dialog().getByRole('button', { name: 'Add note', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  assert.equal(await dialog().getByLabel('New note', { exact: true }).inputValue(), 'Keep this draft');
  await dialog().getByRole('button', { name: 'Close notes', exact: true }).click();
  assert.equal(fs.readFileSync(tracker, 'utf8'), expected);
  await page.unroute('**/api/notes');
  await row().getByRole('link', { name: 'Fixture Alpha', exact: true }).click();
  await page.getByRole('heading', { name: 'Fixture Alpha', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Notes for Fixture Alpha/ }).click();
  await dialog().getByText('Referral requested', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: 'Delete note 2', exact: true }).click();
  await dialog().getByText('Referral requested', { exact: true }).waitFor({ state: 'hidden' });
  await dialog().getByText('waiting for a reply', { exact: true }).waitFor();
  assert.equal(fs.readFileSync(tracker, 'utf8'), expected.replace('Referral requested; ', ''));
  await dialog().getByRole('button', { name: 'Undo delete', exact: true }).click();
  await dialog().getByText('Referral requested', { exact: true }).waitFor();
  const afterUndo = fs.readFileSync(tracker, 'utf8');
  const staleDelete = await page.request.post(`${origin.origin}/api/notes`, { data: { n: '11', status: 'Evaluated', removeNote: 'Referral requested', expectedNotes: 'an old snapshot' } });
  assert.equal(staleDelete.status(), 409);
  assert.equal(fs.readFileSync(tracker, 'utf8'), afterUndo);

  // A failed deletion keeps the note visible and the tracker untouched.
  await page.route('**/api/notes', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture tracker busy' }) }));
  await dialog().getByRole('button', { name: 'Delete note 1', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  await dialog().getByText('Fictional fixture only', { exact: true }).waitFor();
  assert.equal(fs.readFileSync(tracker, 'utf8'), afterUndo);
  await page.unroute('**/api/notes');
  await dialog().getByRole('button', { name: 'Close notes', exact: true }).click();

  // Deleting the last note returns the job to Add note and survives reload.
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  const beta = () => page.locator('tbody tr').filter({ has: page.getByRole('link', { name: '#12', exact: true }) });
  await beta().getByRole('button', { name: /^Notes for/ }).click();
  await dialog().getByRole('button', { name: 'Delete note 1', exact: true }).click();
  await dialog().getByText('No notes yet.', { exact: false }).waitFor();
  await dialog().getByRole('button', { name: 'Close notes', exact: true }).click();
  await page.reload();
  assert.equal(await beta().getByRole('button', { name: /^Notes for/ }).innerText(), 'Add note');
  const betaBefore = afterUndo.split('\n').find(line => line.startsWith('| 12 |'));
  assert.equal(fs.readFileSync(tracker, 'utf8'), afterUndo.replace(betaBefore, betaBefore.replace('| Fictional fixture only |', '| — |')));

  // Hand-edited separator spacing still produces notes the UI can delete.
  const beforeSpacing = fs.readFileSync(tracker, 'utf8');
  const betaEmpty = beforeSpacing.split('\n').find(line => line.startsWith('| 12 |'));
  fs.writeFileSync(tracker, beforeSpacing.replace(betaEmpty, betaEmpty.replace(/\| — \|$/, '| first  ;   second  ;  third |')));
  await page.reload();
  await beta().getByRole('button', { name: /^Notes for/ }).click();
  await dialog().getByRole('button', { name: 'Delete note 2', exact: true }).click();
  await dialog().getByText('second', { exact: true }).waitFor({ state: 'hidden' });
  await dialog().getByText('first', { exact: true }).waitFor();
  await dialog().getByText('third', { exact: true }).waitFor();
  assert.match(fs.readFileSync(tracker, 'utf8').split('\n').find(line => line.startsWith('| 12 |')), /\| first  ;   third \|/);

  const beforeInvalid = fs.readFileSync(tracker, 'utf8');
  for (const action of [
    { note: 'bad\0note' },
    { note: 'new', replaceNote: 'bad\0previous' },
    { removeNote: 'bad\0note', expectedNotes: 'first  ;   third' },
    { removeNote: 'first', expectedNotes: 'bad\0snapshot' },
  ]) {
    const response = await page.request.post(`${origin.origin}/api/notes`, { data: { n: '12', status: 'Applied', ...action } });
    assert.equal(response.status(), 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(fs.readFileSync(tracker, 'utf8'), beforeInvalid);
});
