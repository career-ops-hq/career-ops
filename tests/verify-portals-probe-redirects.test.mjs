// verify-portals — the portal probes follow a redirect only one checked hop
// at a time (#4079).
//
// `_http.mjs` refuses redirects by default, and the probes are the one caller
// that still follows them, because a moved board answers with a 3xx. Following
// with redirect:'follow' left every hop after the first unchecked: the IP guard
// validates a hostname when it resolves, and a literal address is dialled
// without a lookup at all. These cases drive the real probe against a stubbed
// fetch, so the redirect mode each request was made with is visible.

import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nverify-portals — probe redirects are followed one checked hop at a time');

const { probeSlug } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

const OLD = 'https://boards-api.greenhouse.io/v1/boards/old-slug/jobs';
const NEW = 'https://boards-api.greenhouse.io/v1/boards/new-slug/jobs';

/**
 * Run one probe against a stubbed fetch; returns the probe result and the
 * requests made. Under redirect:'follow' the stub follows an http(s) Location
 * itself, as a real fetch does, so a probe that still asked for that would
 * show every hop it was taken to.
 */
async function probeWith(respond) {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async function stub(url, init) {
    seen.push({ url: String(url), redirect: init?.redirect });
    const response = respond(String(url));
    const location = response.headers.get('location');
    if ((init?.redirect ?? 'follow') === 'follow' && location && seen.length < 20) {
      const next = new URL(location, url);
      if (next.protocol === 'http:' || next.protocol === 'https:') return stub(next.href, init);
    }
    return response;
  };
  try {
    return { result: await probeSlug('greenhouse', 'old-slug'), seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const redirectTo = (location) => new Response('', { status: 301, headers: { location } });
const jobs = () =>
  new Response('{"jobs":[{"id":1}]}', { status: 200, headers: { 'content-type': 'application/json' } });

{
  const { result, seen } = await probeWith((url) => (url === OLD ? redirectTo(NEW) : jobs()));
  if (
    result.status === 'live' &&
    seen.map((request) => request.url).join(' ') === `${OLD} ${NEW}` &&
    seen.every((request) => request.redirect === 'manual')
  ) {
    pass('a moved board is followed to its new address, each hop requested with redirect:manual');
  } else {
    fail(`moved board should be followed hop by hop — got ${JSON.stringify({ result, seen })}`);
  }
}

for (const location of [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1:8080/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:a9fe:a9fe]/',
  'http://2130706433/',
  'file:///etc/passwd',
]) {
  const { result, seen } = await probeWith((url) => (url === OLD ? redirectTo(location) : jobs()));
  if (seen.length === 1 && result.status === 'missing' && result.httpStatus === 301) {
    pass(`a redirect to ${location} is not followed`);
  } else {
    fail(`a redirect to ${location} must not be followed — got ${JSON.stringify({ result, seen })}`);
  }
}

{
  let hops = 0;
  const { result, seen } = await probeWith(() =>
    ++hops < 50 ? redirectTo(`https://boards-api.greenhouse.io/v1/boards/loop-${hops}/jobs`) : jobs(),
  );
  if (seen.length === 6 && result.status === 'missing' && result.httpStatus === 301) {
    pass('a redirect chain stops after five followed hops');
  } else {
    fail(`redirect chain should stop after five hops — got ${seen.length} requests, ${JSON.stringify(result)}`);
  }
}
