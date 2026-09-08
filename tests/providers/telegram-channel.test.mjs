// tests/providers/telegram-channel.test.mjs — provider-contract tests.
// The t.me/s/<channel> preview is server-rendered HTML: one post per block,
// keyed by permalink; pages back with ?before=<id>; stops at the configured
// window; fails CLOSED on a channel without a public preview and on markup
// that no longer parses — silence there would read as an empty board.
//
// The policy half (Source Indexing Policy, rules 1-2): a post is a Job only
// when it names an employer AND links to a vacancy. `url` is that link, the
// permalink is a `Source:` line in the description. Everything the policy
// cannot attribute is dropped, and the fixtures below are the shapes the
// live channels actually write (measured 2026-09-03).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — telegram-channel');

const post = (id, date, textHtml, extraClass = '') => `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message text_not_supported_wrap ${extraClass} js-widget_message" data-post="devjobs/${id}" data-view="x">
    <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/devjobs"><span dir="auto">Game Development Jobs</span></a></div>
    ${textHtml === null ? '<a class="tgme_widget_message_photo_wrap" href="https://t.me/devjobs/' + id + '"></a>' : `<div class="tgme_widget_message_text js-message_text" dir="auto">${textHtml}</div>`}
    <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/devjobs/${id}">${date ? `<time datetime="${date}" class="time">16:01</time>` : ''}</a></span>
  </div>
</div>`;

const page = (...posts) => `<html><head><meta property="og:title" content="Game Development Jobs"></head><body>${posts.join('')}</body></html>`;
const NO_PREVIEW = '<html><head><meta property="og:title" content="Telegram: Contact @gophersjob"></head><body><div class="tgme_page_description">You can contact @gophersjob right away.</div></body></html>';
const quiet = { sleep: async () => {} };
const A = (href, text = href) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const FOOTER = `<br/>Подписаться: ${A('https://vk.com/job_for_programmers', 'VK')} · ${A('https://max.ru/job_for_programmers', 'MAX')} · <a href="https://t.me/s/devjobs?q=%23senior">#senior</a>`;

