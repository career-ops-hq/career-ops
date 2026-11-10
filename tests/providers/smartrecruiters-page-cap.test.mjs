// tests/providers/smartrecruiters-page-cap.test.mjs — a SmartRecruiters board
// larger than the page cap is reported as cut short, and an entry can raise
// the cap with max_pages.
//
// The walk stopped at 50 pages (5,000 postings) and returned that prefix as
// the whole board: Bosch listed 5,104 on 2026-11-10, so 104 postings were
// never read, nothing said so, and scan.mjs logged the board `reachable`. The
// API reports `totalFound`, so the walk can tell a cut-short board from a
// complete one, as oraclecloud.mjs does since #6690.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — smartrecruiters page cap');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/smartrecruiters.mjs')).href);
  const sr = mod.default;
  const { boardTruncation } = await import(pathToFileURL(join(ROOT, 'lib/board-truncation.mjs')).href);

  /** A board of `total` postings, served 100 a page as the API pages it. */
  function board(total, { reportTotal = true, maxPages } = {}) {
    const offsets = [];
    const ctx = {
      ...(maxPages ? { maxPages } : {}),
      fetchJson: async (url) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        offsets.push(offset);
        const n = Math.max(0, Math.min(100, total - offset));
        const content = Array.from({ length: n }, (_, i) => ({ id: `J${offset + i}`, name: `Role ${offset + i}` }));
        return reportTotal ? { totalFound: total, content } : { content };
      },
    };
    return { ctx, offsets };
  }

  /** fetch() with console.error captured. */
  async function walk(entry, ctx) {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      return { jobs: await sr.fetch(entry, ctx), errors };
    } finally {
      console.error = original;
    }
  }

  const bosch = { name: 'Bosch', careers_url: 'https://careers.smartrecruiters.com/BoschGroup' };

  {
    const { ctx } = board(5104);
    const { jobs, errors } = await walk(bosch, ctx);
    const t = boardTruncation(jobs);
    if (jobs.length === 5000 && t?.reason === 'page-cap' && t.fetched === 5000 && t.total === 5104) {
      pass('a board past the cap is marked page-cap, 5000 of 5104');
    } else {
      fail(`5104-posting board: ${jobs.length} jobs, truncation ${JSON.stringify(t)}`);
    }
    if (errors.some((e) => e.includes('Bosch truncated at max_pages=50 (5000 of 5104 jobs)') && e.includes('raise max_pages'))) {
      pass('and says so on stderr, naming the entry and how to raise the cap');
    } else {
      fail(`no truncation warning: ${JSON.stringify(errors)}`);
    }
  }

  {
    const { ctx } = board(5000);
    const { jobs, errors } = await walk(bosch, ctx);
    if (jobs.length === 5000 && boardTruncation(jobs) === null && errors.length === 0) {
      pass('a board that ends exactly at the cap is not marked');
    } else {
      fail(`5000-posting board: ${jobs.length} jobs, truncation ${JSON.stringify(boardTruncation(jobs))}, errors ${JSON.stringify(errors)}`);
    }
  }

  {
    const { ctx } = board(5104, { reportTotal: false });
    const { jobs, errors } = await walk(bosch, ctx);
    const t = boardTruncation(jobs);
    if (t?.reason === 'page-cap' && t.fetched === 5000 && !('total' in t) && errors.some((e) => e.includes('total unknown'))) {
      pass('with no totalFound, a walk the cap ended is still marked, total unknown');
    } else {
      fail(`no totalFound: truncation ${JSON.stringify(t)}, errors ${JSON.stringify(errors)}`);
    }
  }

  {
    const { ctx, offsets } = board(5104);
    const { jobs, errors } = await walk({ ...bosch, max_pages: 60 }, ctx);
    if (jobs.length === 5104 && boardTruncation(jobs) === null && errors.length === 0 && offsets.length === 52) {
      pass('max_pages: 60 reads the whole board, and stops at its short last page');
    } else {
      fail(`max_pages 60: ${jobs.length} jobs in ${offsets.length} requests, errors ${JSON.stringify(errors)}`);
    }
  }

  {
    const { ctx, offsets } = board(20000);
    const { jobs } = await walk({ ...bosch, max_pages: 1000 }, ctx);
    const t = boardTruncation(jobs);
    if (offsets.length === mod.SR_HARD_MAX_PAGES && t?.fetched === mod.SR_HARD_MAX_PAGES * 100) {
      pass(`max_pages above the ceiling is held to ${mod.SR_HARD_MAX_PAGES} pages`);
    } else {
      fail(`max_pages 1000: ${offsets.length} requests, truncation ${JSON.stringify(t)}`);
    }
  }

  {
    const { ctx, offsets } = board(5104, { maxPages: 1 });
    const { jobs, errors } = await walk(bosch, ctx);
    if (offsets.length === 1 && boardTruncation(jobs) === null && errors.length === 0) {
      pass('a one-page health probe (ctx.maxPages) is not reported as a truncation');
    } else {
      fail(`probe: ${offsets.length} requests, truncation ${JSON.stringify(boardTruncation(jobs))}, errors ${JSON.stringify(errors)}`);
    }
  }

  for (const [value, expected] of [[undefined, 50], [0, 50], [-3, 50], ['80', 50], [2.5, 50], [80, 80]]) {
    const got = mod.resolveMaxPages({ max_pages: value });
    if (got === expected) pass(`resolveMaxPages(${JSON.stringify(value)}) is ${expected}`);
    else fail(`resolveMaxPages(${JSON.stringify(value)}) = ${got}, expected ${expected}`);
  }
} catch (e) {
  fail(`smartrecruiters page-cap test crashed: ${e.message}`);
}
