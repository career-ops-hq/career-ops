// tests/ats-board-url.test.mjs: the canonical board URL (lib/ats-board-url.mjs)
// is one every provider reads, and the one discover-ats.mjs builds.
//
// The employer registry keys every row on buildBoardUrl(), and discover-ats.mjs
// builds its probe candidates with the same functions. Two things would break
// silently without these checks:
//   - a URL form the provider's own detect() does not accept: the row would be
//     valid in the registry and unreadable by the scanner;
//   - discovery and the registry building different URLs for the same board.
//
// Run:  node --test tests/ats-board-url.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_ATS,
  BOARD_URL_BUILDERS,
  REGIONAL_BOARD_URL_BUILDERS,
  REGIONS,
  SLUG_RE,
  WORKDAY_HOSTS,
  buildBoardUrl,
} from '../lib/ats-board-url.mjs';
import {
  buildBoardUrl as discoverBuildBoardUrl,
  SLUG_RE as discoverSlugRe,
  buildCandidateUrls,
  buildWorkdayCandidates,
} from '../discover-ats.mjs';

import greenhouse from '../providers/greenhouse.mjs';
import ashby from '../providers/ashby.mjs';
import lever from '../providers/lever.mjs';
import workable from '../providers/workable.mjs';
import smartrecruiters from '../providers/smartrecruiters.mjs';
import rippling from '../providers/rippling.mjs';
import joinProvider from '../providers/join.mjs';
import recruitee from '../providers/recruitee.mjs';
import breezy from '../providers/breezy.mjs';
import bamboohr from '../providers/bamboohr.mjs';
import pinpoint from '../providers/pinpoint.mjs';
import workday from '../providers/workday.mjs';

const PROVIDERS = {
  greenhouse, ashby, lever, workable, smartrecruiters, rippling, join: joinProvider,
  recruitee, breezy, bamboohr, pinpoint, workday,
};

// Every ATS, every region, every Workday host form, with the URL each must build.
const FORMS = [
  [{ ats: 'greenhouse', region: 'us', board: 'acme' }, 'https://job-boards.greenhouse.io/acme'],
  [{ ats: 'greenhouse', region: 'eu', board: 'acme' }, 'https://job-boards.eu.greenhouse.io/acme'],
  [{ ats: 'lever', region: 'us', board: 'acme' }, 'https://jobs.lever.co/acme'],
  [{ ats: 'lever', region: 'eu', board: 'acme' }, 'https://jobs.eu.lever.co/acme'],
  [{ ats: 'ashby', board: 'AlephAlpha' }, 'https://jobs.ashbyhq.com/AlephAlpha'],
  [{ ats: 'ashby', board: 'acme.ai' }, 'https://jobs.ashbyhq.com/acme.ai'],
  [{ ats: 'workable', board: 'acme' }, 'https://apply.workable.com/acme'],
  [{ ats: 'smartrecruiters', board: 'AcmeGroup' }, 'https://careers.smartrecruiters.com/AcmeGroup'],
  [{ ats: 'rippling', board: 'acme-inc' }, 'https://ats.rippling.com/acme-inc/jobs'],
  [{ ats: 'join', board: 'acme' }, 'https://join.com/companies/acme'],
  [{ ats: 'recruitee', board: 'acme' }, 'https://acme.recruitee.com'],
  [{ ats: 'breezy', board: 'acme' }, 'https://acme.breezy.hr'],
  [{ ats: 'bamboohr', board: 'acme' }, 'https://acme.bamboohr.com'],
  [{ ats: 'pinpoint', board: 'acme' }, 'https://acme.pinpointhq.com'],
  [{ ats: 'workday', workday_host: 'jobs', board: 'acme/wd5/External_Careers' }, 'https://acme.wd5.myworkdayjobs.com/External_Careers'],
  [{ ats: 'workday', workday_host: 'site', board: 'acme/wd1/AcmeCareers' }, 'https://wd1.myworkdaysite.com/recruiting/acme/AcmeCareers'],
];

test('the closed ATS list is the twelve that discovery can resolve', () => {
  assert.deepEqual([...BOARD_ATS], [
    'greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'rippling', 'join',
    'recruitee', 'breezy', 'bamboohr', 'pinpoint', 'workday',
  ]);
  assert.deepEqual(Object.keys(PROVIDERS).sort(), [...BOARD_ATS].sort());
});

test('the forms cover every ATS, both regions of greenhouse and lever, and both Workday hosts', () => {
  for (const ats of BOARD_ATS) assert.ok(FORMS.some(([f]) => f.ats === ats), `no form for ${ats}`);
  for (const ats of Object.keys(REGIONAL_BOARD_URL_BUILDERS)) {
    for (const region of REGIONS) assert.ok(FORMS.some(([f]) => f.ats === ats && f.region === region), `${ats} ${region}`);
  }
  for (const host of WORKDAY_HOSTS) assert.ok(FORMS.some(([f]) => f.ats === 'workday' && f.workday_host === host), `workday ${host}`);
});

