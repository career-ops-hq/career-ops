// Optional real-Chrome keyboard + CDP accessibility-tree regression.
// Run against a loopback server backed by disposable data. Every stream/write is
// intercepted; no CLI is invoked and no application is submitted.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.WORKER_FEEDBACK_TEST_URL;
test("workers expose task-specific state and notify once without moving focus", { skip: liveServerSkip("WORKER_FEEDBACK_TEST_URL"), timeout: 120_000 }, async () => {
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  const origin = parsed.origin;
  const replies = new Map();
  const workers = new Map();
  const unexpectedWrites = [];
  let saved;
  let revision = 0;
  let browser;
  let page;
  const fixture = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const data = JSON.parse(text);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.writeHead(200, { 'Content-Type': req.url === '/run' ? 'application/x-ndjson' : 'text/plain' });
    res.flushHeaders();
    if (req.url === '/run') workers.set(data.input, res);
    else replies.set(data.message, res);
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    await page.addInitScript(() => {
      localStorage.setItem('career-ops:config', JSON.stringify({ cliId: 'fixture-cli' }));
      localStorage.setItem('career-ops:first-score-seen', '1');
      window.__workerNotices = [];
      let previous = "";
      new MutationObserver(() => {
        const text = document.querySelector('[role="status"][aria-label="Worker task status"]')?.textContent.trim() || "";
        if (text && text !== previous) window.__workerNotices.push(text);
        previous = text;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'GET') return route.continue();
      unexpectedWrites.push(route.request().url());
      return route.abort();
    });
    await page.route('**/api/assistant/chats**', (route) => {
      const req = route.request();
      if (req.method() === 'PUT') {
        saved = { ...req.postDataJSON(), revision: ++revision, title: 'Fictional worker audit' };
        return route.fulfill({ json: saved });
      }
      return route.fulfill({ json: new URL(req.url()).searchParams.has('id') ? saved : { chats: saved ? [{ id: saved.id, revision, title: saved.title }] : [], errors: [] } });
    });
    await page.route('**/api/clis', (route) => route.fulfill({ json: { clis: [{ id: 'fixture-cli', installed: true }] } }));
    await page.route('**/api/pipeline', (route) => route.fulfill({ json: {
      applications: [], inbox: [
        { company: 'FixtureCo', role: 'Platform Engineer', url: 'https://example.com/batch-platform', done: false },
        { company: 'FixtureCo', role: 'Product Designer', url: 'https://example.com/batch-design', done: false },
      ],
    } }));
    await page.route('**/api/runs/save', (route) => route.fulfill({ json: { ok: true } }));
    for (const path of ['assistant', 'run']) await page.route('**/api/' + path, (route) => route.continue({ url: 'http://127.0.0.1:' + fixture.address().port + '/' + path }));
    const input = page.getByRole('textbox', { name: 'Message to assistant', exact: true });
    const opener = page.getByRole('button', { name: 'Ask the assistant', exact: true });
    const status = page.getByRole('status', { name: 'Assistant request status', exact: true });
    async function until(check, message) {
      for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 30)); }
      throw new Error(message || 'Expected state not reached');
    }
    async function tabTo(locator) {
      for (let i = 0; i < 160; i++) {
        if (await locator.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error('Target not reachable by Tab');
    }
    async function jobs() { return page.evaluate(() => JSON.parse(localStorage.getItem('career-ops:jobs') || '[]')); }
    async function send(message, reply) {
      await tabTo(input); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
      await page.keyboard.type(message);
      await until(() => page.getByRole('button', { name: 'Send', exact: true }).isEnabled());
      await page.keyboard.press('Enter');
      await until(() => replies.has(message), 'Assistant fixture not requested');
      replies.get(message).end(reply);
      await until(async () => (await status.innerText()).startsWith('Reply ready.'));
    }
    const taskStatus = page.getByRole('status', { name: 'Worker task status', exact: true });
    const latest = page.getByRole('group', { name: 'Latest assistant reply', exact: true });
    const tray = page.getByRole('complementary');
    const notices = () => page.evaluate(() => window.__workerNotices);
    const focused = (locator) => locator.evaluate((el) => el === document.activeElement);
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function progress(url, ev) { workers.get(url).write(JSON.stringify(ev) + '\n'); }
    function finish(url, ev) { workers.get(url).end(JSON.stringify(ev) + '\n'); }
    async function treeHas(role, name, property) {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      return nodes.some((n) => !n.ignored && n.role?.value === role && n.name?.value === name &&
        (!property || n.properties?.some((p) => p.name === property[0] && p.value.value === property[1])));
    }
    async function snapshot(name) {
      const out = process.env.WORKER_FEEDBACK_ARTIFACT_DIR;
      if (!out) return;
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, `${name}.ax.json`), JSON.stringify(await cdp.send('Accessibility.getFullAXTree'), null, 2));
      await writeFile(path.join(out, `${name}.aria.txt`), await page.locator('body').ariaSnapshot());
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    }
    async function launch(name, title = name) {
      const url = 'https://example.com/' + name;
      await send(name, `Starting a fictional worker.\n<<act:evaluate ${JSON.stringify({ url, title })}>>`);
      await until(() => workers.has(url));
      return url;
    }
    await page.goto(origin + '/pipeline?tab=ALL');
    await opener.waitFor(); await tabTo(opener); await page.keyboard.press('Enter'); await input.waitFor();
    assert.equal(await taskStatus.count(), 1);
    assert.equal(await taskStatus.innerText(), '');
    assert.ok(await treeHas('status', 'Worker task status', ['live', 'polite']));
    assert.ok(await treeHas('status', 'Worker task status', ['atomic', true]));

    const alpha = await launch('Alpha', 'Alpha · Engineer');
    const runningName = 'Open worker: Alpha · Engineer — Running';
    const runningLink = tray.getByRole('link', { name: runningName, exact: true });
    await runningLink.waitFor(); await tabTo(runningLink);
    assert.ok(await treeHas('link', runningName, ['focused', true]));
    progress(alpha, { type: 'tool', name: 'WebFetch' });
    await pause(1100); // At least one timer tick while this link remains focused.
    assert.equal(await focused(runningLink), true);
    assert.equal(await runningLink.getAttribute('aria-label'), runningName);
    assert.deepEqual(await notices(), []);
    await snapshot('running-link-focused');
    assert.equal(await runningLink.locator('button').count(), 0, 'dismiss must not be nested in a link');
    await tabTo(input); await page.keyboard.type('Keep this draft');
    progress(alpha, { type: 'text', text: 'VERDICT: 4/5 — Fictional match\n' });
    // Duplicate terminal protocol events and duplicate card instances are quiet.
    progress(alpha, { type: 'done', tokens: 100 });
    finish(alpha, { type: 'done', tokens: 100 });
    await until(async () => (await notices()).length === 1);
    assert.deepEqual(await notices(), ['Alpha · Engineer: completed.']);
    assert.equal(await focused(input), true);
    assert.equal(await input.inputValue(), 'Keep this draft');
    const completedName = 'Open worker: Alpha · Engineer — Completed';
    assert.ok(await treeHas('link', completedName));
    assert.ok(await treeHas('group', 'Alpha · Engineer'));
    assert.equal(await latest.getByRole('link', { name: completedName, exact: true }).count(), 1);
    assert.equal(await latest.locator('[aria-live], [role="status"], [role="alert"], [role="log"]').count(), 0);
    await pause(650);
    assert.equal((await notices()).length, 1);

    const beta = await launch('Beta', 'Beta · Analyst');
    finish(beta, { type: 'error', msg: 'Fictional evaluation failed' });
    await until(async () => (await notices()).length === 2);
    assert.equal((await notices()).at(-1), 'Beta · Analyst: failed.');
    assert.ok(await treeHas('link', 'Open worker: Beta · Analyst — Failed'));
    assert.equal(await focused(input), true);

    await send('Batch', 'Review this fictional batch.\n<<act:evaluateCompany {"company":"FixtureCo"}>>');
    const confirm = page.getByRole('button', { name: /^Confirm: Evaluate 2 FixtureCo postings/ });
    await confirm.waitFor();
    assert.equal(workers.has('https://example.com/batch-platform'), false, 'batch must wait for human confirmation');
    await tabTo(confirm); await page.keyboard.press('Enter');
    await until(() => workers.has('https://example.com/batch-platform') && workers.has('https://example.com/batch-design'));
    await tabTo(input);
    await latest.getByText('2 running', { exact: true }).waitFor();
    assert.ok(await treeHas('link', 'Open worker: Evaluate · FixtureCo · Platform Engineer — Running'));
    assert.ok(await treeHas('link', 'Open worker: Evaluate · FixtureCo · Product Designer — Running'));
    assert.equal(await latest.getByText('Platform Engineer · Running', { exact: true }).count(), 1);
    finish('https://example.com/batch-platform', { type: 'done', tokens: 200 });
    finish('https://example.com/batch-design', { type: 'error', msg: 'Fictional evaluation failed' });
    await until(async () => (await notices()).length === 3);
    assert.equal((await notices()).at(-1), 'Evaluate · FixtureCo · Platform Engineer: completed. Evaluate · FixtureCo · Product Designer: failed.');
    await latest.getByText('1 completed, 1 failed', { exact: true }).waitFor();
    await snapshot('mixed-batch-settled');
    assert.ok(await treeHas('link', 'Open worker: Evaluate · FixtureCo · Product Designer — Failed'));
    assert.equal(await focused(input), true);

    // Global worker feedback survives closing the Assistant; it never steals focus.
    const delta = await launch('Delta', 'Delta · Auditor');
    await page.keyboard.press('Escape'); await opener.waitFor();
    assert.equal(await focused(opener), true);
    finish(delta, { type: 'done' });
    await until(async () => (await notices()).length === 4);
    assert.equal((await notices()).at(-1), 'Delta · Auditor: completed.');
    assert.equal(await focused(opener), true);
    await page.keyboard.press('Enter'); await input.waitFor(); await pause(650);
    assert.equal((await notices()).length, 4, 'reopening does not replay completions');

    // A distinct task with the same name/outcome must still mutate the live region.
    const duplicateTitle = await launch('Delta-again', 'Delta · Auditor');
    finish(duplicateTitle, { type: 'done' });
    await until(async () => (await notices()).length === 5);
    assert.equal((await notices()).at(-1), 'Delta · Auditor: completed.');

    // A closed stream without an explicit done event is failure, even though the
    // Assistant reply has already finished. No completion is inferred from prose.
    const cutOff = await launch('Cut-off', 'Cut-off · Engineer');
    workers.get(cutOff).end();
    await until(async () => (await notices()).length === 6);
    assert.equal((await notices()).at(-1), 'Cut-off · Engineer: failed.');
    assert.equal(await focused(input), true);

    // Configuration failure can settle before the first running-card render.
    await page.route('**/api/clis', (route) => route.fulfill({ json: { clis: [] } }));
    await send('No CLI', 'Starting a fictional worker.\n<<act:evaluate {"url":"https://example.com/no-cli","title":"No CLI task"}>>');
    await until(async () => (await notices()).length === 7);
    assert.equal((await notices()).at(-1), 'No CLI task: failed.');
    assert.equal(workers.has('https://example.com/no-cli'), false);
    assert.equal(await focused(input), true);
    await page.route('**/api/clis', (route) => route.fulfill({ json: { clis: [{ id: 'fixture-cli', installed: true }] } }));

    await launch('Gamma', 'Gamma · Researcher');
    await until(async () => (await jobs()).some((j) => j.title === 'Gamma · Researcher' && j.status === 'running'));
    await page.reload();
    await until(async () => (await jobs()).some((j) => j.title === 'Gamma · Researcher' && j.status === 'error'));
    await taskStatus.waitFor(); await pause(650);
    assert.equal(await taskStatus.innerText(), '');
    assert.deepEqual(await notices(), [], 'settled history and interrupted restoration are silent');
    await snapshot('history-restored');
    await opener.waitFor(); await tabTo(opener); await page.keyboard.press('Enter'); await input.waitFor();
    await pause(650); assert.deepEqual(await notices(), []);

    const failedLink = tray.getByRole('link', { name: 'Open worker: Gamma · Researcher — Failed', exact: true });
    await tabTo(failedLink);
    assert.ok(await treeHas('link', 'Open worker: Gamma · Researcher — Failed', ['focused', true]));
    await page.keyboard.press('Enter'); await page.waitForURL('**/jobs/job-*');
    await page.locator('h1').waitFor();
    assert.deepEqual(await notices(), [], 'client navigation/mounts do not replay history');
    const dismiss = tray.getByRole('button', { name: 'Dismiss worker: Gamma · Researcher', exact: true });
    await tabTo(dismiss);
    await until(async () => (await dismiss.evaluate((el) => getComputedStyle(el).opacity)) === '1');
    assert.ok(await treeHas('button', 'Dismiss worker: Gamma · Researcher', ['focused', true]));
    await page.keyboard.press('Enter');
    await until(async () => !(await jobs()).some((j) => j.title === 'Gamma · Researcher'));
    assert.deepEqual(unexpectedWrites, []);
  } finally {
    await browser?.close();
    replies.forEach((r) => r.end()); workers.forEach((r) => r.end());
    fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve));
  }
});