// The shapes a policy-passing post takes. Each carries an employer and a link.
// t.me serves query ampersands double-encoded (`&amp;amp;`), exactly as below.
const P_LABEL = post(12509, '2026-09-01T17:25:26+00:00', `MLOps-инженер в инфраструктуру Центра ИИ, senior<br/>#удаленка #senior<br/>🏢 Компания: Контур<br/>Стек: Python, Kubernetes &amp; Helm<br/>Откликнуться: ${A('https://kontur.ru/career/vacancy/12345?utm_source=tg&amp;amp;utm_medium=post')}${FOOTER}`);
const P_AT = post(12508, '2026-08-30T11:06:18+00:00', `Data Engineer (в DS-команду) [Remote] @ Островок<br/>от 250 000 ₽<br/>${A('https://getmatch.ru/vacancies/33927-data-engineer?s=bot', 'Подробнее')} · ${A('https://getmatch.ru/companies/PLln3LRJ-ostrovok', 'О компании')}`);
const P_PIPE = post(12507, '2026-08-29T10:00:00+00:00', `Game Designer (Playable Ads) | Nexters<br/>Nexters - международная игровая компания.<br/>Откликнуться: ${A('https://www.nexters.com/careers/game-designer-playable-ads')}`);
const P_LINE2 = post(12506, '2026-08-28T10:00:00+00:00', `Junior Android Developer<br/>в Kaspi — крупнейшая fintech-экосистема в Казахстане.<br/>${A('https://geekjob.ru/vacancy/6a8ef08600f8ea276e0b90af', 'Описание вакансии на GeekJob.ru')}`);
// The employer's own page beats the board mirror of the same vacancy, wherever it sits in the post.
const P_PREFER = post(12505, '2026-08-27T10:00:00+00:00', `Senior Python Developer @ Ozon<br/>${A('https://getmatch.ru/vacancies/35075-senior-python')}<br/>Или напрямую: ${A('https://ozon.tech/vacancies/senior-python-7788')}`);
const P_LINKEDIN_JOB = post(12504, '2026-08-26T10:00:00+00:00', `Junior QA Engineer<br/>в Playrix — игровая компания.<br/>${A('https://www.linkedin.com/jobs/view/4123456789/', 'LinkedIn')}`);
// The template two HR-curated channels switched to on 2026-08-17: a
// hashtag-only first line (never a title), the bare employer alone on the
// next, the real title only on the third.
const P_HASHTAG = post(12480, '2026-09-04T10:00:00+00:00', `#middle #удаленка<br/>Т1<br/>Data Science (LLM/NLP) Engineer<br/>${A('https://career.t1.ru/vacancies/vacancy-detail?id=136067001')}`);
// Same template, but the employer name is itself the apply link (no third
// line at all) — the shape must be dropped, not emit the hashtag line as title.
const P_HASHTAG_NO_TITLE = post(12479, '2026-09-04T09:00:00+00:00', `#middle #удаленка<br/>${A('https://career.t1.ru/vacancies/vacancy-detail?id=136067001', 'Т1')}`);
// Same template, but the third line is a bare pasted link — t.me autolinks a
// raw URL with the URL itself as the anchor's visible text — not a title.
const P_HASHTAG_BARE_LINK = post(12478, '2026-09-04T08:00:00+00:00', `#middle #удаленка<br/>Т1<br/>${A('https://career.t1.ru/vacancies/vacancy-detail?id=136067001')}`);
// The shapes the policy drops.
const P_NO_NAME = post(12503, '2026-08-25T10:00:00+00:00', `Ищем UE5 разработчика (кооп / прототип выживача)<br/>О проекте: делаем прототип.<br/>Писать: @hr_handle · ${A('https://ll-games.com/en/jobs/ue5')}`);
const P_NO_LINK = post(12502, '2026-08-24T10:00:00+00:00', `🔵 Финансовый аналитик<br/>🏢 Компания: deeplay<br/>📍 Локация: Санкт-Петербург${FOOTER}`);
const P_HOMEPAGE = post(12501, '2026-08-23T10:00:00+00:00', `Project Manager | Last Level<br/>Студия Last Level ищет PM.<br/>${A('https://ll-games.com/')}`);
const P_FORM = post(12500, '2026-08-22T10:00:00+00:00', `Backend Developer | Acme Studio<br/>Анкета: ${A('https://forms.gle/xB6AMK2STtF6G9vG8')}`);
const P_SHORTENER = post(12499, '2026-08-21T10:00:00+00:00', `Senior Magento Developer. #Grana<br/>Company: Grana<br/>${A('https://goo.gl/E5F9Zx', 'Apply')}`);
const P_LINKEDIN_POST = post(12498, '2026-08-20T10:00:00+00:00', `Junior Android Developer<br/>в Kaspi — крупнейшая fintech-экосистема.<br/>Ищет Мария, ${A('https://www.linkedin.com/posts/example-user-000000000_activity-1', 'её пост на LinkedIn')}`);
const P_ANON = post(12497, '2026-08-19T10:00:00+00:00', `Senior AI/ML Engineer (LLM Agents) [Remote] @ Название скрыто<br/>${A('https://getmatch.ru/vacancies/35099-senior-ai-ml')}`);
const P_AGENCY = post(12496, '2026-08-18T10:00:00+00:00', `Senior CV Engineer / Team Lead<br/>Компания: Наш клиент<br/>Мы ищем специалиста в IT-компанию, которая занимается аналитикой.<br/>${A('https://spectral.tech/careers/cv-lead')}`);
const P_DIGEST = post(12495, '2026-08-17T10:00:00+00:00', `💼 Еженедельная подборка вакансий<br/>Компания: Geeklink<br/>${A('https://geeklink.io/job/artfrost-full-stack-game-developer')}<br/>${A('https://geeklink.io/job/hr-experts-senior-lead-backend')}<br/>${A('https://geeklink.io/job/kvando-senior-python')}`);
const P_DATE_TITLE = post(12494, '2026-08-16T10:00:00+00:00', `Full-Stack Product Engineer | September 02, 2026<br/>${A('https://weworkremotely.com/remote-jobs/wonderdog-full-stack-product-engineer')}`);
const P_LONG = post(12493, '2026-08-31T10:00:00+00:00', `${'word '.repeat(30).trim()}<br/>Компания: Long Corp<br/>${A('https://longcorp.example/jobs/1')}`);
const P_OLD = post(977, '2024-01-05T09:00:00+00:00', `Very old post<br/>Компания: Old Corp<br/>${A('https://oldcorp.example/jobs/1')}`);
const P_NO_TIME = post(12492, '', `Undated post<br/>Компания: Undated Corp<br/>${A('https://undated.example/jobs/1')}`);
const SERVICE = post(1, '2024-01-01T00:00:00+00:00', 'Channel created', 'service_message');
const MEDIA_ONLY = post(12491, '2026-08-31T09:00:00+00:00', null);

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/telegram-channel.mjs')).href);
  const tg = mod.default;
  const { parseChannelPage, employerName, classifyLink, applicationLink, postToJob } = mod;

  if (tg.id === 'telegram-channel') pass('telegram-channel.id is "telegram-channel"');
  else fail(`telegram-channel.id is ${JSON.stringify(tg.id)}`);

  if (typeof tg.detect !== 'function') pass('telegram-channel has no detect() — explicit provider: only, never auto-claimed from a careers_url');
  else fail('telegram-channel must not auto-detect');

  // --- parser ---------------------------------------------------------------
  const parsed = parseChannelPage(page(P_LABEL, P_AT), 'devjobs');
  if (parsed.posts.length === 2 && parsed.noPreview === false && parsed.textPosts === 2) pass('parseChannelPage() finds both posts on a preview page');
  else fail(`parseChannelPage() → ${parsed.posts.length} posts, noPreview=${parsed.noPreview}, textPosts=${parsed.textPosts}`);

  const first = parsed.posts[0];
  if (first?.id === 12509 && first.url === 'https://t.me/devjobs/12509') pass('a parsed post keys on its permalink https://t.me/<channel>/<id>');
  else fail(`first post = ${JSON.stringify(first)}`);
  if (first?.title === 'MLOps-инженер в инфраструктуру Центра ИИ, senior') pass('title is the first line of the post, markup stripped');
  else fail(`title = ${JSON.stringify(first?.title)}`);
  if (first?.description.includes('Kubernetes & Helm') && first.description.includes('Откликнуться') && !/<a\b/.test(first.description) && first.lines.length === 6) {
    pass('description is the post as decoded plain text, one line per <br>');
  } else {
    fail(`description = ${JSON.stringify(first?.description)} lines=${first?.lines?.length}`);
  }
  if (first?.hrefs.length === 4 && first.hrefs[0] === 'https://kontur.ru/career/vacancy/12345?utm_source=tg&utm_medium=post') pass('hrefs are read from the post markup before it is flattened, with t.me\'s double-encoded ampersands decoded');
  else fail(`hrefs = ${JSON.stringify(first?.hrefs)}`);
  if (first?.postedAt === Date.parse('2026-09-01T17:25:26+00:00')) pass('postedAt comes from <time datetime>');
  else fail(`postedAt = ${JSON.stringify(first?.postedAt)}`);

  const long = parseChannelPage(page(P_LONG), 'devjobs').posts[0];
  if (long && long.title.endsWith('word…') && long.title.length <= 121 && !long.title.includes(' …')) pass('a long first line is cut at a word boundary with an ellipsis');
  else fail(`long title = ${JSON.stringify(long?.title)}`);

  const undated = parseChannelPage(page(P_NO_TIME), 'devjobs').posts[0];
  if (undated && undated.postedAt === undefined) pass('a post without <time> parses with postedAt undefined');
  else fail(`undated post = ${JSON.stringify(undated)}`);

  // A post from another channel embedded in the page (forwards) is not ours.
  const foreign = parseChannelPage(page(P_LABEL.replace('data-post="devjobs/12509"', 'data-post="otherchan/5"')), 'devjobs');
  if (foreign.posts.length === 0) pass('posts attributed to another channel are ignored');
  else fail(`foreign post leaked: ${JSON.stringify(foreign.posts[0])}`);

  const service = parseChannelPage(page(SERVICE, P_LABEL), 'devjobs');
  if (service.posts.length === 1 && service.posts[0].id === 12509 && service.textPosts === 1) pass('service messages ("Channel created") are neither posts nor text posts');
  else fail(`service page → ${JSON.stringify({ n: service.posts.length, textPosts: service.textPosts })}`);

  const media = parseChannelPage(page(MEDIA_ONLY), 'devjobs');
  if (media.posts.length === 0 && media.textPosts === 0) pass('a media-only post (no text) is neither a posting nor a text post');
  else fail(`media-only page → ${JSON.stringify({ n: media.posts.length, textPosts: media.textPosts })}`);

  const stub = parseChannelPage(NO_PREVIEW, 'gophersjob');
  if (stub.posts.length === 0 && stub.noPreview === true && stub.textPosts === 0) pass('the "Contact @handle" stub is recognised as no-public-preview');
  else fail(`stub → ${JSON.stringify(stub)}`);

  // --- policy: employer -------------------------------------------------------
  const names = [
    [['MLOps-инженер', '#удаленка', '🏢 Компания: Контур', 'Стек'], 'Контур', 'a labelled "Компания:" line'],
    [['Data Engineer [Remote] @ Островок', 'от 250 000 ₽'], 'Островок', '"Title @ Employer"'],
    [['Game Designer | Nexters', 'text'], 'Nexters', '"Title | Employer"'],
    [['Junior Android Developer', 'в Kaspi — крупнейшая fintech-экосистема'], 'Kaspi', 'a second line "в Employer —"'],
    [['Junior QA', 'at Picnic — groceries'], 'Picnic', 'a second line "at Employer —"'],
    [['Python Developer', 'Company: X5 Tech', 'more'], 'X5 Tech', 'a labelled field may carry digits'],
    [['Engineering Manager @ Constructor‍.io'], 'Constructor.io', 'zero-width characters are stripped from the name'],
    [['#middle #удаленка', 'Т1', 'Data Science (LLM/NLP)'], 'Т1', 'a hashtag-only first line, bare employer alone on the next (measured live 2026-09-05)'],
    [['#senior #гибрид #москва', 'X5 Медиа', 'Ведущий backend-разработчик'], 'X5 Медиа', 'a hashtag-only first line, employer name carrying a digit'],
  ];
  for (const [lines, want, label] of names) {
    const got = employerName(lines);
    if (got === want) pass(`employerName() reads ${label}`);
    else fail(`employerName(${label}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  const noNames = [
    [['Ищем UE5 разработчика (кооп / прототип выживача)', 'О проекте: делаем прототип.'], 'free text with no employer marker'],
    [['Full-Stack Product Engineer | September 02, 2026'], 'a date after the pipe'],
    [['Senior Engineer | Cologne, Germany'], 'a location after the pipe'],
    [['Senior AI Engineer @ Название скрыто'], 'a hidden employer'],
    [['#senior #удаленка #москва', 'Компания: HFT-фонде.'], 'a label whose value is not a name (ends with a period)'],
    [['Роль', 'Компания: Наш клиент'], 'an agency\'s "our client"'],
    [['Backend Engineer | Remote'], 'a contract word after the pipe'],
    [['#senior #офис', 'Backend Developer Senior (Python / Scraping Product)'], 'a hashtag-only first line whose next line is a title, not an employer (too many words)'],
    [['#senior #удаленка', 'Senior Engineer'], 'a hashtag-only first line whose next line is a short role title, not an employer'],
    [['#middle #гибрид', 'Ведущий инженер'], 'a hashtag-only first line whose next line is a short Russian role title (JS \\b never matches around Cyrillic)'],
    [['#tag1 #tag2'], 'a hashtag-only first line with no second line at all'],
  ];
  for (const [lines, label] of noNames) {
    const got = employerName(lines);
    if (got === '') pass(`employerName() refuses ${label}`);
    else fail(`employerName(${label}) = ${JSON.stringify(got)}, want ''`);
  }

  // --- policy: link -----------------------------------------------------------
  const links = [
    ['https://kontur.ru/career/vacancy/12345?utm_source=tg', 'employer', 'an employer page'],
    ['https://ozon.tech/vacancies/senior-python-7788', 'employer', 'an employer ATS page'],
    ['https://neklo.peopleforce.io/careers/v/1234', 'employer', 'a tenant ATS host'],
    ['https://getmatch.ru/vacancies/33927-data-engineer?s=bot', 'board', 'a board\'s per-vacancy page'],
    ['https://www.linkedin.com/jobs/view/4123456789/', 'board', 'a LinkedIn job page'],
    ['https://getmatch.ru/companies/PLln3LRJ-ostrovok', null, 'a board\'s company page'],
    ['https://www.linkedin.com/posts/example-user-000000000_activity-1', null, 'a LinkedIn post'],
    ['https://acme.example/blog/2024/company-update', null, 'a dated blog post (a bare year segment is not a vacancy id)'],
    ['https://acme.example/news/2025', null, 'a year-only news archive'],
    ['https://acme.example/role-4554989/', 'employer', 'a numeric-id slug qualifies with no vacancy keyword in the path'],
    ['https://ll-games.com/', null, 'a homepage'],
    ['https://ll-games.com/?utm_source=telegram&utm_medium=post', null, 'a homepage with a tracking tail'],
    ['https://ll-games.com/jobs', null, 'a listing root with no vacancy'],
    ['https://ll-games.com/jobs/?utm_source=telegram&s=bot', null, 'a listing root with a tracking tail'],
    ['https://jobs.example.com/?gh_jid=123456', 'employer', 'a root whose query identifies the vacancy'],
    ['https://rabota.sber.ru/search/middle-senior-python-developer-4554989/', 'employer', 'an employer page whose slug ends in a vacancy id'],
    ['https://apply.workable.com/dmed/j/EDB9E5C27E/', 'employer', 'an ATS-shaped /j/<key> page'],
    ['https://www.nexters.com/en/about/alljobs/?vacancy=game-designer-1786734679', 'employer', 'a jobs page with a vacancy query'],
    ['https://ll-games.com/en/', null, 'a locale root (homepage in another language)'],
    ['https://cyberyozh.com/ru', null, 'a locale root without the slash'],
    ['https://education.tbank.ru/start/python/?utm_source=career_vacancies', null, 'an employer page with no vacancy evidence (a course, not a job)'],
    ['https://acme.example/blog/why-we-hire', null, 'an employer blog post'],
    ['https://forms.gle/xB6AMK2STtF6G9vG8', null, 'a Google form'],
    ['https://goo.gl/E5F9Zx', null, 'a shortener'],
    ['https://vk.com/job_for_programmers', null, 'a social footer'],
    ['https://t.me/s/devjobs?q=%23senior', null, 'a hashtag link'],
    ['https://telegra.ph/Vakansiya-09-01', null, 'a telegra.ph long read'],
    ['http://ozon.tech/vacancies/1', null, 'plain http'],
    ['not a url', null, 'garbage'],
  ];
  for (const [href, want, label] of links) {
    const got = classifyLink(href);
    if (got === want) pass(`classifyLink() reads ${label} as ${JSON.stringify(want)}`);
    else fail(`classifyLink(${label}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  const prefer = applicationLink(['https://vk.com/x', 'https://getmatch.ru/vacancies/35075-senior-python', 'https://ozon.tech/vacancies/senior-python-7788']);
  if (prefer?.url === 'https://ozon.tech/vacancies/senior-python-7788' && prefer.kind === 'employer') pass('applicationLink() prefers the employer\'s own page over the board mirror, wherever it sits');
  else fail(`applicationLink(prefer) = ${JSON.stringify(prefer)}`);
  const digest = applicationLink(['https://geeklink.io/job/a', 'https://geeklink.io/job/b', 'https://geeklink.io/job/c']);
  if (digest === null) pass('applicationLink() refuses a digest carrying several vacancies');
  else fail(`applicationLink(digest) = ${JSON.stringify(digest)}`);
  const sameTwice = applicationLink(['https://getmatch.ru/vacancies/33927-x?s=header', 'https://getmatch.ru/vacancies/33927-x?s=footer', 'https://getmatch.ru/companies/ostrovok']);
  if (sameTwice?.url === 'https://getmatch.ru/vacancies/33927-x?s=header') pass('the same vacancy linked twice with different tracking is one vacancy, and the company page does not count');
  else fail(`applicationLink(sameTwice) = ${JSON.stringify(sameTwice)}`);
  if (applicationLink(['https://vk.com/x', 'https://forms.gle/y']) === null && applicationLink([]) === null) pass('applicationLink() is null when nothing qualifies');
  else fail('applicationLink() accepted a non-qualifying set');
  const queryDigest = applicationLink(['https://jobs.example.com/?gh_jid=1', 'https://jobs.example.com/?gh_jid=2']);
  if (queryDigest === null) pass('two vacancies that differ only by an identifying query key are a digest, not one vacancy');
  else fail(`applicationLink(queryDigest) = ${JSON.stringify(queryDigest)}`);
  const sameByUtm = applicationLink(['https://jobs.example.com/?gh_jid=1&utm_source=a', 'https://www.jobs.example.com/?utm_source=b&gh_jid=1']);
  if (sameByUtm?.url === 'https://jobs.example.com/?gh_jid=1&utm_source=a') pass('the same vacancy with different tracking tails, key order and a www. prefix is one vacancy');
  else fail(`applicationLink(sameByUtm) = ${JSON.stringify(sameByUtm)}`);

  // --- policy: end to end through postToJob -----------------------------------
  const accepted = parseChannelPage(page(P_LABEL, P_AT, P_PIPE, P_LINE2, P_PREFER, P_LINKEDIN_JOB), 'devjobs').posts.map(postToJob);
  const acceptedRows = accepted.map((j) => j && [j.company, j.url]);
  const wantRows = [
    ['Контур', 'https://kontur.ru/career/vacancy/12345?utm_source=tg&utm_medium=post'],
    ['Островок', 'https://getmatch.ru/vacancies/33927-data-engineer?s=bot'],
    ['Nexters', 'https://www.nexters.com/careers/game-designer-playable-ads'],
    ['Kaspi', 'https://geekjob.ru/vacancy/6a8ef08600f8ea276e0b90af'],
    ['Ozon', 'https://ozon.tech/vacancies/senior-python-7788'],
    ['Playrix', 'https://www.linkedin.com/jobs/view/4123456789/'],
  ];
  if (JSON.stringify(acceptedRows) === JSON.stringify(wantRows)) pass('every attributable shape becomes a Job with company = the employer and url = the vacancy link');
  else fail(`accepted rows = ${JSON.stringify(acceptedRows)}`);
  if (accepted[0] && accepted[0].description.endsWith('\n\nSource: https://t.me/devjobs/12509') && accepted[0].description.includes('Компания: Контур') && accepted[0].location === '') {
    pass('the permalink travels as a "Source:" line at the end of the description (secondary attribution)');
  } else {
    fail(`description = ${JSON.stringify(accepted[0]?.description?.slice(-80))}`);
  }
  if (accepted.every((j) => j && typeof j.postedAt === 'number')) pass('postedAt is carried through on dated posts');
  else fail(`postedAt lost: ${JSON.stringify(accepted.map((j) => j?.postedAt))}`);

  const dropped = parseChannelPage(page(P_NO_NAME, P_NO_LINK, P_HOMEPAGE, P_FORM, P_SHORTENER, P_LINKEDIN_POST, P_ANON, P_AGENCY, P_DIGEST, P_DATE_TITLE), 'devjobs').posts.map((p) => [p.id, postToJob(p)]);
  const leaked = dropped.filter(([, j]) => j !== null);
  if (dropped.length === 10 && leaked.length === 0) pass('no employer, no link, homepage, form, shortener, LinkedIn post, hidden employer, agency, digest and date-title posts are all dropped');
  else fail(`leaked through the policy: ${JSON.stringify(leaked.map(([id, j]) => [id, j.company, j.url]))}`);

  // A hashtag-only first line must not become the title, even though
  // parseChannelPage() already set post.title = headline(lines) = lines[0]
  // before the policy ever runs.
  const hashtagJob = postToJob(parseChannelPage(page(P_HASHTAG), 'devjobs').posts[0]);
  if (hashtagJob && hashtagJob.company === 'Т1' && hashtagJob.title === 'Data Science (LLM/NLP) Engineer' && hashtagJob.url === 'https://career.t1.ru/vacancies/vacancy-detail?id=136067001') {
    pass('a hashtag-only first line is skipped for both the employer and the title; the title is the first substantive line after the employer');
  } else {
    fail(`hashtag-template job = ${JSON.stringify(hashtagJob)}`);
  }

  // A hashtag-first post with no title line at all (the employer name is
  // itself the apply link) must be dropped, not emit the hashtag line as
  // `title` — that would just be post.title, untouched by the shape's guard.
  const hashtagNoTitleJob = postToJob(parseChannelPage(page(P_HASHTAG_NO_TITLE), 'devjobs').posts[0]);
  if (hashtagNoTitleJob === null) pass('a hashtag-first post with no distinct title line is dropped rather than emitting the hashtag line as title');
  else fail(`hashtag post with no title line = ${JSON.stringify(hashtagNoTitleJob)}`);

  // A hashtag-first post whose only candidate line is a bare pasted link
  // (t.me autolinks a raw URL with the URL as its own visible text) must
  // also be dropped, not emit the vacancy URL itself as `title`.
  const hashtagBareLinkJob = postToJob(parseChannelPage(page(P_HASHTAG_BARE_LINK), 'devjobs').posts[0]);
  if (hashtagBareLinkJob === null) pass('a hashtag-first post whose only remaining line is the bare vacancy URL is dropped rather than emitting the URL as title');
  else fail(`hashtag post with bare-link-only line = ${JSON.stringify(hashtagBareLinkJob)}`);

  // --- fetch: redirect guard, mapping, paging ------------------------------
  const calls = [];
  const ctx = {
    ...quiet,
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      if (url === 'https://t.me/s/devjobs') return page(P_LABEL, P_NO_NAME, P_AT);
      if (url === 'https://t.me/s/devjobs?before=12503') return page(P_OLD);
      return page();
    },
  };
  const jobs = await tg.fetch({ name: 'TG devjobs', channel: 'devjobs', max_pages: 3, since_days: 36500 }, ctx);
  // 'manual' (never followed, but the 3xx is visible), not 'follow': a hostile
  // handle must not be able to walk the request off t.me, and a private
  // channel's 302 must be reportable rather than a bare "fetch failed".
  if (calls.every((c) => c.opts?.redirect === 'manual')) pass('fetch() never follows redirects (redirect:"manual" on every page)');
  else fail(`redirect opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
  if (calls.length === 3 && calls[1].url === 'https://t.me/s/devjobs?before=12503' && calls[2].url === 'https://t.me/s/devjobs?before=977') {
    pass('fetch() pages back with ?before=<oldest id> (dropped posts still move the cursor) and stops on an empty page');
  } else {
    fail(`page urls = ${JSON.stringify(calls.map((c) => c.url))}`);
  }
  if (jobs.length === 3 && jobs[0].company === 'Контур' && jobs[1].company === 'Островок' && jobs[2].company === 'Old Corp' && jobs[2].url === 'https://oldcorp.example/jobs/1') {
    pass('fetch() maps attributable posts across pages to jobs; entry.name is never the company');
  } else {
    fail(`jobs = ${JSON.stringify(jobs.map((j) => [j.url, j.company]))}`);
  }

  const dated = await tg.fetch({ channel: 'devjobs' }, { ...quiet, fetchText: async () => page(P_NO_TIME) });
  if (dated.length === 1 && !('postedAt' in dated[0])) pass('an undated post is kept (no since_days cutoff applies) and carries no postedAt key');
  else fail(`undated job = ${JSON.stringify(dated)}`);

  // ctx.maxPages (verify-portals passes 1) wins over the entry's max_pages, silently.
  const capped = [];
  const errs = [];
  const origError = console.error;
  console.error = (...a) => { errs.push(a.join(' ')); };
  try {
    await tg.fetch({ channel: 'devjobs', max_pages: 3, since_days: 36500 }, { ...quiet, maxPages: 1, fetchText: async (url) => { capped.push(url); return url.includes('before') ? page(P_OLD) : page(P_LABEL, P_AT); } });
  } finally { console.error = origError; }
  if (capped.length === 1 && errs.length === 0) pass('ctx.maxPages caps paging below the entry\'s max_pages without a truncation warning');
  else fail(`ctx.maxPages=1 made ${capped.length} requests, warnings=${JSON.stringify(errs)}`);

  // Rule 3: the entry's own cap reached before the window is a loud prefix.
  const warned = [];
  console.error = (...a) => { warned.push(a.join(' ')); };
  let truncated;
  try {
    truncated = await tg.fetch({ name: 'TG devjobs', channel: 'devjobs', max_pages: 2, since_days: 36500 }, { ...quiet, fetchText: async (url) => (url.includes('before=12508') ? page(P_PIPE, P_LINE2) : url.includes('before') ? page(P_OLD) : page(P_LABEL, P_AT)) });
  } finally { console.error = origError; }
  if (truncated.length === 4 && warned.length === 1 && /truncated at max_pages=2/.test(warned[0]) && /TG devjobs/.test(warned[0]) && /raise max_pages/.test(warned[0])) {
    pass('reaching the entry\'s max_pages before since_days warns that the inventory is a prefix (rule 3), naming the fix');
  } else {
    fail(`truncation: jobs=${truncated?.length} warnings=${JSON.stringify(warned)}`);
  }

  // Default paging walks to the window, not one page.
  const walked = [];
  const deep = await tg.fetch({ name: 'TG', channel: 'devjobs', since_days: 36500 }, { ...quiet, fetchText: async (url) => { walked.push(url); return url.includes('before=12508') ? page(P_OLD) : url.includes('before') ? page() : page(P_LABEL, P_AT); } });
  if (walked.length === 3 && deep.length === 3) pass('without max_pages the provider keeps paging until the window or an empty page (cap 10)');
  else fail(`default paging: requests=${walked.length} jobs=${deep.length}`);

  // since_days: an old post is dropped and paging stops there; a leading @ is tolerated.
  const ctx2 = { ...quiet, fetchText: async (url) => (url.includes('before') ? page(P_OLD) : page(P_LABEL, P_AT)) };
  const recent = await tg.fetch({ name: 'TG', channel: '@devjobs', max_pages: 5, since_days: 36500 }, ctx2);
  const cut = await tg.fetch({ name: 'TG', channel: 'devjobs', max_pages: 5 }, { ...quiet, fetchText: async () => page(P_OLD) });
  if (recent.length === 3 && cut.length === 0) pass('since_days drops posts older than the window (default 30 days) and a leading @ is tolerated');
  else fail(`recent=${recent.length} cut=${cut.length}`);

  // ctx.sinceMs (the scanner's max_posting_age_days early stop) narrows the window.
  const narrowed = await tg.fetch({ name: 'TG', channel: 'devjobs', since_days: 36500 }, { ...quiet, sinceMs: Date.parse('2026-08-31T00:00:00Z'), fetchText: async (url) => (url.includes('before') ? page(P_OLD) : page(P_LABEL, P_AT)) });
  if (narrowed.length === 1 && narrowed[0].company === 'Контур') pass('ctx.sinceMs narrows the window below since_days and stops paging');
  else fail(`sinceMs: ${JSON.stringify(narrowed.map((j) => j.company))}`);

  // --- fail closed ------------------------------------------------------------
  // Live (2026-09-02): a private channel, one with the preview switched off,
  // and a nonexistent handle all answer 302 → https://t.me/<handle>. Under
  // redirect:'manual' _http.mjs throws with status + location; the provider
  // must turn that into a named failure, not an empty board.
  let threw = null;
  try {
    await tg.fetch({ name: 'TG', channel: 'gophersjob' }, {
      ...quiet,
      fetchText: async () => { const e = new Error('HTTP 302 Found'); e.status = 302; e.location = 'https://t.me/gophersjob'; throw e; },
    });
  } catch (e) { threw = e.message; }
  if (threw && /no public preview/.test(threw) && /302/.test(threw)) pass('a 302 on the first page throws "no public preview" naming the status (fails closed)');
  else fail(`302 channel did not throw as expected: ${JSON.stringify(threw)}`);

  // A network fault is not a "no preview" verdict — it must propagate as-is.
  let netErr = null;
  try { await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => { throw new Error('fetch failed'); } }); }
  catch (e) { netErr = e.message; }
  if (netErr === 'fetch failed') pass('a network error propagates unchanged (not mislabelled as no-preview)');
  else fail(`network error became: ${JSON.stringify(netErr)}`);

  let stubThrew = null;
  try { await tg.fetch({ name: 'TG', channel: 'gophersjob' }, { ...quiet, fetchText: async () => NO_PREVIEW }); }
  catch (e) { stubThrew = e.message; }
  if (stubThrew && /no public preview/.test(stubThrew)) pass('the "Contact @handle" stub served with 200 also throws (fails closed)');
  else fail(`stub page did not throw: ${JSON.stringify(stubThrew)}`);

  // Markup drift: the page still carries posts (data-post markers) but the
  // parser reads none — must be a loud failure, not an empty board.
  let drift = null;
  try { await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page(P_LABEL, P_AT).replaceAll('tgme_widget_message_wrap', 'tgme_post_wrap_v2') }); }
  catch (e) { drift = e.message; }
  if (drift && /markup changed/.test(drift) && /2 text posts/.test(drift)) pass('a page with post markup that no longer parses throws "markup changed" (fails closed)');
  else fail(`drifted page did not throw as expected: ${JSON.stringify(drift)}`);

  const serviceOnly = await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page(SERVICE) });
  if (Array.isArray(serviceOnly) && serviceOnly.length === 0) pass('a channel whose only message is "Channel created" is an empty board, not a drift error');
  else fail(`service-only page → ${JSON.stringify(serviceOnly)}`);

  // A renamed data-post attribute is the other drift mode: the wrappers are
  // still there, the parser just cannot key them.
  let drift2 = null;
  try { await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page(P_LABEL, P_AT).replaceAll('data-post=', 'data-msg=') }); }
  catch (e) { drift2 = e.message; }
  if (drift2 && /markup changed/.test(drift2)) pass('a page whose data-post attribute was renamed also throws "markup changed"');
  else fail(`data-post drift did not throw: ${JSON.stringify(drift2)}`);

  const mediaOnly = await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page(MEDIA_ONLY, MEDIA_ONLY.replace('12491', '12490')) });
  if (Array.isArray(mediaOnly) && mediaOnly.length === 0) pass('a media-only channel is an empty board, not a drift error');
  else fail(`media-only page → ${JSON.stringify(mediaOnly)}`);

  // A page of posts the policy drops is an empty board, not a drift error.
  const allDropped = await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page(P_NO_NAME, P_NO_LINK) });
  if (Array.isArray(allDropped) && allDropped.length === 0) pass('a page whose posts all fail the policy is an empty board (they parsed; the policy dropped them)');
  else fail(`all-dropped page → ${JSON.stringify(allDropped)}`);

  // A page that does not move back must not append the same posts twice.
  const stalled = await tg.fetch({ name: 'TG', channel: 'devjobs', max_pages: 4, since_days: 36500 }, { ...quiet, fetchText: async () => page(P_LABEL, P_AT) });
  if (stalled.length === 2) pass('a stalled page (same posts again) stops paging instead of duplicating posts');
  else fail(`stalled paging produced ${stalled.length} jobs, expected 2`);

  let fetched = false;
  let bad = null;
  try { await tg.fetch({ name: 'TG', channel: 'evil.example/x?y' }, { ...quiet, fetchText: async () => { fetched = true; return ''; } }); }
  catch (e) { bad = e.message; }
  if (bad && !fetched) pass('an invalid channel handle is rejected before any request is made');
  else fail(`invalid handle: threw=${JSON.stringify(bad)} fetched=${fetched}`);

  const empty = await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, fetchText: async () => page() });
  if (Array.isArray(empty) && empty.length === 0) pass('a preview page with no posts is an empty board, not an error');
  else fail(`empty page → ${JSON.stringify(empty)}`);

  // A page-2 failure that retry cannot clear fails loud (no silent partial
  // board), and the "raise max_pages" warning stays quiet: that message means
  // the cap truncated a healthy board, not that the board broke.
  {
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    let thrown = null;
    let calls = 0;
    try {
      await tg.fetch({ name: 'TG', channel: 'devjobs', max_pages: 3, since_days: 36500 }, { ...quiet, fetchText: async (url) => { calls++; if (url.includes('before')) { const e = new Error('503'); e.status = 503; throw e; } return page(P_LABEL, P_AT); } });
    } catch (e) { thrown = e; } finally { console.error = origErr; }
    if (thrown && thrown.status === 503 && calls > 2 && errs.length === 0) pass('a 5xx on page 2 that retry cannot clear fails loud, and the "raise max_pages" warning does not fire');
    else fail(`page-2 5xx: thrown=${thrown && thrown.message} calls=${calls} warnings=${JSON.stringify(errs)}`);
  }

  // Probe cooperation: a ctx.fetchText rejection while ctx.maxPages is set
  // reaches verify-portals as the same object (ProbePageBudgetReached is
  // recognised by identity), neither swallowed to [] nor rewrapped.
  {
    class BudgetReached extends Error {}
    const budget = new BudgetReached('probe budget');
    let got = null;
    try { await tg.fetch({ name: 'TG', channel: 'devjobs' }, { ...quiet, maxPages: 1, fetchText: async () => { throw budget; } }); }
    catch (e) { got = e; }
    if (got === budget) pass('a ctx.fetchText rejection under ctx.maxPages propagates unwrapped (the probe error keeps its identity)');
    else fail(`probe rejection came back as ${got && got.constructor.name}: ${got && got.message}`);
  }
} catch (e) {
  fail(`telegram-channel provider tests crashed: ${e.message}\n${e.stack}`);
}
