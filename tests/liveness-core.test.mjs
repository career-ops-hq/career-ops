// tests/liveness-core.test.mjs — classifyLiveness must treat the "filled"
// phrasing SPA ATSs inject (Phenom, e.g. careers.icf.com) as expired.
//
// Regression for the false-active reported on careers.icf.com: Phenom-hosted
// career pages return HTTP 200 with a generic "Apply" control in the shell,
// while the true status — "the job you are trying to apply for has been
// filled" — is rendered into the main content. The old HARD_EXPIRED pattern
// was /position has been filled/, which does not match that phrasing, so the
// generic apply control won and the posting was classified active. The
// generalized pattern requires any job noun within 60 chars of "has been
// filled" and rejects "filled out" (a candidate completing a form).
import { pass, fail } from './helpers.mjs';
import { classifyLiveness } from '../liveness-core.mjs';

console.log('\nliveness-core — "filled" reqs (incl. Phenom/ICF phrasing) classify as expired');

const expired = (bodyText, applyControls = ['Apply']) =>
  classifyLiveness({ status: 200, finalUrl: 'https://careers.example.com/job/123', bodyText, applyControls }).result;

// The reported bug: Phenom/ICF phrasing, HTTP 200, with a generic Apply control.
expired('We’re sorry… the job you are trying to apply for has been filled. Apply')
  === 'expired'
  ? pass('Phenom/ICF "the job ... has been filled" -> expired (was: active)')
  : fail('Phenom/ICF "the job ... has been filled" NOT classified expired');

// Regression: the original phrasing still classifies as expired.
expired('This position has been filled. Apply') === 'expired'
  ? pass('"position has been filled" still -> expired')
  : fail('"position has been filled" regressed');

// Regression: a genuinely active posting is NOT swept up by the new pattern.
classifyLiveness({
  status: 200,
  finalUrl: 'https://boards.greenhouse.io/acme/jobs/123',
  bodyText: 'Senior Program Manager. You will own the enterprise AI roadmap and lead delivery across teams. Apply now.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with an apply control stays active')
  : fail('new pattern over-triggered on an active posting');

// False-positive guard: "has been filled out" (a form) must NOT read as expired.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'Once the job application form has been filled out, submit it below. Apply',
  applyControls: ['Apply'],
}).result !== 'expired'
  ? pass('"job application form has been filled out" is NOT expired (form, not req)')
  : fail('false positive: "filled out" (a form) read as an expired req');

// False-positive guard (no "out"): "application form has been filled" must NOT
// read as expired — "job" satisfies the noun but the thing filled is the form,
// not the req. Reading a live posting as expired is the worse error.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'Please confirm the job application form has been filled and accurate before submitting. Apply',
  applyControls: ['Apply'],
}).result !== 'expired'
  ? pass('"job application form has been filled" (no "out") is NOT expired')
  : fail('false positive: "application form has been filled" read as an expired req');

console.log('\nliveness-core — transient 5xx must not classify as expired');