// Settled fictional history exercises the shared control without starting jobs.
test("worker dismiss stays discoverable without hover and by keyboard", { skip: liveServerSkip("WORKER_FEEDBACK_TEST_URL"), timeout: 60_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  for (const mode of [
    { name: "desktop", width: 1440, hasTouch: false },
    { name: "wide-touch", width: 1440, hasTouch: true },
    { name: "mobile-touch", width: 390, hasTouch: true },
  ]) {
    await t.test(mode.name, async () => {
      const context = await browser.newContext({ viewport: { width: mode.width, height: 900 }, hasTouch: mode.hasTouch });
      try {
        const page = await context.newPage();
        const unexpected = [];
        await page.addInitScript(() => localStorage.setItem("career-ops:jobs", JSON.stringify([{
          id: "dismiss-fixture", title: "Fictional evaluation", subtitle: "Engineer", status: "done",
          steps: [], text: "", startedAt: 1, endedAt: 2,
        }])));
        await page.route("**/api/**", (route) => {
          if (route.request().method() === "GET") return route.continue();
          unexpected.push(route.request().url());
          return route.abort();
        });
        await page.goto(`${origin.origin}/pipeline?tab=ALL`);
        assert.equal(await page.evaluate(() => matchMedia("(hover: hover)").matches), !mode.hasTouch);
        const tray = mode.width < 768
          ? page.getByRole("dialog", { name: "Navigation menu", exact: true })
          : page.getByRole("complementary");
        if (mode.width < 768) await page.getByRole("button", { name: "Open menu", exact: true }).tap();
        const dismiss = tray.getByRole("button", { name: "Dismiss worker: Fictional evaluation · Engineer", exact: true });
        await dismiss.waitFor();
        async function until(check, message) {
          for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 25)); }
          assert.fail(`${mode.name}: ${message}`);
        }
        const opacity = () => dismiss.evaluate((el) => getComputedStyle(el).opacity);
        if (mode.hasTouch) {
          assert.equal(await dismiss.evaluate((el) => el === document.activeElement), false);
          await until(async () => (await opacity()) === "1", "dismiss must be visible before hover or focus");
          await dismiss.tap();
        } else {
          await until(async () => (await opacity()) === "0", "desktop default stays hidden");
          await tray.getByRole("link", { name: "Open worker: Fictional evaluation · Engineer — Completed", exact: true }).hover();
          await until(async () => (await opacity()) === "1", "pointer hover reveals dismiss");
          await page.mouse.move(1100, 850);
          await until(async () => (await opacity()) === "0", "leaving hover hides dismiss");
          for (let i = 0; i < 100 && !(await dismiss.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
          assert.equal(await dismiss.evaluate((el) => el === document.activeElement), true);
          await until(async () => (await opacity()) === "1", "keyboard focus reveals dismiss without hover");
          const cdp = await context.newCDPSession(page);
          const { nodes } = await cdp.send("Accessibility.getFullAXTree");
          assert.ok(nodes.some((n) => !n.ignored && n.role?.value === "button" && n.name?.value === "Dismiss worker: Fictional evaluation · Engineer" && n.properties?.some((p) => p.name === "focused" && p.value.value === true)));
          await page.keyboard.press("Enter");
        }
        await until(() => page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:jobs") || "[]").length === 0), "dismiss removes the worker");
        assert.equal(page.url(), `${origin.origin}/pipeline?tab=ALL`, "dismiss must not follow the details link");
        assert.deepEqual(unexpected, [], "dismiss must not write through an API");
      } finally {
        await context.close();
      }
    });
  }
});
