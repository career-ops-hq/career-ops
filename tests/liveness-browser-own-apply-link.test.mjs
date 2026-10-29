// tests/liveness-browser-own-apply-link.test.mjs — checkUrlLiveness reads an
// Apply link to the posting's own page as an Apply control, even in the page
// chrome.
//
// The walk skips nav, header and footer, whose links are the site's own (Jobs,
// Careers, Sign in). Tech in Asia puts its only Apply control, "APPLY FOR JOB"
// -> /jobs/<id>/apply, in the page header, so every live posting read
// no_apply_control and `scan --verify` dropped it.
//
// The walk runs in the page, so this file launches Chromium and is skipped with
// a warning where it cannot launch (a failure under `test-all.mjs --needs
// browser`, which the tool-suites CI job runs). The page is served by a route
// registered after the liveness guard's, which makes it run first: nothing is
// resolved or fetched.
import { pass, fail, toolUnavailable } from './helpers.mjs';
import { checkUrlLiveness, installLivenessRouteGuard, newLivenessPage } from '../liveness-browser.mjs';

console.log('\nliveness-browser — Apply link to the posting in the page chrome');

const ID = '85897690-ee8b-4d21-9914-1c11c9b17f21';
const OTHER_ID = '311c5fda-3700-48de-af8e-41a366f4e497';
const POSTING_URL = `https://www.example.com/jobs/${ID}`;
const POSTING = `<p>${'IT Governance. '.repeat(30)}</p>`;
const html = (body) => `<!doctype html><html><body>${body}</body></html>`;

