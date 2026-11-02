// tests/linkedin-url.test.mjs — the shared LinkedIn job-URL parser.
//
// lib/linkedin-url.mjs is the one body that reads a LinkedIn posting URL. The
// `linkedin` rung of liveness-api.mjs and aggregatorPostingId in url-key.mjs
// resolve through it, and any other
// consumer is meant to import it (or test parity against it) instead of copying
// the regexes. So the shapes are pinned here on the module itself, and the later
// sections check that both consumers still give the same answer.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { linkedInJobId, linkedInPathJobId, linkedInGuestUrl } from '../lib/linkedin-url.mjs';
import { resolveAtsApi } from '../liveness-api.mjs';
import { aggregatorPostingId } from '../url-key.mjs';

console.log('\nlib/linkedin-url.mjs — LinkedIn job-URL parser');

function check(desc, condition, details = '') {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
}

const ID = '4402976479';
const idOf = (url) => linkedInJobId(new URL(url));

// -- 1. every shape that carries a posting id --------------------------------
const ACCEPTS = [
  ['/jobs/view/{id}', `https://www.linkedin.com/jobs/view/${ID}`],
  ['/jobs/view/{id}/ with a trailing slash', `https://www.linkedin.com/jobs/view/${ID}/`],
  ['/jobs/view/{title-slug}-{id}', `https://www.linkedin.com/jobs/view/staff-software-engineer-at-acme-${ID}`],
  ['a slug that itself contains digits', `https://www.linkedin.com/jobs/view/engineer-2-at-acme-${ID}/`],
  ['/jobs/view/{id} with tracking params', `https://www.linkedin.com/jobs/view/${ID}/?refId=abc&trk=public_jobs`],
  ['a search page with ?currentJobId=', `https://www.linkedin.com/jobs/search/?currentJobId=${ID}&keywords=engineer`],
  ['the /comm/ link LinkedIn emails carry', `https://www.linkedin.com/comm/jobs/view/${ID}?trk=eml-job_card&trkEmail=eml-x`],
  ['a collection page with ?currentJobId=', `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=${ID}`],
  ['the bare apex host', `https://linkedin.com/jobs/view/${ID}`],
  ['a regional subdomain', `https://uk.linkedin.com/jobs/view/${ID}`],
  ['an uppercase host (the URL parser lowercases it)', `https://WWW.LinkedIn.COM/jobs/view/${ID}`],
];
for (const [desc, url] of ACCEPTS) {
  const got = idOf(url);
  check(`${desc} yields the job id`, got === ID, `${url} -> ${JSON.stringify(got)}`);
}

// The path wins over the query: on /jobs/view/ the page IS the posting.
check('a /jobs/view/ id wins over a different ?currentJobId=',
  idOf(`https://www.linkedin.com/jobs/view/${ID}/?currentJobId=111`) === ID);

// -- 2. what must NOT yield an id --------------------------------------------
const REJECTS = [
  ['a non-LinkedIn host', `https://example.com/jobs/view/${ID}`],
  ['a lookalike host', `https://notlinkedin.com/jobs/view/${ID}`],
  ['a subdomain-suffix lookalike host', `https://linkedin.com.evil.example/jobs/view/${ID}`],
  ['a lookalike host carrying ?currentJobId=', `https://linkedin.com.evil.example/jobs/search/?currentJobId=${ID}`],
  ['a profile URL', 'https://www.linkedin.com/in/example-person'],
  ['a company jobs page', 'https://www.linkedin.com/company/acme/jobs/'],
  ['/jobs/view/ with no id', 'https://www.linkedin.com/jobs/view/'],
  ['a slug with no trailing id', 'https://www.linkedin.com/jobs/view/staff-software-engineer-at-acme'],
  ['a non-numeric job id', 'https://www.linkedin.com/jobs/view/not-a-number/'],
  ['/comm/ with a title slug (emails never carry one)', `https://www.linkedin.com/comm/jobs/view/staff-engineer-${ID}`],
  ['an id followed by more path', `https://www.linkedin.com/jobs/view/${ID}/apply`],
  ['an uppercase path (paths are case-sensitive)', `https://www.linkedin.com/Jobs/View/${ID}`],
  ['a search page with no posting id', 'https://www.linkedin.com/jobs/search/?keywords=engineer'],
  ['an empty currentJobId', 'https://www.linkedin.com/jobs/search/?currentJobId='],
  ['a non-numeric currentJobId', 'https://www.linkedin.com/jobs/search/?currentJobId=abc'],
  ['a currentJobId with a trailing non-digit', `https://www.linkedin.com/jobs/search/?currentJobId=${ID}x`],
];
for (const [desc, url] of REJECTS) {
  const got = idOf(url);
  check(`${desc} yields no id`, got === null, `${url} -> ${JSON.stringify(got)}`);
}

// -- 3. the guest endpoint ---------------------------------------------------
check('the guest endpoint is the fixed host plus the id',
  linkedInGuestUrl(ID) === `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${ID}`, linkedInGuestUrl(ID));

// -- 4. the liveness rung resolves through this module -----------------------
// resolveAtsApi additionally refuses anything that is not https, so every URL
// above (all https) must agree with it exactly.
for (const [desc, url] of [...ACCEPTS, ...REJECTS]) {
  const id = idOf(url);
  const rung = resolveAtsApi(url);
  const agrees = id === null
    ? rung === null
    : rung?.ats === 'linkedin' && rung.parts.id === id && rung.apiUrl === linkedInGuestUrl(id);
  check(`liveness rung agrees: ${desc}`, agrees, `${url} -> ${JSON.stringify(rung)}`);
}

// -- 5. url-key.mjs reads the same id --------------------------------------
// aggregatorPostingId matches the host its own way (it folds trailing dots), then
// reads the path through linkedInPathJobId: same answer on every URL above.
for (const [desc, url] of [...ACCEPTS, ...REJECTS]) {
  const id = idOf(url);
  const agg = aggregatorPostingId(url);
  const got = agg?.domain === 'linkedin.com' ? agg.id : null;
  check(`url-key agrees: ${desc}`, got === id, `${url} -> ${JSON.stringify(agg)}`);
}
// The one place they differ on purpose: a trailing-dot host is still LinkedIn to
// url-key (it folds the dot), while the liveness rung keeps its strict host test.
const dotted = `https://linkedin.com./jobs/view/${ID}`;
check('url-key folds a trailing-dot host', aggregatorPostingId(dotted)?.id === ID, JSON.stringify(aggregatorPostingId(dotted)));
check('linkedInJobId keeps the strict host test', idOf(dotted) === null);
check('linkedInPathJobId reads the path without the host',
  linkedInPathJobId(new URL(`https://example.com/comm/jobs/view/${ID}`)) === ID);

// -- 6. loadable outside Node, and shipped by the updater --------------------
// A browser bundle has to be able to load this file, so it must import nothing.
const src = readFileSync(join(ROOT, 'lib', 'linkedin-url.mjs'), 'utf-8');
check('the module has no imports', !/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(src));

// liveness-api.mjs is a SYSTEM_PATHS file: an upgraded install whose updater
// had no entry for this module would check out a liveness-api that cannot load.
const manifestSrc = readFileSync(join(ROOT, 'lib', 'update-manifest.mjs'), 'utf-8');
check('the updater ships lib/linkedin-url.mjs', manifestSrc.includes("'lib/linkedin-url.mjs'"));
