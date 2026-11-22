// tests/providers/workday-identity.test.mjs — a Workday posting's listingIdentity:
// the site it was read from, and its id within that site, `<token>:<place>`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workday listingIdentity');

const { parseWorkdayResponse, workdayPostingId } = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
const page = (...paths) => ({ total: paths.length, jobPostings: paths.map((externalPath, i) => ({ title: `Role ${i}`, externalPath })) });
const SITE = 'https://acme.wd1.myworkdayjobs.com/ext';
const idOf = (careers_url, externalPath) => parseWorkdayResponse(page(externalPath), { name: 'X', careers_url })[0]?.listingIdentity;
const check = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: ${JSON.stringify(got)}`));

// The id: the token with its suffix, ":", and the place segment as the path writes it.
const adobe = parseWorkdayResponse(page('/job/San-Francisco/Sr-Associate--Corporate-Strategy_R167982-1'), { name: 'X', careers_url: 'https://adobe.wd5.myworkdayjobs.com/external_experienced' })[0];
check('token, suffix and place', adobe.listingIdentity, { ats_provider: 'workday', board_slug: 'adobe/wd5/external_experienced', posting_id: 'R167982-1:San-Francisco' });
check('requisitionId still strips the suffix and has no place', adobe.requisitionId, 'R167982');

// The two counterexamples of the review: one token on two paths of one site.
check('one token, two places: two ids', [idOf(SITE, '/job/A/Role_R100')?.posting_id, idOf(SITE, '/job/B/Other_R100')?.posting_id], ['R100:A', 'R100:B']);
// Same token, same place, two titles: the same id; the collector quarantines it (it does not pick one).
const twin = parseWorkdayResponse(page('/job/A/Role_R100', '/job/A/Other_R100'), { name: 'X', careers_url: SITE });
check('one token, one place, two titles: one id twice', twin.map((j) => j.listingIdentity.posting_id), ['R100:A', 'R100:A']);

// The title slug moves, the id does not.
check('title drift keeps the id', idOf(SITE, '/job/SF/Associate--Strategy_R1')?.posting_id, idOf(SITE, '/job/SF/Sr-Associate--Strategy_R1')?.posting_id);
// Known limits, written down: an underscore entering the title, case, a new suffix, a new place.
check('limit: an underscore in the title changes the token (first underscore, as requisitionId)', workdayPostingId('/job/X/Role_Name_R100'), 'Name_R100:X');
check('limit: case is kept', workdayPostingId('/job/X/Role_r100'), 'r100:X');
check('limit: a new suffix is a new posting', [workdayPostingId('/job/X/A_R10'), workdayPostingId('/job/X/A_R10-1')], ['R10:X', 'R10-1:X']);
check('limit: a new place is a new posting', [workdayPostingId('/job/X/A_R10'), workdayPostingId('/job/Y/A_R10')], ['R10:X', 'R10:Y']);

// Sites, hosts and URL forms.
check('two sites of one tenant: two boards', [idOf('https://acme.wd5.myworkdayjobs.com/careers', '/job/B/A_R90')?.board_slug, idOf('https://acme.wd5.myworkdayjobs.com/careers_intl', '/job/B/A_R90')?.board_slug], ['acme/wd5/careers', 'acme/wd5/careers_intl']);
check('myworkdaysite: tenant/wdN/site', idOf('https://wd3.myworkdaysite.com/recruiting/acme/careers', '/job/Remote-Poland/Test-Lead_ATCI-456'), { ats_provider: 'workday', board_slug: 'acme/wd3/careers', posting_id: 'ATCI-456:Remote-Poland' });
check('a locale prefix in the careers URL keeps board and id', idOf('https://acme.wd1.myworkdayjobs.com/en-US/ext', '/job/X/Role_R100'), { ats_provider: 'workday', board_slug: 'acme/wd1/ext', posting_id: 'R100:X' });
check('a trailing slash keeps the id', workdayPostingId('/job/X/Role_R100/'), 'R100:X');
check('the place as the path writes it, percent-encoding kept', workdayPostingId('/job/S%C3%A3o-Paulo/A_R50'), 'R50:S%C3%A3o-Paulo');
check('R-2593225-1 stays whole', workdayPostingId('/job/Bentonville/Associate_R-2593225-1'), 'R-2593225-1:Bentonville');

// No place segment or no valid token: no identity.
for (const path of ['/job/Remote/Data_Scientist', '/job/board/real-job', '/job/X/a_b', 'not a path', '/job/Role_R100', '/jobs/X/Role_R100', '/job/X/Y/Role_R100', '/job//Role_R100']) {
  check(`no identity for ${path}`, workdayPostingId(path), undefined);
}