let browser;
try {
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    toolUnavailable('browser', `own Apply link checks skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const check = async (url, body, frames = {}) => {
      const page = await newLivenessPage(browser);
      try {
        await installLivenessRouteGuard(page);
        for (const [frameUrl, frameBody] of Object.entries({ [url]: body, ...frames })) {
          await page.route((u) => u.href === frameUrl, (route) => route.fulfill({ contentType: 'text/html', body: html(frameBody) }));
        }
        return await checkUrlLiveness(page, url);
      } finally {
        await page.context().close();
      }
    };

    // The checks run concurrently because each one that finds no Apply control
    // waits out the full hydration poll.
    await Promise.all([
      // The shape Tech in Asia ships: title, Save and Apply in the page header.
      async () => {
        const own = await check(POSTING_URL, [
          `<header class="page-header"><h1>IT Governance</h1><button>SAVE</button>`,
          `<a href="/jobs/${ID}/apply?pathname=%2Fauth&ref=jobs_application">APPLY FOR JOB</a></header>`,
          `<main>${POSTING}</main>`,
        ].join(''));
        if (own.result === 'active' && own.code === 'apply_control_visible') {
          pass('an Apply link to the posting\'s own page in the page header reads as an Apply control');
        } else {
          fail(`Apply link to the posting in the header: ${JSON.stringify(own)}`);
        }
      },

      // The site's own links stay chrome: its jobs page, another posting, a sign-in
      // link carrying this posting only in its return address (at /account, not
      // a sign-in segment, so only reading the path keeps it out), a sign-in page
      // under the posting's own path, the footer, and links back into this page
      // under another fragment, query or trailing slash. So does a link to
      // another site with this posting's id in its path. A link to this posting
      // is still read only where it is visible.
      async () => {
        const chrome = await check(POSTING_URL, [
          `<nav><a href="${POSTING_URL}#apply">Skip to apply</a></nav>`,
          `<nav><a href="${POSTING_URL}?utm_source=header#apply">Skip to apply</a></nav>`,
          `<header><a href="${POSTING_URL}/">Apply</a></header>`,
          '<header><a href="/jobs">Apply</a></header>',
          `<nav><a href="/jobs/${OTHER_ID}/apply">Apply</a></nav>`,
          `<header><a href="/account?returnUrl=%2Fjobs%2F${ID}">Sign in to apply</a></header>`,
          `<header><a href="/jobs/${ID}/login">Sign in to apply</a></header>`,
          `<header><a href="https://jobs.example.org/jobs/${ID}/apply">Apply</a></header>`,
          '<footer><a href="/careers/apply">Apply now</a></footer>',
          `<header aria-hidden="true"><a href="/jobs/${ID}/apply">Apply</a></header>`,
          `<main>${POSTING}</main>`,
        ].join(''));
        if (chrome.result === 'uncertain' && chrome.code === 'no_apply_control') {
          pass('Apply links in the chrome to the site, another posting, another site, a sign-in page or this page itself, or hidden, are not Apply controls');
        } else {
          fail(`chrome links that are not the posting's own Apply: ${JSON.stringify(chrome)}`);
        }
      },

      // The same inside a same-origin frame, which the walk reads too (iCIMS
      // renders the posting in one). From the frame, a link back into the frame
      // or to the page it sits in is a link into this page, so it stays chrome.
      // A frame sandboxed without allow-same-origin, which cannot reach the page
      // around it through window.top, is read the same way.
      async () => {
        const frameUrl = `https://www.example.com/jobs/${ID}/frame`;
        const inFrame = (attributes) => `<main>${POSTING}</main><iframe${attributes} src="${frameUrl}"></iframe>`;
        const toPosting = { [frameUrl]: `<header><a href="/jobs/${ID}/apply">Apply</a></header>` };
        const back = { [frameUrl]: `<nav><a href="${frameUrl}#apply">Skip to apply</a></nav><header><a href="${POSTING_URL}">Apply</a></header>` };
        const attributeSets = ['', ' sandbox="allow-scripts"'];
        const [framed, framedBack] = await Promise.all([
          Promise.all(attributeSets.map((attributes) => check(POSTING_URL, inFrame(attributes), toPosting))),
          Promise.all(attributeSets.map((attributes) => check(POSTING_URL, inFrame(attributes), back))),
        ]);
        if (framed.every((r) => r.result === 'active' && r.code === 'apply_control_visible')
          && framedBack.every((r) => r.result === 'uncertain' && r.code === 'no_apply_control')) {
          pass('an Apply link to the posting in a same-origin frame\'s header reads as an Apply control, sandboxed or not, and links back into the frame or the page around it do not');
        } else {
          fail(`Apply links in a frame's chrome (plain, sandboxed): to the posting ${JSON.stringify(framed)}, back into the frame or the page around it ${JSON.stringify(framedBack)}`);
        }
      },

      // The id has to be the link's own, its last path segment that carries one,
      // whole: posting 12345 claims /jobs/12345/apply, not another posting's
      // /jobs/123456/apply, nor a segment that only contains it, nor
      // /jobs/12345/related/67890/apply, whose own posting is 67890. A posting
      // whose own segment carries the id with more around it, job-12345, claims
      // that whole segment too, and still nothing longer; registered-nurse-12345
      // is a posting, not a sign-up page. A last segment the id did not come
      // from (details) claims nothing.
      async () => {
        const numericUrl = 'https://www.example.com/jobs/12345';
        const prefixedUrl = 'https://www.example.com/jobs/job-12345';
        const sluggedUrl = 'https://www.example.com/jobs/registered-nurse-12345';
        const [numericOwn, numericOther, prefixedOwn, prefixedOther, sluggedOwn, generic] = await Promise.all([
          check(numericUrl, `<header><a href="/jobs/12345/apply">Apply</a></header><main>${POSTING}</main>`),
          check(numericUrl, [
            '<header><a href="/jobs/123456/apply">Apply</a></header>',
            '<nav><a href="/jobs/job-12345/apply">Apply</a></nav>',
            '<footer><a href="/jobs/12345/related/67890/apply">Apply</a></footer>',
            `<main>${POSTING}</main>`,
          ].join('')),
          check(prefixedUrl, `<header><a href="/jobs/job-12345/apply">Apply</a></header><main>${POSTING}</main>`),
          check(prefixedUrl, [
            '<header><a href="/jobs/job-123456/apply">Apply</a></header>',
            '<nav><a href="/jobs/senior-job-12345/apply">Apply</a></nav>',
            `<main>${POSTING}</main>`,
          ].join('')),
          check(sluggedUrl, `<header><a href="/jobs/registered-nurse-12345/apply">Apply</a></header><main>${POSTING}</main>`),
          check('https://www.example.com/jobs/12345/details', `<nav><a href="/jobs/67890/details">Apply</a></nav><main>${POSTING}</main>`),
        ]);
        if (numericOwn.result === 'active' && prefixedOwn.result === 'active' && sluggedOwn.result === 'active'
          && [numericOther, prefixedOther, generic].every((r) => r.result === 'uncertain' && r.code === 'no_apply_control')) {
          pass('a posting id, or the posting URL\'s own segment that carries it, counts only as a whole path segment: its own Apply link reads, a longer one\'s does not');
        } else {
          fail(`path segments: own ${JSON.stringify([numericOwn, prefixedOwn, sluggedOwn])}, other segments ${JSON.stringify([numericOther, prefixedOther, generic])}`);
        }
      },

      // The id comes from the URL's last path segment: a number in the query is
      // not taken for it, so it claims neither the posting's own link nor
      // another posting's /jobs/123456/apply.
      async () => {
        const queriedUrl = `${POSTING_URL}?campaign=123456`;
        const [queried, queriedOther] = await Promise.all([
          check(queriedUrl, `<header><a href="/jobs/${ID}/apply">APPLY FOR JOB</a></header><main>${POSTING}</main>`),
          check(queriedUrl, `<header><a href="/jobs/123456/apply">Apply</a></header><main>${POSTING}</main>`),
        ]);
        if (queried.result === 'active' && queried.code === 'apply_control_visible' && queriedOther.result === 'uncertain' && queriedOther.code === 'no_apply_control') {
          pass('a number in the posting URL\'s query is not taken for its id');
        } else {
          fail(`posting URL with a numeric query value: own ${JSON.stringify(queried)}, the query's number ${JSON.stringify(queriedOther)}`);
        }
      },

      // A last segment with no id falls back to a query parameter that names the
      // posting, then to the path. On UltiPro's posting URL the id is
      // opportunityId's, so a link carrying it reads, and the path's UUID is the
      // board's, so a link under the board's path stays chrome. Any other query
      // value, a campaign number here, is not the posting's id: the path's id is.
      async () => {
        const BOARD = '7fde8f3e-7920-4d9d-8394-87bd44cc2330';
        const boardUrl = `https://www.example.com/T/JobBoard/${BOARD}/OpportunityDetail?opportunityId=${ID}`;
        const campaignUrl = 'https://www.example.com/jobs/12345/details?campaign=67890';
        const [boardOwn, board, campaignOwn, campaignOther] = await Promise.all([
          check(boardUrl, `<header><a href="/T/JobBoard/${BOARD}/Apply/${ID}">Apply</a></header><main>${POSTING}</main>`),
          check(boardUrl, `<header><a href="/T/JobBoard/${BOARD}/Search">Apply</a></header><main>${POSTING}</main>`),
          check(campaignUrl, `<header><a href="/jobs/12345/apply">Apply</a></header><main>${POSTING}</main>`),
          check(campaignUrl, `<header><a href="/jobs/67890/apply">Apply</a></header><main>${POSTING}</main>`),
        ]);
        if (boardOwn.result === 'active' && boardOwn.code === 'apply_control_visible'
          && board.result === 'uncertain' && board.code === 'no_apply_control'
          && campaignOwn.result === 'active' && campaignOwn.code === 'apply_control_visible'
          && campaignOther.result === 'uncertain' && campaignOther.code === 'no_apply_control') {
          pass('with no id in the last segment, the id comes from a query parameter that names the posting (UltiPro), then the path, never another query value');
        } else {
          fail(`id outside the last segment: the posting's link on the board ${JSON.stringify(boardOwn)}, board link ${JSON.stringify(board)}, own link with a campaign number in the query ${JSON.stringify(campaignOwn)}, the campaign number's ${JSON.stringify(campaignOther)}`);
        }
      },

      // The id comes from the address the page landed on, so a posting reached
      // through a redirect reads the Apply link to that address, also when the
      // redirect only adds a slug to the requested id. A redirect to another
      // posting claims nothing: one that loses the requested URL's id reads as
      // off the posting, and one that keeps it only in a return address finds
      // no Apply control in the chrome.
      async () => {
        const LANDED = 'https://www.example.com/jobs/12345';
        const refresh = (to) => `<meta http-equiv="refresh" content="0; url=${to}">`;
        const slugged = `${LANDED}-data-engineer`;
        const another = `<header><a href="/jobs/67890/apply">Apply</a></header><main>${POSTING}</main>`;
        const returning = 'https://www.example.com/jobs/67890?returnUrl=/jobs/12345';
        const [moved, canonical, elsewhere, returned] = await Promise.all([
          check('https://www.example.com/jobs/senior-engineer', refresh(LANDED), {
            [LANDED]: `<header><a href="/jobs/12345/apply">Apply</a></header><main>${POSTING}</main>`,
          }),
          check(LANDED, refresh(slugged), {
            [slugged]: `<header><a href="/jobs/12345-data-engineer/apply">Apply</a></header><main>${POSTING}</main>`,
          }),
          check(LANDED, refresh('https://www.example.com/jobs/67890'), {
            'https://www.example.com/jobs/67890': another,
          }),
          check(LANDED, refresh(returning), { [returning]: another }),
        ]);
        if (moved.result === 'active' && moved.code === 'apply_control_visible'
          && canonical.result === 'active' && canonical.code === 'apply_control_visible'
          && elsewhere.result === 'uncertain' && elsewhere.code === 'redirected_off_posting'
          && returned.result === 'uncertain' && returned.code === 'no_apply_control') {
          pass('a posting reached through a redirect reads the Apply link to the address it landed on, and a redirect to another posting claims nothing');
        } else {
          fail(`redirects: to the posting ${JSON.stringify(moved)}, to its slug ${JSON.stringify(canonical)}, off it ${JSON.stringify(elsewhere)}, to another posting that keeps the id in a return address ${JSON.stringify(returned)}`);
        }
      },

      // With no id in the posting URL, nothing tells the posting's own link from
      // the site's, so the chrome is skipped as before.
      async () => {
        const noIdUrl = 'https://www.example.com/jobs/data-engineer';
        const noId = await check(noIdUrl, `<header><a href="/jobs/data-engineer/apply">Apply</a></header><main>${POSTING}</main>`);
        if (noId.result === 'uncertain' && noId.code === 'no_apply_control') {
          pass('without an id in the posting URL, an Apply link in the header stays chrome');
        } else {
          fail(`header Apply link on a posting URL without an id: ${JSON.stringify(noId)}`);
        }
      },
    ].map((block) => block()));
  }
} catch (e) {
  fail(`own Apply link tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}