// Regression: a 502 with a typical short gateway body used to fall through to
// the insufficient-content heuristic and read as expired, which dedup-blocks
// the posting from every future scan. Any 5xx is transient, never "gone".
for (const status of [500, 502, 504]) {
  const verdict = classifyLiveness({
    status,
    requestedUrl: 'https://careers.example.com/job/123',
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${status} Bad Gateway\nnginx`,
    applyControls: [],
  });
  verdict.result === 'uncertain' && verdict.code === 'server_error'
    ? pass(`HTTP ${status} -> uncertain/server_error (was: expired via insufficient_content)`)
    : fail(`HTTP ${status} classified ${verdict.result}/${verdict.code}, expected uncertain/server_error`);
}

// 503 keeps its more specific access-blocked classification: the 5xx guard
// sits below it, so both halves of the verdict must hold, not just the code.
const blocked = classifyLiveness({ status: 503, finalUrl: 'https://careers.example.com/job/123', bodyText: 'checking your browser', applyControls: [] });
blocked.result === 'uncertain' && blocked.code === 'access_blocked'
  ? pass('HTTP 503 still classifies as uncertain/access_blocked, not server_error')
  : fail(`HTTP 503 classified ${blocked.result}/${blocked.code}, expected uncertain/access_blocked`);

// 429 is throttling, never evidence the posting is gone. Its body is a short
// "Too Many Requests" — under MIN_CONTENT_CHARS — so before the guard covered it
// the verdict fell through to insufficient_content and read as `expired`, which
// scan-history records as skipped_expired and every later scan dedup-skips.
const throttled = classifyLiveness({
  status: 429,
  requestedUrl: 'https://boards.greenhouse.io/acme/jobs/1234567',
  finalUrl: 'https://boards.greenhouse.io/acme/jobs/1234567',
  bodyText: 'Too Many Requests. Please retry after some time.',
  applyControls: [],
});
throttled.result === 'uncertain' && throttled.code === 'access_blocked'
  ? pass('HTTP 429 classifies as uncertain/access_blocked, not expired')
  : fail(`HTTP 429 classified ${throttled.result}/${throttled.code}, expected uncertain/access_blocked`);

// A real 404/410 is still authoritative expiry — both statuses, both halves.
for (const status of [404, 410]) {
  const gone = classifyLiveness({
    status,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: 'Not found',
    applyControls: [],
  });
  gone.result === 'expired' && gone.code === 'http_gone'
    ? pass(`HTTP ${status} still -> expired/http_gone`)
    : fail(`HTTP ${status} classified ${gone.result}/${gone.code}, expected expired/http_gone`);
}

console.log('\nliveness-core — Chinese application controls classify active postings');

const chineseApply = classifyLiveness({
  status: 200,
  requestedUrl: 'https://careers.example.com/job/1234567',
  finalUrl: 'https://careers.example.com/job/1234567',
  bodyText: '岗位职责：负责模型研发、系统优化和跨团队协作。'.repeat(20),
  applyControls: ['申请职位'],
});
chineseApply.result === 'active' && chineseApply.code === 'apply_control_visible'
  ? pass('“申请职位” marks an otherwise valid Chinese posting active')
  : fail(`“申请职位” classified ${chineseApply.result}/${chineseApply.code}, expected active/apply_control_visible`);

const chineseSubmit = classifyLiveness({
  status: 200,
  requestedUrl: 'https://careers.example.com/job/7657115156241418501',
  finalUrl: 'https://careers.example.com/job/7657115156241418501',
  bodyText: '职位描述：负责安全系统、检测算法和工程平台建设。'.repeat(20),
  applyControls: ['投递'],
});
chineseSubmit.result === 'active' && chineseSubmit.code === 'apply_control_visible'
  ? pass('exact “投递” button marks a Feishu posting active')
  : fail(`exact “投递” button classified ${chineseSubmit.result}/${chineseSubmit.code}, expected active/apply_control_visible`);

console.log('\nliveness-core — Dutch apply controls, and the VDAB banner that outranks them');

// VDAB labels Apply "Solliciteer nu"; Recruitee career sites in Dutch label it
// "Solliciteren". Without a Dutch label, every live posting on those pages
// read no_apply_control and scan --verify dropped it for good (#4832).
const dutchBody = 'Functieomschrijving\nJe komt terecht in een afwisselende functie waarbij je zowel operationeel als projectmatig aan de slag gaat.\n'.repeat(4);
for (const label of ['Solliciteer nu', 'Solliciteren']) {
  const dutchApply = classifyLiveness({
    status: 200,
    requestedUrl: 'https://www.vdab.be/vindeenjob/vacatures/74748133',
    finalUrl: 'https://www.vdab.be/vindeenjob/vacatures/74748133',
    bodyText: dutchBody,
    applyControls: ['Bewaar', label],
  });
  dutchApply.result === 'active' && dutchApply.code === 'apply_control_visible'
    ? pass(`"${label}" marks a Dutch posting active`)
    : fail(`"${label}" classified ${dutchApply.result}/${dutchApply.code}, expected active/apply_control_visible`);
}

// The pattern reads the verb. The noun, "sollicitatie", turns up in contact
// addresses, which are links but not Apply controls.
const dutchContact = classifyLiveness({
  status: 200,
  requestedUrl: 'https://werkenbij.example.nl/o/projectleider',
  finalUrl: 'https://werkenbij.example.nl/o/projectleider',
  bodyText: dutchBody,
  applyControls: ['Deel vacature', 'sollicitatie@example.nl'],
});
dutchContact.result === 'uncertain' && dutchContact.code === 'no_apply_control'
  ? pass('a "sollicitatie@" contact address is not an Apply control')
  : fail(`a "sollicitatie@" address alone classified ${dutchContact.result}/${dutchContact.code}, expected uncertain/no_apply_control`);

// A closed VDAB vacancy keeps its whole page, "Solliciteer nu" included, and
// says it is closed only in this banner. The banner is a hard pattern, read
// before the apply control, so the button cannot make the vacancy active.
const closedVdab = classifyLiveness({
  status: 200,
  requestedUrl: 'https://www.vdab.be/vindeenjob/vacatures/72975331',
  finalUrl: 'https://www.vdab.be/vindeenjob/vacatures/72975331',
  bodyText: `Terug naar Vind een job\nInfo\nDeze vacature is niet meer gepubliceerd\nVerkoper tuincentrum\nSolliciteer nu\nBewaar\n${dutchBody}`,
  applyControls: ['Terug naar Vind een job', 'Solliciteer nu', 'Bewaar'],
});
closedVdab.result === 'expired' && closedVdab.code === 'expired_body'
  ? pass('VDAB "Deze vacature is niet meer gepubliceerd" -> expired, despite its "Solliciteer nu"')
  : fail(`closed VDAB vacancy classified ${closedVdab.result}/${closedVdab.code}, expected expired/expired_body`);

console.log('\nliveness-core — Polish closure banners (pracuj.pl) beat the "Aplikuj" control');

// pracuj.pl keeps an archived offer's full page, "Aplikuj" button included,
// and marks it closed only in a banner. Before these patterns the visible
// apply control won and every archived offer read as active.
const pracujUrl = 'https://www.pracuj.pl/praca/dyrektor-operacyjny-warszawa,oferta,1004567890';
const polishBody = 'Twój zakres obowiązków\nZarządzanie operacjami w regionie, odpowiedzialność za budżet i zespół.\n'.repeat(4);
const pracuj = (banner) => classifyLiveness({
  status: 200,
  requestedUrl: pracujUrl,
  finalUrl: pracujUrl,
  bodyText: `${banner}Dyrektor operacyjny\nWarszawa\n${polishBody}`,
  applyControls: ['Aplikuj'],
});
for (const banner of [
  'Ogłoszenie wygasło',
  'OGLOSZENIE WYGASLO',
  'Pracodawca zakończył zbieranie zgłoszeń na tę ofertę',
  'Oferta jest nieaktualna',
  'Oferta archiwalna',
  'Kandydaci nie są już akceptowani',
]) {
  const r = pracuj(`${banner}\n`);
  r.result === 'expired' && r.code === 'expired_body'
    ? pass(`pracuj.pl "${banner}" -> expired, despite its "Aplikuj"`)
    : fail(`pracuj.pl "${banner}" classified ${r.result}/${r.code}, expected expired/expired_body`);
}

// The same page without a banner is a live offer and must stay active.
const livePracuj = pracuj('');
livePracuj.result === 'active'
  ? pass('pracuj.pl offer without a closure banner stays active')
  : fail(`live pracuj.pl offer classified ${livePracuj.result}/${livePracuj.code}, expected active`);

console.log('\nliveness-core — the getManfred Apply control, and the date a closed posting shows');

// getManfred labels Apply "¡Apúntame!" ("sign me up"); the walk reads the
// control as "¡APÚNTAME! ¡Apúntame!". With no pattern for it, a live posting
// read no_apply_control and scan --verify dropped it (#4832).
const manfredUrl = 'https://www.getmanfred.com/ofertas-empleo/8510/renta-4-lead-oracle-backend-developer-oct26';
const manfredBody = '¿Qué harás?\nDiseñarás y mantendrás los servicios backend de la plataforma de inversión.\n'.repeat(4);
const manfredApply = classifyLiveness({
  status: 200,
  requestedUrl: manfredUrl,
  finalUrl: manfredUrl,
  bodyText: manfredBody,
  applyControls: ['¿Puedo aplicar si vivo fuera de España?', 'COMPARTIR Compartir', '¡APÚNTAME! ¡Apúntame!'],
});
manfredApply.result === 'active' && manfredApply.code === 'apply_control_visible'
  ? pass('"¡Apúntame!" marks a getManfred posting active')
  : fail(`"¡Apúntame!" classified ${manfredApply.result}/${manfredApply.code}, expected active/apply_control_visible`);

// Most getManfred postings, closed ones too, have an FAQ button such as
// "¿Puedo aplicar si vivo fuera de España?". The pattern reads "apúntame", not
// the verb "aplicar", so that button alone is not an Apply control.
const manfredFaq = classifyLiveness({
  status: 200,
  requestedUrl: manfredUrl,
  finalUrl: manfredUrl,
  bodyText: manfredBody,
  applyControls: ['¿Puedo aplicar si vivo fuera de España?', 'OTRAS OFERTAS Otras ofertas'],
});
manfredFaq.result === 'uncertain' && manfredFaq.code === 'no_apply_control'
  ? pass('the "¿Puedo aplicar...?" FAQ button is not an Apply control')
  : fail(`the FAQ button alone classified ${manfredFaq.result}/${manfredFaq.code}, expected uncertain/no_apply_control`);

// A closed getManfred posting stays up without its Apply button, and says
// above the title when it closed. It read no_apply_control, so check-liveness
// reported it uncertain instead of expired.
const closedManfredUrl = 'https://www.getmanfred.com/ofertas-empleo/2649/cabify-principal-software-engineer-oct23';
const closedManfred = classifyLiveness({
  status: 200,
  requestedUrl: closedManfredUrl,
  finalUrl: closedManfredUrl,
  bodyText: `Oferta cerrada el 26/12/2023\nPrincipal Software Engineer\n${manfredBody}Oferta cerrada\nEsta oferta ya está cerrada, ¡pero tenemos muchas más!\nVER OTRAS OFERTAS`,
  applyControls: ['¿Puedo aplicar si vivo fuera de España?', 'OTRAS OFERTAS Otras ofertas'],
});
closedManfred.result === 'expired' && closedManfred.code === 'expired_body'
  ? pass('getManfred "Oferta cerrada el 26/12/2023" -> expired')
  : fail(`closed getManfred posting classified ${closedManfred.result}/${closedManfred.code}, expected expired/expired_body`);

// A posting written in English has its FAQ in English, and "Can I apply
// regardless of where I live?" reads as an Apply control. Closed postings like
// this one read active on the first poll, before the "Esta oferta ya está
// cerrada" box near the end of the page had rendered. The date above the title
// was already there, and a hard pattern is read before the Apply control.
const closedEnglishUrl = 'https://www.getmanfred.com/ofertas-empleo/1922/grayhair-software-senior-java-developer-jun23';
const closedEnglish = classifyLiveness({
  status: 200,
  requestedUrl: closedEnglishUrl,
  finalUrl: closedEnglishUrl,
  bodyText: `Oferta sólo disponible en Inglés\nOferta cerrada el 27/07/2023\nSenior Java Developer\n${'What will you do?\nYou will build and run the Java services behind the platform.\n'.repeat(4)}Can I apply regardless of where I live?\nOferta cerrada`,
  applyControls: ['Can I apply regardless of where I live?', 'COMPARTIR Compartir'],
});
closedEnglish.result === 'expired' && closedEnglish.code === 'expired_body'
  ? pass('a closed getManfred posting in English -> expired, despite its "Can I apply...?" FAQ button')
  : fail(`closed getManfred posting in English classified ${closedEnglish.result}/${closedEnglish.code}, expected expired/expired_body`);

console.log('\nliveness-core — the HiringRoom Apply control');

// HiringRoom labels Apply "Postularse", and the walk reads it twice: the button
// under the title and the one after the description. With no pattern for it, a
// live posting read no_apply_control and scan --verify dropped it (#4832). The
// controls below are what the walk returns on a live posting.
const hiringRoomUrl = 'https://growuphr.hiringroom.com/jobs/get_vacancy/6a2314c34cf88a4172be80c2';
const hiringRoomBody = 'Descripción del puesto\nNos encontramos en la búsqueda de un Service Desk Manager para liderar una operación global de soporte.\n'.repeat(4);
const hiringRoomChrome = ['Portal de empleos', 'Compartir', '¿Cómo me postulo?', 'Actualizá tu perfil', 'Contacto con soporte', 'Cancelar', 'Enviar'];
const hiringRoomApply = classifyLiveness({
  status: 200,
  requestedUrl: hiringRoomUrl,
  finalUrl: hiringRoomUrl,
  bodyText: hiringRoomBody,
  applyControls: ['Postularse', 'Postularse', ...hiringRoomChrome],
});
hiringRoomApply.result === 'active' && hiringRoomApply.code === 'apply_control_visible'
  ? pass('"Postularse" marks a HiringRoom posting active')
  : fail(`"Postularse" classified ${hiringRoomApply.result}/${hiringRoomApply.code}, expected active/apply_control_visible`);

// Every HiringRoom posting also links the help article "¿Cómo me postulo?"
// ("how do I apply?"). The pattern reads the label, not the verb, so the help
// link alone is not an Apply control.
const hiringRoomHelp = classifyLiveness({
  status: 200,
  requestedUrl: hiringRoomUrl,
  finalUrl: hiringRoomUrl,
  bodyText: hiringRoomBody,
  applyControls: hiringRoomChrome,
});
hiringRoomHelp.result === 'uncertain' && hiringRoomHelp.code === 'no_apply_control'
  ? pass('the "¿Cómo me postulo?" help link is not an Apply control')
  : fail(`the help link alone classified ${hiringRoomHelp.result}/${hiringRoomHelp.code}, expected uncertain/no_apply_control`);

console.log('\nliveness-core — Bulgarian apply controls');

// dev.bg and zaplata.bg label Apply "Кандидатствай", wherewework.bg
// "Кандидатствайте" / "Външно кандидатстване", jobtiger.bg "Кандидатстване".
// Without them every live posting on those boards read no_apply_control and
// scan --verify dropped it for good, as in #4832.
const bulgarianBody = 'Описание на позицията\nТърсим опитен PHP разработчик, който да се присъедини към екипа ни и да работи по уеб приложения.\n'.repeat(4);
for (const label of ['Кандидатствай', 'Кандидатствайте сега', 'КАНДИДАТСТВАЙ', 'Кандидатстване', 'Външно кандидатстване']) {
  const bulgarianApply = classifyLiveness({
    status: 200,
    requestedUrl: 'https://www.wherewework.bg/bg/obiavi/backend-developer-php/115000',
    finalUrl: 'https://www.wherewework.bg/bg/obiavi/backend-developer-php/115000',
    bodyText: bulgarianBody,
    applyControls: ['Запазете', label],
  });
  bulgarianApply.result === 'active' && bulgarianApply.code === 'apply_control_visible'
    ? pass(`"${label}" marks a Bulgarian posting active`)
    : fail(`"${label}" classified ${bulgarianApply.result}/${bulgarianApply.code}, expected active/apply_control_visible`);
}

// The noun counts only when it opens the label. jobtiger.bg's advice links end
// with it, and "кандидати" (candidates) and "кандидатствахте" (you applied)
// share the stem.
for (const label of ['Мотивационното писмо Как да напишем добро писмо за кандидатстване', 'F.A.Q. Кандидати', 'Вече кандидатствахте']) {
  const bulgarianNotApply = classifyLiveness({
    status: 200,
    requestedUrl: 'https://www.jobtiger.bg/obiavi-za-rabota/back-end-developer-330211-2',
    finalUrl: 'https://www.jobtiger.bg/obiavi-za-rabota/back-end-developer-330211-2',
    bodyText: bulgarianBody,
    applyControls: [label],
  });
  bulgarianNotApply.result === 'uncertain' && bulgarianNotApply.code === 'no_apply_control'
    ? pass(`"${label}" is not an Apply control`)
    : fail(`"${label}" classified ${bulgarianNotApply.result}/${bulgarianNotApply.code}, expected uncertain/no_apply_control`);
}

console.log('\nliveness-core — role/position "is closed" and bare "Job Expired" banners classify as expired');

// Reported on agentic-engineering-jobs.com (111 of 111 uncertain postings
// contain this exact phrase). Old pattern was /this job (listing )?is closed/i,
// which hardcoded the noun "job"; "role" fell through to no_apply_control ->
// uncertain, and uncertain postings never filter out of future scans, so a
// dead board stayed live in scan-history forever.
expired('We are sorry, this role is closed. Please check our other openings.') === 'expired'
  ? pass('"This role is closed" -> expired (was: uncertain/no_apply_control)')
  : fail('"This role is closed" NOT classified expired');

// Same widening covers "position", per the reporter's suggested regex.
expired('We are sorry, this position is closed. Please check our other openings.') === 'expired'
  ? pass('"This position is closed" -> expired')
  : fail('"This position is closed" NOT classified expired');

// Regression: the original phrasings must keep matching after widening the noun.
expired('This job is closed to new applicants.') === 'expired'
  ? pass('"This job is closed" still -> expired (regression)')
  : fail('"This job is closed" regressed');

expired('This job listing is closed as of today.') === 'expired'
  ? pass('"This job listing is closed" still -> expired (regression)')
  : fail('"This job listing is closed" regressed');

// The reported failure mode is a page with a body but NO apply control (see
// the "× 3" rows in the issue). Verify the fix also holds in that scenario:
// body over MIN_CONTENT_CHARS, applyControls: [], the closure banner alone
// must decide expired -- not fall through to insufficient_content or
// no_apply_control.
//
// The two banners carry DIFFERENT codes on purpose: "This role is closed"
// is a hard-expired signal (strong enough to override an apply control),
// so it fires from HARD_EXPIRED_PATTERNS with code expired_body. Bare
// "JOB EXPIRED" is a weak signal (a "Similar jobs" carousel entry on a
// LIVE page carries the same string), so it fires from SOFT_EXPIRED_PATTERNS
// after the apply-control branch and carries code expired_body_soft. The
// distinction is measured here, not just in the tier assertion below,
// because a future refactor that put both banners back in one tier would
// keep the surface result === 'expired' green while breaking the whole
// invariant santifer's #4194 review is about.
const padding = 'Job description follows. '.repeat(20);
for (const { text, expectedCode, label } of [
  {
    text: `This role is closed. ${padding}`,
    expectedCode: 'expired_body',
    label: '"This role is closed" (no apply control, padded body)',
  },
  {
    text: `JOB EXPIRED. ${padding}`,
    expectedCode: 'expired_body_soft',
    label: 'bare "JOB EXPIRED" (no apply control, padded body)',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: [],
  });
  verdict.result === 'expired' && verdict.code === expectedCode
    ? pass(`${label} -> expired/${expectedCode}`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected expired/${expectedCode}`);
}

// False-positive guard: real JD copy mentions "role" and "position"
// constantly. The pattern anchors on "this ... is closed", so descriptive
// use in an active posting must stay active.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'This role is a hands-on senior IC position on the platform team, based in Toronto. You will own reliability for the inference stack. Apply now.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with "role"/"position" in descriptive prose stays active')
  : fail('false positive: descriptive "role"/"position" prose read as expired');

// False-positive guard for the "job expired" pattern: \b boundaries mean it
// only matches those two words adjacent. Split across a sentence, an active
// posting must stay active. Belt-and-suspenders against the SOFT tier —
// even before the tier move, adjacency alone should keep this active.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'This job is open to remote candidates. Applications from candidates whose visas have expired will still be considered.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with non-adjacent "job" / "expired" stays active')
  : fail('false positive: non-adjacent "job" / "expired" read as expired');

console.log('\nliveness-core — SOFT_EXPIRED_PATTERNS tier: weak signals must lose to a visible apply control (#4194)');

// santifer's #4194 review fixtures. Each is a body a live posting can
// legitimately carry (carousel item, filter chip, footer FAQ), and each
// has a working apply control. Before the tier move, the bare "\bjob
// expired\b" pattern lived in HARD_EXPIRED and fired here BEFORE the
// apply-control branch, returning expired -- filtering a live posting
// out of scans permanently (see the 5xx-guard comment in liveness-core
// for the underlying dedup mechanism).
//
// The tests below fail on 117aea0 (the first PR commit) and pass on the
// follow-up. Verified in the docker container before pushing.
const softApplyPresent = 'Job description follows. '.repeat(20);
for (const { text, label } of [
  {
    text: `Senior AI Engineer\n${softApplyPresent}\nSimilar jobs: Software Engineer at Contoso — Job Expired`,
    label: '"Similar jobs" carousel entry reading "Job Expired" (live posting)',
  },
  {
    text: `Filters: Hide job expired · Remote only · Posted this week\n${softApplyPresent}`,
    label: '"Hide job expired" filter chip on a live posting',
  },
  {
    text: `${softApplyPresent}\nFAQ: What happens when a job expired? See our archive policy.`,
    label: 'footer FAQ mentioning "when a job expired?" on a live posting',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: ['Apply now'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible (SOFT_EXPIRED loses to Apply)`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}

// Closed-loop / closed-form compound guard on the closed pattern. Real
// engineering JDs commonly say "closed-loop control" or "closed-form
// solution"; the earlier /this (?:job|role|position)(?: listing)? is
// closed/i (no trailing boundary) matched the "is closed" fragment from
// "is closed-loop" and returned expired. \b(?!-) closes it.
for (const { text, label } of [
  {
    text: 'This role is closed-loop control of the platform, integrating sensor feedback with actuation. Apply now.',
    label: '"This role is closed-loop control..." (control-systems JD)',
  },
  {
    text: 'This position is closed-form solvable, unlike the general case that requires numerical methods.',
    label: '"This position is closed-form solvable..." (ML/math JD)',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: ['Apply now'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}

console.log('\nliveness-core — a posting that says how it will close is still open');

// Each of these is a LIVE posting naming the condition or date it will close
// on. Hard patterns are checked before the apply control, so each used to read
// as expired, and scan --verify recorded the posting as skipped_expired.
const jdBody = 'You will support faculty research and build data pipelines across the institute. '.repeat(4);
for (const { text, label } of [
  {
    // University of Wisconsin System posting, LinkedIn 2023.
    text: 'Screening will begin immediately and be ongoing through December 22, 2023. However, applications may be accepted until the position has been filled.',
    label: '"applications may be accepted until the position has been filled"',
  },
  {
    // The job-noun window starts at "role", so the clause has to be read back
    // from the end of the match, not from its start.
    text: 'This role is open until the position has been filled.',
    label: '"This role is open until the position has been filled"',
  },
  {
    text: 'We will contact shortlisted candidates once applications have closed.',
    label: '"once applications have closed"',
  },
  {
    text: 'The advert will be removed once we are no longer accepting applications.',
    label: '"once we are no longer accepting applications"',
  },
  {
    text: 'This posting will be closed on December 15, 2026.',
    label: '"will be closed on December 15"',
  },
  {
    text: 'The advert is to be closed on 15 December 2026.',
    label: '"is to be closed on 15 December"',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${jdBody}${text}`,
    applyControls: ['Apply'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}

// The banners themselves still close the posting.
for (const { text, label } of [
  {
    // Every occurrence is checked, not just the first.
    text: 'Applications will be accepted until the position has been filled. This position has been filled.',
    label: 'a filled banner on a page whose copy also says "until ... has been filled"',
  },
  {
    // normalizeForMatch() joins this line onto the banner under it. The "if"
    // is 16 words back, outside the clause.
    text: 'Sign in if you already have a profile The job you are trying to apply for has been filled.',
    label: 'a filled banner right after a sign-in line containing "if"',
  },
  {
    // The comma ends the opening phrase before the banner's own clause.
    text: 'After careful consideration, the position has been filled.',
    label: '"After careful consideration, the position has been filled"',
  },
  {
    text: 'This posting has been closed on 15 September 2026.',
    label: '"has been closed on 15 September" (a past date)',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${jdBody}${text}`,
    applyControls: ['Apply'],
  });
  verdict.result === 'expired' && verdict.code === 'expired_body'
    ? pass(`${label} -> expired/expired_body`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected expired/expired_body`);
}

console.log('\nliveness-core — a banner on its own line is not read as part of the line above');

// Page chrome above a banner often ends in a clause of its own, with no
// punctuation, and its "if", "when" or "before" is within ten words of the
// banner's end. With the lines joined, that word opened the banner's clause
// and a closed posting with an Apply control on the page read as active.
for (const { text, label } of [
  {
    text: 'Sign in if you have an account\nThis job has been filled.',
    label: 'a filled banner under "Sign in if you have an account"',
  },
  {
    text: 'Get notified when new jobs are posted\nNo longer accepting applications',
    label: '"No longer accepting applications" under "Get notified when new jobs are posted"',
  },
  {
    text: 'Please read the full posting before you apply\nThis position is no longer available.',
    label: '"This position is no longer available" under a line ending "before you apply"',
  },
  {
    // A line break inside the banner does not stop the pattern: patterns
    // still match on the joined text.
    text: 'We are no longer accepting\napplications for this role.',
    label: 'a banner broken over two lines',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${jdBody}\n${text}`,
    applyControls: ['Apply'],
  });
  verdict.result === 'expired' && verdict.code === 'expired_body'
    ? pass(`${label} -> expired/expired_body`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected expired/expired_body`);
}

// A closing line on a line of its own is still one clause.
for (const { text, label } of [
  {
    text: 'Salary: $80,000\nApplications will be accepted until the position has been filled.\nBenefits',
    label: '"accepted until the position has been filled" between two other lines',
  },
  {
    text: 'How to apply\nYou will receive final notification via email when this vacancy has been filled.',
    label: '"when this vacancy has been filled" under a heading',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${jdBody}\n${text}`,
    applyControls: ['Apply'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}

// ---------------------------------------------------------------------------
// #5000 defect 3: a closure page whose whole content is one sentence.
// ---------------------------------------------------------------------------
console.log('\nliveness-core — the "can\'t view this job" closure sentence classifies as expired');

const closureVerdict = (bodyText, applyControls = []) =>
  classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText,
    applyControls,
  });

// The reported page: HTTP 200, the sentence is the only content, no apply control.
closureVerdict("You can't view this job because it's not available at this time.").result === 'expired'
  ? pass('the closure sentence -> expired')
  : fail('the closure sentence was not classified expired');

// The same sentence with typographic apostrophes (U+2019) must match too;
// normalizeForMatch is what makes that true.
closureVerdict('You can’t view this job because it’s not available at this time.').result === 'expired'
  ? pass('the closure sentence with U+2019 apostrophes -> expired')
  : fail('the closure sentence with U+2019 apostrophes was not classified expired');

// Hard tier: the sentence is a statement about THIS posting, so it wins over a
// stray generic apply control.
closureVerdict("You can't view this job because it's not available at this time.", ['Apply']).result === 'expired'
  ? pass('the closure sentence wins over a generic apply control')
  : fail('the closure sentence did not win over a generic apply control');

// Negative control: a live posting that merely mentions availability stays active.
closureVerdict('Salary data is not available at this time. Apply now.', ['Apply now']).result === 'active'
  ? pass('an availability mention on a live posting stays active')
  : fail('the new pattern over-triggered on a live posting');

console.log('\nliveness-core — CareerViet: Vietnamese Apply label, and the deadline that closes a posting (#4832)');

// A CareerViet page as the browser reads it: the info block carries the
// deadline, and the Apply button is there whether or not the posting is open.
const careerviet = (deadline, applyControls = ['NỘP ĐƠN ỨNG TUYỂN'], finalUrl = 'https://careerviet.vn/vi/tim-viec-lam/brand-executive.35C50000.html') =>
  classifyLiveness({
    status: 200,
    requestedUrl: 'https://careerviet.vn/vi/tim-viec-lam/brand-executive.35C50000.html',
    finalUrl,
    bodyText: `Brand Executive\nCông ty ABC\nCấp bậc\nNhân viên\nHết hạn nộp\n${deadline}\nPhúc lợi\nLaptop\n${'Mô tả công việc. '.repeat(30)}`,
    applyControls,
    now: new Date('2026-10-17T05:00:00Z'),
  });

careerviet('30/11/2026').result === 'active'
  ? pass('open CareerViet posting with NỘP ĐƠN ỨNG TUYỂN -> active (was: uncertain/no_apply_control)')
  : fail(`open CareerViet posting not active: ${JSON.stringify(careerviet('30/11/2026'))}`);

{
  const v = careerviet('29/09/2025');
  v.result === 'expired' && v.code === 'deadline_passed'
    ? pass('past deadline wins over the intact Apply button -> expired')
    : fail(`past deadline not expired: ${JSON.stringify(v)}`);
}

careerviet('17/10/2026').result === 'active'
  ? pass('the deadline day itself is still open')
  : fail('the deadline day was read as closed');

careerviet('16/10/2026').result === 'expired'
  ? pass('the day after the deadline is closed')
  : fail('the day after the deadline was read as open');

// Vietnam is UTC+7: 18:00 UTC on 17/10 is already 18/10 there.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careerviet.vn/vi/tim-viec-lam/x.35C50000.html',
  bodyText: `Hết hạn nộp 17/10/2026 ${'Mô tả công việc. '.repeat(30)}`,
  applyControls: ['NỘP ĐƠN ỨNG TUYỂN'],
  now: new Date('2026-10-17T18:00:00Z'),
}).result === 'expired'
  ? pass('the deadline is judged in Vietnam time (UTC+7)')
  : fail('the deadline was judged in UTC');

// Today's date must not depend on how a locale orders a formatted date: with
// format() rendering MM/DD/YYYY, both sides of the deadline still read right.
{
  const format = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format');
  Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get: () => () => '10/17/2026' });
  let past, ahead;
  try {
    past = careerviet('16/10/2026').result;
    ahead = careerviet('30/03/2027').result;
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', format);
  }
  past === 'expired' && ahead === 'active'
    ? pass('the deadline comparison does not depend on the locale date format')
    : fail(`with an MM/DD/YYYY format: past=${past}, ahead=${ahead}`);
}

careerviet('31/02/2026').result === 'active'
  ? pass('an impossible date is not read as a closure')
  : fail('an impossible date closed the posting');

// Only the first deadline counts: a related-jobs card must not close the posting.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careerviet.vn/vi/tim-viec-lam/x.35C89ABA.html',
  bodyText: `Hết hạn nộp\n30/11/2026\n${'Mô tả công việc. '.repeat(30)}\nViệc làm tương tự\nHết hạn nộp 01/01/2024`,
  applyControls: ['NỘP ĐƠN ỨNG TUYỂN'],
  now: new Date('2026-10-17T05:00:00Z'),
}).result === 'active'
  ? pass('a later deadline in a related-jobs card does not close the posting')
  : fail('a related-jobs deadline closed the posting');

// A dead permalink that redirects to a listing page must not be closed by
// another job's deadline on that page (review of #5367).
{
  const v = careerviet('29/09/2025', ['NỘP ĐƠN ỨNG TUYỂN'], 'https://careerviet.vn/vi/tim-viec-lam/ket-qua');
  v.result === 'uncertain' && v.code === 'redirected_off_posting'
    ? pass('redirect off the posting + past deadline -> uncertain, not expired')
    : fail(`redirected listing read as ${JSON.stringify(v)}`);
}

// A missing CareerViet id lands on the all-jobs page, and 35C89ABA (the usual
// id shape, with no five digits in a row) is not one the redirect guard
// recognises. The page's cards print "Hạn nộp: dd-mm-yyyy", not the posting's
// "Hết hạn nộp dd/mm/yyyy", and its "ỨNG TUYỂN NGAY" is not the posting's
// button, so the page cannot close the posting or keep it alive, even with a
// card dated in the past first (the real page had none on 2026-10-18).
{
  const v = classifyLiveness({
    status: 200,
    requestedUrl: 'https://careerviet.vn/vi/tim-viec-lam/brand-executive.35C89ABA.html',
    finalUrl: 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html',
    bodyText: `Việc làm\nKế toán tổng hợp\nCạnh tranh Hà Nội Hạn nộp: 01-10-2025 Cập nhật: 18-10-2026\nNhân Viên Kinh Doanh B2B\nHạn nộp: 31-10-2026\n${'Mô tả công việc. '.repeat(30)}`,
    applyControls: ['ỨNG TUYỂN NGAY', 'Lưu việc làm'],
    now: new Date('2026-10-17T05:00:00Z'),
  });
  v.result === 'uncertain'
    ? pass('the all-jobs page a missing CareerViet id lands on stays uncertain')
    : fail(`the all-jobs landing page read as ${JSON.stringify(v)}`);
}

// Without a deadline the Apply label alone still reads active, and the label
// is not a loose match: "đơn" prose elsewhere does not count.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careerviet.vn/vi/tim-viec-lam/x.35C89ABA.html',
  bodyText: 'Mô tả công việc. '.repeat(30),
  applyControls: ['Nộp đơn ứng tuyển'],
}).result === 'active'
  ? pass('the label reads as an Apply control in mixed case too')
  : fail('mixed-case label not recognised');

classifyLiveness({
  status: 200,
  finalUrl: 'https://careerviet.vn/vi/tim-viec-lam/x.35C89ABA.html',
  bodyText: 'Mô tả công việc. '.repeat(30),
  applyControls: ['Xem đơn hàng'],
}).result === 'uncertain'
  ? pass('an unrelated "đơn" control is not an Apply control')
  : fail('an unrelated control read as Apply');

// ── isUnreadableVerdict: "body could not be read" is not "closed" (#5408) ────
import { isUnreadableVerdict } from '../liveness-core.mjs';

const unreadableProbe = classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'Home Careers Contact',
  applyControls: [],
});
isUnreadableVerdict(unreadableProbe)
  ? pass('a nav/footer-only page (insufficient_content) is an unreadable verdict')
  : fail('a nav/footer-only page was not flagged unreadable');

isUnreadableVerdict({ result: 'expired', code: 'hard_expired' }) === false
  && isUnreadableVerdict({ result: 'active' }) === false
  && isUnreadableVerdict({ result: 'uncertain', code: 'bot_challenge' }) === false
  && isUnreadableVerdict(null) === false
  && isUnreadableVerdict(undefined) === false
  ? pass('closed, active, other uncertain and missing verdicts are not unreadable')
  : fail('isUnreadableVerdict over-matched a non-insufficient_content verdict');

// ── isClosureEvidence: only closure EVIDENCE closes a tracker row ────────────
//
// check-liveness.mjs --discard-expired used to take every `expired` verdict and
// write Discarded to the tracker. An unreadable page is `expired` too, so an
// Evaluated row whose posting was merely slow to render was closed out with the
// note "posting closed". The two other callers already excluded it by copying
// the rule; the destructive one never did. One predicate now serves all three.
import { isClosureEvidence, discardableExpiredUrls } from '../liveness-core.mjs';
import { readFileSync as readLivenessSource } from 'node:fs';
import { fileURLToPath as toLivenessPath } from 'node:url';

// The premise, asserted rather than assumed: a REAL unreadable verdict from the
// classifier is `uncertain`. An older or hand-built verdict can still carry the
// same code as `expired`, which is why `expired` alone cannot gate a write.
unreadableProbe.result === 'uncertain'
  ? pass('premise: classifyLiveness() reports an unreadable page as uncertain')
  : fail(`premise failed: an unreadable page classified as ${unreadableProbe.result}, not uncertain`);
const legacyUnreadable = { result: 'expired', code: 'insufficient_content' };

isClosureEvidence({ result: 'expired', code: 'hard_expired' }) === true
  && isClosureEvidence(unreadableProbe) === false
  && isClosureEvidence(legacyUnreadable) === false
  && isClosureEvidence({ result: 'uncertain', code: 'bot_challenge' }) === false
  && isClosureEvidence({ result: 'active' }) === false
  && isClosureEvidence(null) === false
  ? pass('closure evidence is a real expired verdict, never an unreadable, uncertain or missing one')
  : fail('isClosureEvidence accepted something that does not prove the posting closed');

{
  const { closed, unreadable } = discardableExpiredUrls([
    { url: 'https://jobs.example.com/closed', result: 'expired', code: 'hard_expired' },
    { ...unreadableProbe, url: 'https://jobs.example.com/still-loading' },
    { ...legacyUnreadable, url: 'https://jobs.example.com/old-verdict' },
    { url: 'https://jobs.example.com/live', result: 'active' },
    { url: 'https://jobs.example.com/wall', result: 'uncertain', code: 'bot_challenge' },
    { result: 'expired', code: 'hard_expired' },          // no url: nothing to discard
  ]);
  JSON.stringify(closed) === JSON.stringify(['https://jobs.example.com/closed'])
    ? pass('--discard-expired closes only the posting with closure evidence')
    : fail(`--discard-expired would close ${JSON.stringify(closed)} — an unreadable page must not be among them`);
  JSON.stringify(unreadable) === JSON.stringify(['https://jobs.example.com/still-loading', 'https://jobs.example.com/old-verdict'])
    ? pass('unreadable pages are reported, uncertain or expired, not silently dropped')
    : fail(`unreadable pages not reported correctly: ${JSON.stringify(unreadable)}`);
}

{
  // A guard on the CLI itself. Testing the helper proves nothing if
  // check-liveness.mjs stops calling it, which is the shape this bug took.
  const cliPath = toLivenessPath(new URL('../check-liveness.mjs', import.meta.url));
  const cli = readLivenessSource(cliPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  cli.includes('discardableExpiredUrls(')
    && !/verdicts\.filter\(\s*\(?\s*v\s*\)?\s*=>\s*v\.result\s*===\s*'expired'\s*\)/.test(cli)
    ? pass('check-liveness.mjs --discard-expired selects URLs through the shared predicate')
    : fail('check-liveness.mjs builds its discard list without discardableExpiredUrls() — an unreadable page would be closed');
}