for (const [form, expected] of FORMS) {
  const label = [form.ats, form.region, form.workday_host].filter(Boolean).join(' ');
  test(`${label}: builds ${expected}, and the ${form.ats} provider's detect() accepts it`, () => {
    const url = buildBoardUrl(form);
    assert.equal(url, expected);
    const detected = PROVIDERS[form.ats].detect({ name: 'Acme', careers_url: url });
    assert.ok(detected && typeof detected.url === 'string', `${form.ats}.detect() rejected ${url}`);
  });
}

test('detect() reads the board the URL names: region, case and Workday coordinates survive', () => {
  const api = (form) => PROVIDERS[form.ats].detect({ name: 'Acme', careers_url: buildBoardUrl(form) }).url;
  assert.equal(api({ ats: 'greenhouse', region: 'eu', board: 'acme' }), 'https://boards-api.greenhouse.io/v1/boards/acme/jobs');
  assert.equal(api({ ats: 'lever', region: 'eu', board: 'acme' }), 'https://api.eu.lever.co/v0/postings/acme');
  assert.match(api({ ats: 'ashby', board: 'AlephAlpha' }), /\/job-board\/AlephAlpha\?/);
  assert.equal(api({ ats: 'workday', workday_host: 'jobs', board: 'acme/wd5/External_Careers' }),
    'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External_Careers/jobs');
  assert.equal(api({ ats: 'workday', workday_host: 'site', board: 'acme/wd1/AcmeCareers' }),
    'https://wd1.myworkdaysite.com/wday/cxs/acme/AcmeCareers/jobs');
});

test('subdomain vendors lowercase the board; Ashby keeps its case', () => {
  for (const ats of ['recruitee', 'breezy', 'bamboohr', 'pinpoint']) {
    assert.equal(new URL(buildBoardUrl({ ats, board: 'AcmeCo' })).hostname.split('.')[0], 'acmeco', ats);
  }
  assert.equal(buildBoardUrl({ ats: 'ashby', board: 'DeepL' }), 'https://jobs.ashbyhq.com/DeepL');
});

test('anything that does not fit returns null, never a guessed URL', () => {
  const bad = [
    {},
    { ats: 'dayforce', board: 'acme' },
    { ats: 'constructor', board: 'acme' },
    { ats: 'toString', board: 'acme' },
    { ats: 'greenhouse', board: 'acme' },                       // region missing
    { ats: 'greenhouse', region: 'ap', board: 'acme' },
    { ats: 'greenhouse', region: 'constructor', board: 'acme' },
    { ats: 'ashby', region: 'us', board: 'acme' },              // region on a non-regional ATS
    { ats: 'lever', region: 'us', board: 'acme', workday_host: 'jobs' },
    { ats: 'lever', region: 'us', board: 'acme/other' },        // outside SLUG_RE
    { ats: 'lever', region: 'us', board: '' },
    { ats: 'lever', region: 'us', board: 42 },
    { ats: 'workday', board: 'acme/wd5/External' },             // host form missing
    { ats: 'workday', workday_host: 'cxs', board: 'acme/wd5/External' },
    { ats: 'workday', workday_host: 'jobs', board: 'acme/wd5' },
    { ats: 'workday', workday_host: 'jobs', board: 'acme/w5/External' },
    { ats: 'workday', workday_host: 'jobs', board: 'acme/wd5/External/x' },
    { ats: 'workday', workday_host: 'jobs', region: 'us', board: 'acme/wd5/External' },
  ];
  for (const row of bad) assert.equal(buildBoardUrl(row), null, JSON.stringify(row));
});

test('discover-ats.mjs re-exports the same builder and slug guard', () => {
  assert.equal(discoverBuildBoardUrl, buildBoardUrl);
  assert.equal(discoverSlugRe, SLUG_RE);
});

test('discovery probes exactly the URL the registry would store, for every slug vendor', () => {
  const { candidates } = buildCandidateUrls({ name: 'Acme', slug: 'acme' });
  const atsOf = (vendor) => (vendor === 'gh' ? 'greenhouse' : vendor);
  assert.deepEqual(candidates.map((c) => atsOf(c.vendor)).sort(), Object.keys(BOARD_URL_BUILDERS).sort());
  for (const c of candidates) {
    const ats = atsOf(c.vendor);
    const region = Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, ats) ? 'us' : undefined;
    assert.equal(c.careers_url, buildBoardUrl({ ats, region, board: 'acme' }), ats);
  }
  const [wd] = buildWorkdayCandidates({ tenant: 'acme', instance: 'wd5', site: 'External' });
  assert.equal(wd.careers_url, buildBoardUrl({ ats: 'workday', workday_host: 'jobs', board: 'acme/wd5/External' }));
});
