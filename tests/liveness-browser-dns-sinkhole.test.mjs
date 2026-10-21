// tests/liveness-browser-dns-sinkhole.test.mjs — a tracker the user's DNS
// filter blocks does not decide the liveness verdict.
//
// DNS filters answer 0.0.0.0 and :: for a name they block: Pi-hole does by
// default, and so did AdGuard DNS and Control D when measured. Hosts-file
// blocklists use 0.0.0.0. Both addresses are in the egress guard's private
// list, so the request is refused, which is right. But the guard also marked
// the page blocked_host, and `scan --verify` records that as
// skipped_blocked_host, a permanent status: behind such a filter, a live
// posting that loads a blocked tracker was dropped for good.
//
// The route double is real-shaped (isNavigationRequest, frame, mainFrame), as
// in test-all's dead third-party case, because that is how the guard tells a
// subresource from the main document. The resolver is injected, so nothing
// leaves the machine.
import { pass, fail } from './helpers.mjs';
import { checkUrlLiveness, setHostResolver, validateUrlSecurity } from '../liveness-browser.mjs';

console.log('\nliveness-browser — DNS filter answers');

const POSTING_URL = 'https://careers.example.com/jobs/1';
const ANSWERS = {
  'careers.example.com': ['93.184.216.34'],
  // A filter's answer, for both address families or IPv4 only.
  'analytics.example': ['0.0.0.0', '::'],
  'pixel.example': ['0.0.0.0'],
  // A hosts-file blocklist: getaddrinfo reads the file, DNS does not.
  'hosts-file.example': ['93.184.216.34', '0.0.0.0'],
  'internal.example': ['10.0.0.1'],
  'loopback-too.example': ['0.0.0.0', '127.0.0.1'],
  'blocked-board.example': ['0.0.0.0', '::'],
};

// A posting page whose load makes one request through the guard: a
// subresource, or (navigation) the main document itself.
function postingPage(requestUrl, navigation) {
  let guard = null;
  let aborts = 0;
  const main = {};
  return {
    _blockedByGuard: null,
    get aborts() { return aborts; },
    mainFrame: () => main,
    async route(_pattern, callback) { guard = callback; },
    async goto() {
      await guard({
        request: () => ({
          url: () => requestUrl,
          isNavigationRequest: () => navigation,
          frame: () => (navigation ? main : {}),
        }),
        abort: async () => { aborts += 1; },
        continue: async () => {},
      });
      if (navigation && aborts) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
      return { status: () => 200 };
    },
    async waitForTimeout() {},
    url: () => POSTING_URL,
    async evaluate(fn) {
      return String(fn).includes('querySelectorAll') ? ['Apply for this job'] : 'Senior Analyst. '.repeat(30);
    },
  };
}

const restore = setHostResolver(async (hostname) => ANSWERS[hostname] ?? []);
try {
  for (const host of ['analytics.example', 'pixel.example', 'hosts-file.example']) {
    const label = `a tracker answered ${ANSWERS[host].join(' and ')}`;
    const page = postingPage(`https://${host}/collect.js`, false);
    const verdict = await checkUrlLiveness(page, POSTING_URL);
    if (verdict.result === 'active' && page.aborts === 1) {
      pass(`${label} is still refused, and the posting reads active`);
    } else {
      fail(`${label}: ${JSON.stringify(verdict)}, aborts=${page.aborts} (want active, aborts 1)`);
    }
  }

  // Any other private address is still an egress-guard hit about the page,
  // even next to a filter's answer.
  for (const [host, ip] of [['internal.example', '10.0.0.1'], ['loopback-too.example', '0.0.0.0']]) {
    const label = `a subresource answered ${ANSWERS[host].join(' and ')}`;
    const page = postingPage(`https://${host}/widget.js`, false);
    const verdict = await checkUrlLiveness(page, POSTING_URL);
    if (verdict.result === 'uncertain' && verdict.code === 'blocked_host'
        && verdict.reason?.includes(`private target IP ${ip}`) && page.aborts === 1) {
      pass(`${label} still makes the page blocked_host`);
    } else {
      fail(`${label}: ${JSON.stringify(verdict)}, aborts=${page.aborts} (want uncertain/blocked_host naming ${ip}, aborts 1)`);
    }
  }

  const boardUrl = 'https://blocked-board.example/jobs/1';
  const boardPage = postingPage(boardUrl, true);
  const board = await checkUrlLiveness(boardPage, boardUrl);
  if (board.result === 'uncertain' && board.code === 'dns_sinkhole' && boardPage.aborts === 1) {
    pass('a posting whose own host the filter blocks reads uncertain (dns_sinkhole), not blocked_host');
  } else {
    fail(`filtered main document: ${JSON.stringify(board)}, aborts=${boardPage.aborts} (want uncertain/dns_sinkhole, aborts 1)`);
  }

  // archive-posting.mjs shares validateUrlSecurity and only aborts on a throw,
  // so the refusal itself must not change.
  for (const [host, tagged] of [['analytics.example', true], ['loopback-too.example', false]]) {
    let error = null;
    try {
      await validateUrlSecurity(`https://${host}/`);
    } catch (err) {
      error = err;
    }
    const tag = error?.livenessCode;
    if (/^Access denied: Egress guard blocked private target IP 0\.0\.0\.0$/.test(error?.message ?? '')
        && (tagged ? tag === 'dns_sinkhole' : tag === undefined)) {
      pass(`validateUrlSecurity refuses ${ANSWERS[host].join(' and ')}${tagged ? ', tagged dns_sinkhole' : ', untagged'}`);
    } else {
      fail(`validateUrlSecurity on ${ANSWERS[host].join(' and ')}: ${error ? `${error.message} (livenessCode ${tag})` : 'allowed'}`);
    }
  }
} finally {
  // A leaked stub would answer for every later suite in this process.
  restore();
}
