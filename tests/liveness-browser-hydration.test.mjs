// tests/liveness-browser-hydration.test.mjs — checkUrlLiveness polls the
// top-level document while an SPA hydrates.
//
// A posting that renders after domcontentloaded reads as insufficient_content
// (expired) or no_apply_control until it renders. The page doubles below
// script what each read sees and count the waits spent, so the poll's stop
// conditions are pinned without launching a browser.
import { pass, fail } from './helpers.mjs';
import { checkUrlLiveness } from '../liveness-browser.mjs';

console.log('\nliveness-browser — hydration poll');

const POSTING_URL = 'https://careers.example.com/jobs/1234';
const POSTING = 'Senior Analyst. '.repeat(30);
const isControlsRead = (fn) => String(fn).includes('querySelectorAll');

// `render(n)` returns what the n-th read (0-based) of the top-level document
// sees: { text, controls }, or throws to model a DOM being rebuilt mid-read.
const scriptedPage = ({ status = 200, render, frames }) => {
  let reads = 0;
  let current = null;
  const page = {
    waits: [],
    get reads() { return reads; },
    async goto() { return { status: () => status }; },
    async waitForTimeout(ms) { page.waits.push(ms); },
    url() { return POSTING_URL; },
    async evaluate(fn) {
      if (!isControlsRead(fn)) {
        reads += 1;
        current = render(reads - 1);
        return current.text;
      }
      return current.controls;
    },
  };
  if (frames) {
    const main = {};
    page.mainFrame = () => main;
    page.frames = () => [main, ...frames(reads)];
  }
  return page;
};

const blank = { text: '', controls: [] };
const live = { text: POSTING, controls: ['Apply for this job'] };

// Renders after K empty reads: one 250ms wait per empty read, then active.
{
  const K = 5;
  const page = scriptedPage({ render: (n) => (n < K ? blank : live) });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.result === 'active' && page.waits.length === K && page.waits.every((ms) => ms === 250)) {
    pass('a posting that renders late is read once it renders (one 250ms wait per empty read)');
  } else {
    fail(`late render: ${JSON.stringify(verdict)}, waits=${JSON.stringify(page.waits)}`);
  }
}

// Never decisive: 17 reads with 16 waits between them (4s), then the last
// not-yet verdict stands.
{
  const page = scriptedPage({ render: () => ({ text: POSTING, controls: ['Share'] }) });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.code === 'no_apply_control' && page.waits.length === 16 && page.reads === 17) {
    pass('a page that never becomes decisive stops after 16 waits and keeps no_apply_control');
  } else {
    fail(`bounded poll: ${JSON.stringify(verdict)}, waits=${page.waits.length}, reads=${page.reads}`);
  }
}

// Decisive on the first read: no wait at all.
{
  const page = scriptedPage({ render: () => live });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.result === 'active' && page.waits.length === 0 && page.reads === 1) {
    pass('a posting decisive on the first read spends no wait');
  } else {
    fail(`first-read verdict: ${JSON.stringify(verdict)}, waits=${page.waits.length}, reads=${page.reads}`);
  }
}

// 404 is decided by the status line: no wait, even with an empty body.
{
  const page = scriptedPage({ status: 404, render: () => blank });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.code === 'http_gone' && page.waits.length === 0) {
    pass('HTTP 404 returns http_gone without waiting');
  } else {
    fail(`404: ${JSON.stringify(verdict)}, waits=${page.waits.length}`);
  }
}

// A read that throws is retried rather than ending the check.
{
  const page = scriptedPage({
    render: (n) => {
      if (n === 0) throw new Error('Execution context was destroyed');
      return live;
    },
  });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.result === 'active' && page.waits.length === 1) {
    pass('a read that throws is retried on the next poll');
  } else {
    fail(`throwing read: ${JSON.stringify(verdict)}, waits=${page.waits.length}`);
  }
}

// Every read throws: the last error surfaces as navigation_error after the
// full poll, never as expired.
{
  const page = scriptedPage({ render: () => { throw new Error('Execution context was destroyed'); } });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.result === 'uncertain' && verdict.code === 'navigation_error'
      && verdict.reason.includes('Execution context was destroyed') && page.waits.length === 16) {
    pass('reads that always throw end as navigation_error after the full poll');
  } else {
    fail(`always-throwing read: ${JSON.stringify(verdict)}, waits=${page.waits.length}`);
  }
}

// An unrendered first read followed only by failing reads must not be
// reported from that stale snapshot as insufficient_content (expired).
{
  const page = scriptedPage({
    render: (n) => {
      if (n === 0) return blank;
      throw new Error('Execution context was destroyed');
    },
  });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  if (verdict.result === 'uncertain' && verdict.code === 'navigation_error' && page.waits.length === 16) {
    pass('a poll that ends on failed reads after an unrendered read is navigation_error, not expired');
  } else {
    fail(`stale unrendered reading: ${JSON.stringify(verdict)}, waits=${page.waits.length}`);
  }
}

// A same-origin frame appearing ends the top-level poll; the frame poll
// (500ms ticks) takes over and reads the posting from the frame.
{
  const frame = {
    url: () => POSTING_URL + '?in_iframe=1',
    async evaluate(fn) { return isControlsRead(fn) ? ['Apply for this job online'] : POSTING; },
  };
  const page = scriptedPage({
    render: () => ({ text: 'Careers', controls: [] }),
    frames: (reads) => (reads >= 3 ? [frame] : []),
  });
  const verdict = await checkUrlLiveness(page, POSTING_URL);
  const topLevelWaits = page.waits.filter((ms) => ms === 250).length;
  if (verdict.result === 'active' && page.reads === 3 && topLevelWaits === 2) {
    pass('a same-origin frame appearing stops the top-level poll and the frame is read');
  } else {
    fail(`frame handoff: ${JSON.stringify(verdict)}, reads=${page.reads}, waits=${JSON.stringify(page.waits)}`);
  }
}

// The headed retry's settle time is one wait before the first read, not a
// replacement for the poll.
{
  const page = scriptedPage({ render: (n) => (n < 2 ? blank : live) });
  const verdict = await checkUrlLiveness(page, POSTING_URL, { extraSettleMs: 3000 });
  if (verdict.result === 'active' && JSON.stringify(page.waits) === JSON.stringify([3000, 250, 250])) {
    pass('extraSettleMs waits once before polling starts');
  } else {
    fail(`extraSettleMs: ${JSON.stringify(verdict)}, waits=${JSON.stringify(page.waits)}`);
  }
}

// The BambooHR reload polls the same way: a reloaded page that renders late
// is still recovered.
{
  const BAMBOO = 'https://example-co.bamboohr.com/careers/1';
  let reloadedAtRead = null;
  const page = scriptedPage({
    render: (n) => (reloadedAtRead === null || n < reloadedAtRead + 3 ? blank : live),
  });
  page.url = () => BAMBOO;
  page.reload = async () => { reloadedAtRead = page.reads; return { status: () => 200 }; };
  const verdict = await checkUrlLiveness(page, BAMBOO);
  if (verdict.result === 'active' && verdict.reason.includes('after BambooHR reload retry')
      && reloadedAtRead === 17 && page.waits.length === 16 + 3) {
    pass('the BambooHR reload is polled too, so a late render after reload is recovered');
  } else {
    fail(`BambooHR reload poll: ${JSON.stringify(verdict)}, reloadedAtRead=${reloadedAtRead}, waits=${page.waits.length}`);
  }
}
