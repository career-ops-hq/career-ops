// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
//
// Telegram channel provider — public channels through the t.me/s/<channel>
// web preview: a plain HTTPS page, 20 posts per page, newest first, paged back
// with `?before=<post id>`. No API key, no login.
//
// Configured under `job_boards:` (see templates/portals.example.yml).
//
// A channel is not a board: a board guarantees an employer and a canonical URL
// per listing by construction, a channel only by how each post is written.
// So the Source Indexing Policy (CONTRIBUTING.md, rules 1 and 2) is applied
// per post, fail-closed: a post becomes a Job only when it names an
// identifiable employer AND links to a vacancy the candidate can open —
// `company` is that employer, `url` is that link (the dedup key, checkable by
// liveness), and the t.me permalink travels in `description` as `Source:`.
// Posts that name no employer, link only to Telegram/social/footer hosts,
// hide the employer ("название скрыто", "our client"), or bundle several
// vacancies are not emitted. Measured 2026-09-03 over 809 posts from 17
// public channels, before hashtag-template support: 137 pass (25% of the
// RU/CIS corpus, none of the EN one, whose channels mirror boards career-ops
// already scans or link through
// shorteners); every rejection is a post the policy could not attribute, not
// a parser failure. Re-measured 2026-10-31 over 2,973 posts from 51 public
// RU/CIS channels, after the positional employer shapes and the Habr Career
// fix: 284 → 833 pass; of the 284 the earlier rules attributed, 283 come out
// identical and one wrong one ("Custom Software Development") is refused.
//
// A private channel, one with the preview switched off, or a page whose
// markup no longer parses is reported as an error — never as an empty board.

import { htmlToText, DESCRIPTION_CAP } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const CHANNEL_RE = /^[a-z0-9_]{5,32}$/i;
const MAX_PAGES_CAP = 10;
const DEFAULT_SINCE_DAYS = 30;
const TITLE_CAP = 120;
const PAGE_DELAY_MS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

// Hosts that never point at a vacancy: the channel itself, social profiles and
// the "follow us" footers RU job channels carry on every post (vk.com/max.ru),
// app stores, long-read hosts. A link here is not an application path.
const NON_APPLY_HOSTS = /(^|\.)(t\.me|telegram\.me|telegram\.org|telegra\.ph|telega\.in|vk\.com|vk\.cc|max\.ru|ok\.ru|facebook\.com|fb\.com|instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|threads\.net|store\.steampowered\.com|play\.google\.com|apps\.apple\.com|substack\.com|medium\.com|habr\.com|github\.com)$/i;
// Shorteners hide the destination; following them at scan time would be an
// extra request per post to an arbitrary host. Not verifiable, not emitted.
const SHORTENER_HOSTS = /(^|\.)(goo\.gl|bit\.ly|t\.co|cjl\.ist|clck\.ru|tglink\.io|tinyurl\.com|cutt\.ly|is\.gd|ow\.ly|rb\.gy|surl\.li)$/i;
// A form names no employer and cannot be checked for liveness.
const FORM_HOSTS = /(^|\.)(forms\.gle|docs\.google\.com|forms\.yandex\.ru|typeform\.com|tally\.so|airtable\.com|notion\.site|notion\.so)$/i;
// Multi-employer boards that channels mirror. A per-vacancy page there is the
// shortest path the post exposes and is accepted; the board's own company or
// category pages are not a listing. When the post also carries the
// employer's own link, that one wins.
// Checked before NON_APPLY_HOSTS: career.habr.com is a board, but it is also a
// subdomain of habr.com, which is a long-read host — tested the other way
// round, every Habr Career vacancy link (all the Proglib channels link there)
// was dropped as a blog link.
const BOARD_HOSTS = /(^|\.)(getmatch\.ru|finder\.work|geekjob\.ru|geeklink\.io|linkedin\.com|hh\.ru|career\.habr\.com|djinni\.co|indeed\.com|glassdoor\.com|weworkremotely\.com|remoteok\.com|arbeitnow\.com|cryptojobslist\.com|relocate\.me|lemon\.io|remocate\.app|offerclaw\.app|hellowehire\.com|ingamejob\.com|vseti\.app)$/i;
// What makes a link a vacancy page rather than "somewhere on the employer's
// site": a vacancy/job/career word in the path, a numeric id (`…-4554989/`,
// `/vacancy/6743104…`), an ATS-shaped key (`/j/EDB9E5C27E/`, a UUID), or an
// identifying query (`?vacancy=…`, `?gh_jid=…`). Measured on the 53 employer
// links a looser rule emitted: 48 carry one; the five that do not are two
// locale roots, an education programme and a homepage with a fragment, all
// rightly out.
const VACANCY_EVIDENCE_RE = /\/(vacanc|job|position|opening|career|apply|hiring)|[-_/](?!(?:19|20)\d{2}(?=[/?#]|$))\d{4,}(?=[/?#]|$)|\/j\/[A-Z0-9]{6,}(?=[/?#]|$)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Query keys that only track the click. Anything else may identify a vacancy.
const TRACKING_PARAM_RE = /^(utm_|ref$|referrer$|source$|src$|s$|from$|campaign$|fbclid$|gclid$|yclid$|mc_|_hs|igshid$|trk$)/i;
const LISTING_ROOT_RE = /^\/(jobs|vacancies|careers|career|vacancy|vakansii|job)$/i;
// `/`, `/en`, `/ru/` — a homepage in another language is still a homepage.
const LOCALE_ROOT_RE = /^(\/[a-z]{2}(-[a-z]{2})?)?$/i;

// Employer written as a labelled field, the dominant shape in HR-curated RU
// channels (`🏢 Компания: Контур`) and in EN ones (`Company: Picnic`).
const EMPLOYER_LABEL_RE = /^[^\p{L}\p{N}]{0,3}\s*(?:компания|компанія|company|работодатель|employer|hiring company)\s*[:：]\s*(.{2,80})$/iu;
// Employer hidden on purpose. The post is real but rule 1 cannot be met.
const ANONYMOUS_RE = /(?:название скрыто|компания скрыта|name hidden|undisclosed|confidential|\bour client\b|наш(?:его|им|ему)? клиент|для клиента)/i;
// The same, said further down the post: "Подбор ведёт агентство Top
// Selection, название компании-заказчика не раскрыто" follows a first line
// "Top Selection ищет …", which names the agency, not the employer. Matched
// over the whole post: unlike "наш клиент", none of these phrases appears in
// an employer's own description of itself. Each one names the employer as
// what is withheld: "Зарплата не раскрыта" and "Оценка компании не
// раскрывается" (both measured) withhold something else.
const DISCLOSED_HIDDEN_RE = /(назван\p{L}*\s+(?:компании|работодателя|заказчика|клиента)(?:-заказчика)?\s+не\s+(?:раскры|называ)|компани[яию]-заказчик|неназванн\p{L}*\s+(?:\p{L}+\s+){0,2}(?:компани|организаци|фирм|финтех|клиент|заказчик|работодател))/iu;
const LOCATIONISH_RE = /\b(remote|удал[её]нк\w*|hybrid|onsite|office|офис|full[- ]?time|part[- ]?time|москва|спб|berlin|london|germany|europe|usa)\b/i;
const DATE_LIKE_RE = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
// A line of nothing but hashtags ("#middle #удаленка") — never a title, and
// on the channel template measured 2026-09-05 (@ai_rabota, @job_python since
// their 2026-08-17 change) it precedes a bare employer name with no marker.
const HASHTAG_LINE_RE = /^#\S+(?:\s+#\S+)*$/u;
// Seniority/role vocabulary, matched with Unicode-aware lookarounds instead
// of \b: JS word boundaries are ASCII-only ([A-Za-z0-9_]), so \b never fires
// around Cyrillic letters and would silently never match разработчик/инженер.
// Unlike the other four employerName() shapes, the hashtag-template line has
// no marker at all pinning it to "employer", so a short role title ("Senior
// Engineer", "Ведущий инженер") would otherwise pass every plausibleEmployer()
// check a real employer name does. The role-vocabulary extension was replayed
// on 2026-09-07 against the saved 809-post corpus: the same 152 company/URL
// attributions as before the extension.
const ROLE_WORD_RE = /(?<![\p{L}\p{N}])(senior|middle|junior|lead|principal|staff|head|chief|intern|trainee|engineer|developer|manager|analyst|designer|architect|specialist|consultant|director|recruiter|scientist|product\s+owner|qa|tester|devops|sre|инженер|разработчик|менеджер|специалист|аналитик|директор|архитектор|рекрутер|стажер|стажёр|тестировщик|тимлид|владелец|руководитель|маркетолог|программист)(?![\p{L}\p{N}])/iu;
// The positional shapes added on 2026-10-31 (see employerName()) capture a
// phrase whose position, not a label,
// says "employer", so they also refuse what that position holds when it is
// not one. A sector or a unit rather than a company ("в FinTech", "в команду
// CDP", "Крупная ИТ-компания ищет"); Cyrillic stems are matched as
// substrings, Latin words whole.
const GENERIC_ORG_RE = /(компани|команд|стартап|проект|продукт|отдел|направлени|подразделени|агентств|заказчик|работодател|финтех|геймдев|ритейл|индустри|отрасл|маркетплейс|поиск)|(?<![\p{L}\p{N}])(team|company|startup|client|agency|fintech|edtech|gamedev|igaming|e-?commerce|it|ит)(?![\p{L}\p{N}])/iu;
// A work format where the employer would be: Proglib's third line is
// "Удаленно (Москва)" / "Офис/гибрид (Москва)". LOCATIONISH_RE cannot catch
// these: its \b never fires next to a Cyrillic letter.
const WORK_FORMAT_RE = /(?<![\p{L}])(удал[её]н\p{L}*|гибрид\p{L}*|офис\p{L}*|релокац\p{L}*|remote|hybrid|onsite|on-site|office)(?![\p{L}])/iu;
// A line that is nothing but a work format or a reach ("Worldwide 🌏",
// "remote", "Удалённо · Москва" is not: it names a city) — never a title.
const FORMAT_ONLY_RE = /^(?:(?:worldwide|anywhere|global|remote|hybrid|on-?site|office|удал[её]нн?\p{L}*|гибрид\p{L}*|офис\p{L}*)[\s,/()·|-]*)+$/iu;
// A phrase, not a name: "в Чехии или Испании", "Автотестировщик на Java".
const FUNCTION_WORD_RE = /(?<![\p{L}])(или|и|на|в|во|с|со|для|по|от|до|из|за|к|у|о|об|при|and|or|of|the|to|in|for|with)(?![\p{L}])/u;
// What precedes `в` when the `в` phrase is a destination: "с переездом в
// Дубай", "работа в офисе в …".
const DESTINATION_LEAD_RE = /(?<![\p{L}])(переезд\p{L}*|релокац\p{L}*|офис\p{L}*|работ\p{L}*|проживани\p{L}*|relocation|relocate|based|office)$/iu;
// A department, not a company: "Senior Director, Product Design – Ecosystem"
// (Slack, measured), "… – Payments Platform".
const DEPARTMENT_RE = /(?<![\p{L}])(development|design|engineering|platform|infrastructure|ecosystem|marketing|analytics|operations|payments|growth|security|core|research)$/iu;

/**
 * A department rather than a company: ends in a DEPARTMENT_RE word and is
 * made only of ordinary capitalised words. A brand token (`YLAB
 * Development`, `X5 Platform`) keeps it a name.
 *
 * @param {string} name
 */
function isDepartment(name) {
  return DEPARTMENT_RE.test(name) && name.split(/\s+/).every((w) => /^\p{Lu}\p{Ll}+$/u.test(w));
}
// What opens "… is a …" when it is not the employer: "This is a full-time
// role", "The role is a …".
const PRONOUN_RE = /^(this|it|we|our|you|your|he|she|they|that|there|here|the\s+\p{L}+|candidate|salary|position|role|job)$/iu;
// A stack word opening the right-hand side of "Title / X" names the
// technology, not the employer ("Android-разработчик / Kotlin Multiplatform").
const STACK_WORD_RE = /^(kotlin|swift|java|javascript|typescript|react|vue|angular|node(?:\.js)?|python|go|golang|php|ruby|rust|scala|flutter|unity|unreal|c\+\+|c#|\.net|ios|android|backend|frontend|fullstack|full-stack|mobile|web|devops|qa|ml|data|sql|graphql|kmp|1с|1c)(?![\p{L}\p{N}])/iu;
// A contract or employment term where the employer would be ("Title / B2B").
const CONTRACT_RE = /(?<![\p{L}\p{N}])(b2b|гпх|тк\s+рф|contract|contractor|freelance|фриланс|gross|net|usdt)(?![\p{L}\p{N}])/iu;
// A person, not a company: a Russian patronymic ("Мария Петровна" — finder.work
// shows the individual who posted) or a sole trader ("ИП Иванов").
const PERSON_RE = /(?:ович|евич|овна|евна|ична|инична)(?![\p{L}])|^ИП(?![\p{L}])/u;
// "в Москве", "в Сербии": one declined Cyrillic word after `в` is a place far
// more often than a company. Declined company names ("в Яндексе") are lost
// with it; a missing row beats a wrong employer.
const LOCATIVE_RE = /^[\p{Script=Cyrillic}-]+[еиу]$/u;
const YEAR_RE = /(?<!\d)(19|20)\d{2}(?!\d)/;
// The employer phrase "X ищет …" opens a line (Proglib channels: "💻
// Wildberries ищет iOS-разработчика"; POSTER channels: "💎 Plus8Soft ищет
// Senior Frontend Developer"; "Компания «Top Selection» ищет …"). Singular
// verb only: "Ищут Head of Frontend" names nobody.
const SEEKS_RE = /^(?:(?:компания|студия|стартап)\s+)?[«"]?([^«»"]{2,60}?)[»"]?\s+(?:ищет|нанимает|is hiring|is looking for)(?![\p{L}\p{N}])/iu;
// "от 200 000 до 230 000 ₽", "$2000–2700 на руки": a salary line.
const SALARY_LINE_RE = /^(?:от|до|from|up to|~)?\s*[$€]?\s*\d[\d\s.,]*(?:\s*(?:[-–—]|до)\s*[$€]?\s*\d[\d\s.,]*)?\s*(?:₽|руб|\$|€|usd|eur|rub|тыс)/iu;

/** First non-empty line of a post, cut at a word boundary under TITLE_CAP. */
function headline(lines) {
  const first = lines[0] || '';
  if (first.length <= TITLE_CAP) return first;
  const cut = first.slice(0, TITLE_CAP);
  const space = cut.lastIndexOf(' ');
  return `${space > TITLE_CAP / 3 ? cut.slice(0, space) : cut}…`;
}

/**
 * Does `name` read as an employer, not as the location, contract or date the
 * same title patterns also capture? Digits are allowed for a labelled field
 * (`X5 Tech`, `2ГИС`, `Т1`) and refused where the name came out of a title
 * split (`Title | September 02, 2026`).
 *
 * @param {string} name
 * @param {boolean} fromTitle
 */
function plausibleEmployer(name, fromTitle) {
  const n = name.replace(ZERO_WIDTH_RE, '').trim();
  if (n.length < 2 || n.length > 60) return '';
  if (n.split(/\s+/).length > 4) return '';
  if (/[,:;!?]/.test(n) || /\.$/.test(n)) return '';
  if (LOCATIONISH_RE.test(n) || ANONYMOUS_RE.test(n)) return '';
  if (fromTitle && (DATE_LIKE_RE.test(n) || /\d/.test(n))) return '';
  if (!/\p{Lu}/u.test(n)) return '';
  return n;
}

/**
 * A title line without its decoration: the leading emoji or bullet, a
 * trailing pasted link (`Title в Tabby : https://…`), trailing emoji, and
 * trailing parenthesised or bracketed notes (`в Авиасейлс (команда SERP)`).
 *
 * @param {string} line
 */
function bareLine(line) {
  let s = line.replace(ZERO_WIDTH_RE, '').replace(/^[^\p{L}\p{N}«"]+/u, '');
  s = s.replace(/\s*[:—–-]?\s*https?:\/\/\S+\s*$/u, '');
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(/[^\p{L}\p{N})\]»"]+$/u, '').replace(/\s*[([][^()[\]]*[)\]]$/u, '');
  }
  return s.trim();
}

/**
 * plausibleEmployer() for the shapes that take the employer from its position
 * in a line rather than from a marker: also refuses a sector, a unit, a
 * contract term, a role, a person, a year, and a name that does not start the
 * way a name does. Digits are allowed (`БЮРО 1440`, `01.tech`).
 *
 * @param {string} raw
 */
function positionalEmployer(raw) {
  // "Social — 2ГИС", "TATLIN.UNIFIED — YADRO": a team, then its company.
  const tail = raw.split(/\s[—–]\s/).pop() || '';
  const n = plausibleEmployer(tail.replace(/[\s—–-]+$/u, ''), false).replace(/^[«"]|[»"]$/g, '');
  if (!n || !/^[\p{Lu}\p{N}]/u.test(n) || /[()[\]«»]/.test(n)) return '';
  if (YEAR_RE.test(n) || ROLE_WORD_RE.test(n) || GENERIC_ORG_RE.test(n) || CONTRACT_RE.test(n) || PERSON_RE.test(n)) return '';
  if (WORK_FORMAT_RE.test(n) || FUNCTION_WORD_RE.test(n) || isDepartment(n)) return '';
  return n;
}

/**
 * The employer a post names, or '' when it names none.
 *
 * Five shapes cover what public channels actually write. Measured
 * 2026-09-03 (461 RU/CIS job posts): a labelled line (`Компания: Контур`,
 * 117 posts), `Title @ Employer` (50, board-mirror channels), `Title | Employer`
 * (studio channels), and a second line opening `в Employer —` / `at Employer`
 * (35, junior boards). The fifth — a hashtag-only first line followed by the
 * bare employer name on the next — is a template two HR-curated channels
 * switched to on 2026-08-17; measured live 2026-09-05 on two fetched pages
 * each, it recovers 4/40 posts on @ai_rabota and 11/40 on @job_python that
 * the other four shapes could not attribute (0/40 on @jobforjunior, which
 * never used this template). Unlike the first four, this shape has no
 * marker pinning the candidate line to "employer" at all, so it also
 * refuses one that reads as a role (`ROLE_WORD_RE`, e.g. "Senior Engineer") —
 * every other shape is anchored by an explicit `Компания:`/`@`/`|`/`в` token
 * and does not need that check.
 *
 * Six positional shapes follow, tried only when the five above found nothing
 * (measured 2026-10-31, 2,973 posts from 51 channels): `Employer ищет …`
 * (Proglib, POSTER), `Title в Employer` on the title line (offerclaw, Remocate,
 * Sparkles mirrors), `Title / Employer`, a second line `Employer is a …`
 * (@geekjobs and its siblings), `Title — Employer`, and a finder.work
 * mirror's employer on the line after the salary. Their capture is a
 * position, not a label, so positionalEmployer() also refuses a role, a
 * sector or unit, a department, a work format, a contract term, a person, a
 * year and a phrase. Nothing else is guessed: not the channel name, not the
 * link's host, not free text — a wrong employer on a row is worse than a
 * missing row.
 *
 * Exported for tests.
 *
 * @param {string[]} lines - Plain-text lines of the post.
 * @returns {string}
 */
export function employerName(lines) {
  let m;
  for (const line of lines.slice(0, 40)) {
    if ((m = line.match(EMPLOYER_LABEL_RE))) return plausibleEmployer(m[1].replace(/\s*[|(].*$/, ''), false);
  }
  const first = lines[0] || '';
  const second = lines[1] || '';
  if ((m = first.match(/^.{3,140}?\s+@\s+(.{2,60})$/))) return plausibleEmployer(m[1], true);
  // "Title | Company" assumes exactly one `|` in the title. A template that
  // packs several pipe-delimited metadata tags into the title itself
  // (`Title | 5 year(s) | Senior | IC`) is a different shape: the capture
  // group's `[^|]` means the regex can only land on the LAST segment, which
  // is whichever tag the template puts there, never the employer — and it
  // reliably passes plausibleEmployer's own checks (a short, capitalized,
  // single word), so every post on such a channel got a wrong-but-plausible
  // employer instead of no match at all (#4455). Reject the shape outright
  // rather than guess which segment (if any) is the real employer.
  if (!/\|.*\|/.test(first) && (m = first.match(/^.{3,140}?\s+\|\s+([^|]{2,60})$/))) {
    const pipeEmployer = plausibleEmployer(m[1], true);
    // Defense in depth, same guard the hashtag-line shape below already
    // applies: a bare seniority/role word ("Senior", "Middle", "Lead")
    // passes plausibleEmployer's checks on its own (a single capitalized
    // word), but a real employer name is very rarely a single seniority
    // word (#4455). Anchored to the WHOLE capture, not a bare .test(): the
    // hashtag-line shape below can reuse ROLE_WORD_RE unanchored because its
    // capture is a full description line where a role word appearing at all
    // is already suspicious, but here the capture is a company name and a
    // role word can legitimately be part of one ("Senior Labs", "Acme
    // Senior Corp") — an unanchored test rejected those as if they were the
    // bare word alone (CodeRabbit review on #4479).
    const isBareRoleWord = new RegExp(`^${ROLE_WORD_RE.source}$`, ROLE_WORD_RE.flags).test(pipeEmployer);
    if (pipeEmployer && !isBareRoleWord) return pipeEmployer;
  }
  if ((m = second.match(/^(?:в|at)\s+([^—–,(]{2,60}?)\s*(?:[—–]|$)/u))) return plausibleEmployer(m[1], true);
  // A hashtag-only first line carries no title, and this template puts the
  // bare employer name alone on the next one, with no marker at all.
  if (HASHTAG_LINE_RE.test(first) && second) {
    const hashtagEmployer = plausibleEmployer(second, false);
    // A line of business is not a name either: "#Develpment\nCustom Software
    // Development" (@remote_jobs_relocate, measured 2026-10-31).
    if (hashtagEmployer && !ROLE_WORD_RE.test(hashtagEmployer) && !isDepartment(hashtagEmployer)) return hashtagEmployer;
  }
  // The six positional shapes below run only when every marked shape above
  // found nothing, so no post those attribute changes. Measured 2026-10-31 on
  // 2,973 posts from 51 public RU/CIS channels (3 pages each).
  //
  // "Employer ищет …" opening one of the first four lines. First, because it
  // is the most explicit of the six: "МТС Банк ищет iOS-разработчика для
  // продуктов в «Мой МТС»" also reads as a `в` title.
  for (const line of lines.slice(0, 4)) {
    if ((m = bareLine(line).match(SEEKS_RE))) {
      const name = positionalEmployer(m[1]);
      if (name) return name;
    }
  }
  const head = lines.find((l) => !HASHTAG_LINE_RE.test(l)) || '';
  const title = bareLine(head);
  // A `в` or a slash inside a quoted title belongs to the title: «ML Engineer
  // в Поиск», «REST / GraphQL API».
  const quoted = (s) => (s.match(/«/g) || []).length > (s.match(/»/g) || []).length;
  // "Title в Employer" / "Title at Employer" on the title line (offerclaw,
  // Remocate and Sparkles mirrors, Proglib's Go channel). The LAST `в` wins —
  // "Разработчик на Go в Server Infrastructure Yandex Cloud" would otherwise
  // read "Go в …" — and the employer is at most three words, so a team name
  // in front of the company fails closed.
  if ((m = title.match(/^(.{3,140})\s(?:в|at)\s(.{2,60})$/u)) && !quoted(m[1]) && !DESTINATION_LEAD_RE.test(m[1])) {
    const name = positionalEmployer(m[2]);
    if (name && name.split(/\s+/).length <= 3 && !LOCATIVE_RE.test(name)) return name;
  }
  // "Title / Employer", exactly one spaced slash ("Lead Golang Developer /
  // Andersen ⚡️"). A slash between two halves of a title ("Frontend /
  // Fullstack разработчик", "UI / UX Designer") leaves a role on the right.
  // A dash before the slash makes it a product area ("Senior Backend Engineer
  // (Go) — Payment Core / Card Issuing").
  if (!/\s\/\s.*\s\/\s/.test(title) && (m = title.match(/^(.{3,140}?)\s\/\s(.{2,60})$/u)) && !quoted(m[1])
      && !/\s[—–]\s/.test(m[1]) && !STACK_WORD_RE.test(m[2])) {
    const name = positionalEmployer(m[2]);
    if (name) return name;
  }
  // "Title\nEmployer is a …" — the EN template of @geekjobs and its siblings
  // ("iOS Engineer – Creative App\nElevenLabs is an AI research…"). Ahead of
  // the dash shape, whose right side there is the team.
  if ((m = (lines[1] || '').match(/^([\p{Lu}\p{N}][^,.;:!?]{0,40}?)\s+(?:is|are)\s+(?:a|an|the|one of)\s/u)) && !PRONOUN_RE.test(m[1]) && !STACK_WORD_RE.test(m[1])) {
    const name = positionalEmployer(m[1]);
    if (name) return name;
  }
  // "Title — Employer", exactly one spaced dash (Proglib: "Middle Golang
  // Developer — Timeweb Cloud"). A dash before a product area ("— Payment
  // Core / Card Issuing", "— Сети / Security / Anti-fraud") is too long or
  // carries a slash, and fails plausibleEmployer().
  // The left side must read as a role: "Coherent Solutions — Custom Software
  // Development" is the employer first and its line of business second.
  if (!/\s[—–]\s.*\s[—–]\s/.test(title) && (m = title.match(/^(.{3,140}?)\s[—–]\s(.{2,60})$/u)) && !quoted(m[1])
      && ROLE_WORD_RE.test(m[1]) && !STACK_WORD_RE.test(m[2]) && !m[2].includes('/')) {
    const name = positionalEmployer(m[2]);
    if (name) return name;
  }
  // finder.work mirrors: title, salary, then the employer alone on the third
  // line ("Data Engineer / от 200 000 до 230 000 ₽ / WILIX").
  if (lines.length >= 3 && SALARY_LINE_RE.test(lines[1])) {
    const name = positionalEmployer(lines[2]);
    if (name && !LOCATIVE_RE.test(name)) return name;
  }
  return '';
}

/**
 * What a link in a post is, for rule 2: `employer` (a vacancy page on the
 * employer's own https host), `board` (a known multi-employer board's
 * per-vacancy page), or null (Telegram, social, footer, shortener, form,
 * homepage or locale root, listing root, a page with no vacancy evidence, a
 * LinkedIn post rather than a job).
 *
 * Exported for tests.
 *
 * @param {string} href
 * @returns {'employer' | 'board' | null}
 */
export function classifyLink(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const board = BOARD_HOSTS.test(host);
  if (!host || (!board && NON_APPLY_HOSTS.test(host)) || SHORTENER_HOSTS.test(host) || FORM_HOSTS.test(host)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return /\/jobs\/view\//.test(path) ? 'board' : null;
  // A homepage or a listing root stays one even with a tracking tail
  // (`/?utm_source=telegram` is what channel footers add); only a parameter
  // that could identify a vacancy (`?gh_jid=123`, `?id=…`) makes it a page.
  const identifying = [...u.searchParams.keys()].some((k) => !TRACKING_PARAM_RE.test(k));
  if (LOCALE_ROOT_RE.test(path) && !identifying) return null;
  if (LISTING_ROOT_RE.test(path) && !identifying) return null;
  if (!VACANCY_EVIDENCE_RE.test(path) && !identifying) return null;
  return board ? 'board' : 'employer';
}

/**
 * The link a Job should carry, from the post's hrefs, or null.
 *
 * The employer's own page beats a board mirror of the same vacancy; within a
 * class the first link in the post wins. A post that carries two or more
 * distinct vacancy pages is a digest, not a listing, and yields null: the
 * scanner has no way to split it into the jobs it bundles.
 *
 * Exported for tests.
 *
 * @param {string[]} hrefs
 * @returns {{ url: string, kind: 'employer' | 'board' } | null}
 */
export function applicationLink(hrefs) {
  const seen = new Set();
  const qualified = [];
  for (const href of hrefs) {
    const kind = classifyLink(href);
    if (!kind) continue;
    const key = vacancyKey(href);
    if (seen.has(key)) continue;
    seen.add(key);
    qualified.push({ url: href, kind });
  }
  if (qualified.length === 0) return null;
  // A digest lists several vacancies of one kind (three board pages, or two
  // employer pages; every qualifying link is a vacancy page by now). One
  // board page plus the employer's own page is the same vacancy mirrored,
  // which is the normal shape and must not count.
  for (const kind of ['employer', 'board']) {
    if (qualified.filter((q) => q.kind === kind).length > 1) return null;
  }
  return qualified.find((q) => q.kind === 'employer') || qualified[0];
}

/**
 * Identity of a vacancy link: host, path and the query keys that identify
 * the vacancy, minus tracking keys and the fragment. The same page linked
 * twice with different `utm_` tails is one vacancy; `?gh_jid=1` and
 * `?gh_jid=2` on one path are two.
 *
 * @param {string} href - Already known to parse (classifyLink accepted it).
 */
function vacancyKey(href) {
  const u = new URL(href);
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM_RE.test(k)).sort();
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}?${new URLSearchParams(keep)}`;
}

/**
 * Parse one preview page. Exported for direct unit testing.
 *
 * Each post is a `.tgme_widget_message_wrap` block whose inner div carries
 * `data-post="<channel>/<id>"`; the body is `.tgme_widget_message_text`, the
 * timestamp a `<time datetime>`. Links are read from the body's markup before
 * it is flattened, because `htmlToText` drops anchors. Service messages
 * ("Channel created") and media-only posts carry no text a title could be
 * made of and are skipped.
 *
 * @param {unknown} html
 * @param {string} channel
 * @returns {{ posts: Array<{ id: number, url: string, title: string, description: string, lines: string[], hrefs: string[], postedAt: number|undefined }>, noPreview: boolean, textPosts: number }}
 */
export function parseChannelPage(html, channel) {
  if (typeof html !== 'string' || !html) return { posts: [], noPreview: false, textPosts: 0 };
  const chunks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  const posts = [];
  const seen = new Set();
  for (const chunk of chunks) {
    if (/\bservice_message\b/.test(chunk)) continue;
    const post = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!post || post[1].toLowerCase() !== channel.toLowerCase()) continue;
    const id = Number(post[2]);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    const textM = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textM) continue;
    const lines = textM[1].split(/<br\s*\/?>/i).map((l) => htmlToText(l).replace(ZERO_WIDTH_RE, '')).filter(Boolean);
    const title = headline(lines);
    if (!title) continue;
    // t.me double-encodes query ampersands in hrefs (`?s=x&amp;amp;utm_source=…`
    // in the served markup), so one decode leaves `&amp;` inside the URL.
    const hrefs = [...textM[1].matchAll(/href="([^"]+)"/g)].map((h) => decodeEntities(decodeEntities(h[1])));
    const timeM = chunk.match(/<time datetime="([^"]+)"/);
    const postedAt = timeM ? Date.parse(timeM[1]) : NaN;
    seen.add(id);
    posts.push({
      id,
      url: `https://t.me/${channel}/${id}`,
      title,
      description: lines.join('\n'),
      lines,
      hrefs,
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
    });
  }
  // No preview: t.me serves the generic "Telegram: Contact @handle" page instead.
  const noPreview = posts.length === 0 && /<meta property="og:title" content="Telegram: Contact @/i.test(html);
  // How many of the channel's own, text-bearing, non-service posts the page
  // carries by markup — counted independently of the split above, so a renamed
  // wrapper class or data-post attribute still reads as "posts we failed to
  // parse", while a media-only or service-only page stays an empty board.
  const own = Math.max(chunks.length, (html.match(new RegExp(`data-post="${channel}/`, 'gi')) || []).length);
  const withText = (html.match(/tgme_widget_message_text/g) || []).length;
  const service = (html.match(/\bservice_message\b/g) || []).length;
  const textPosts = Math.max(0, Math.min(own, withText) - service);
  return { posts, noPreview, textPosts };
}

/**
 * Turn one parsed post into a Job, or null when the policy cannot attribute
 * it. Exported for tests.
 *
 * @param {ReturnType<typeof parseChannelPage>['posts'][number]} post
 * @returns {{ title: string, url: string, company: string, location: string, description: string, postedAt?: number } | null}
 */
export function postToJob(post) {
  const company = employerName(post.lines);
  if (!company) return null;
  if (ANONYMOUS_RE.test(post.lines.slice(0, 3).join('\n'))) return null;
  if (DISCLOSED_HIDDEN_RE.test(post.description)) return null;
  const link = applicationLink(post.hrefs);
  if (!link) return null;
  // A hashtag-first post needs a later title: skip tags, the matched employer
  // (bare or recognized metadata), and bare links. An empty first line below
  // reuses only employerName's metadata rules, preserving "Title @ Employer"
  // and "Title | Employer" candidates. With no remaining title, drop the post.
  let title = post.title;
  if (HASHTAG_LINE_RE.test(post.lines[0] || '')) {
    const companyLower = company.toLowerCase();
    const isLinkLine = (l) => post.hrefs.includes(l) || /^https?:\/\//i.test(l);
    const better = post.lines.slice(1).find((l) => l.toLowerCase() !== companyLower
      && employerName(['', l]).toLowerCase() !== companyLower
      && !HASHTAG_LINE_RE.test(l) && !isLinkLine(l) && !FORMAT_ONLY_RE.test(bareLine(l)));
    if (!better) return null;
    title = headline([better]);
  }
  // "Title в Tabby : https://www.remocate.app/jobs/…" — the link is the url,
  // and cut by headline() it would leave "Title в Tabby :…".
  else if (/https?:\/\/\S+$/u.test(post.lines[0] || '')) {
    title = headline([post.lines[0].replace(/\s*[:—–-]?\s*https?:\/\/\S+$/u, '')]) || title;
  }
  const source = `\n\nSource: ${post.url}`;
  return {
    title,
    url: link.url,
    company,
    location: '',
    description: post.description.slice(0, DESCRIPTION_CAP - source.length) + source,
    ...(post.postedAt !== undefined ? { postedAt: post.postedAt } : {}),
  };
}

/** @param {unknown} raw @param {number} fallback @param {number} cap */
function pageCount(raw, fallback, cap) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, cap);
}

/** @type {Provider} */
export default {
  id: 'telegram-channel',

  /**
   * @param {{ name?: string, channel?: string, max_pages?: number|string, since_days?: number|string }} entry
   * @param {{ fetchText: Function, sleep?: Function, maxPages?: number, sinceMs?: number }} ctx
   */
  async fetch(entry, ctx) {
    const channel = String(entry.channel || '').replace(/^@/, '').trim();
    // The handle is the only value that reaches the URL, and the pattern pins
    // it to t.me/s/<handle>: no path separators, no query, no other host.
    if (!CHANNEL_RE.test(channel)) {
      throw new Error(`telegram-channel: "${entry.name || '?'}" needs a channel handle (5-32 letters, digits or underscores, no @), got ${JSON.stringify(entry.channel)}`);
    }
    // Pages are walked until the window is reached, so the inventory inside
    // `since_days` is complete (Source Indexing Policy, rule 3), up to a cap
    // that keeps one channel under ~5 s. ctx.maxPages (verify-portals) wins.
    const entryPages = pageCount(entry.max_pages, MAX_PAGES_CAP, MAX_PAGES_CAP);
    const maxPages = Math.min(entryPages, ctx.maxPages ?? Infinity);
    const sinceDays = Number(entry.since_days);
    const windowDays = Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : DEFAULT_SINCE_DAYS;
    // The scanner's own early-stop window (max_posting_age_days) can only be
    // narrower than the entry's; stop at whichever comes first.
    const cutoff = Math.max(Date.now() - windowDays * DAY_MS, Number.isFinite(ctx.sinceMs) ? Number(ctx.sinceMs) : 0);
    const label = entry.name || `@${channel}`;

    const jobs = [];
    let before = null;
    let read = 0;
    let reachedCutoff = false;
    let page = 0;
    for (; page < maxPages; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      const url = `https://t.me/s/${channel}${before === null ? '' : `?before=${before}`}`;
      let html;
      try {
        // redirect:'manual' is never followed, but the 3xx keeps its status and
        // Location, so a private channel is a named failure, not "fetch failed".
        html = await fetchTextWithRetry(ctx, url, { redirect: 'manual' });
      } catch (err) {
        if (page === 0 && err?.status >= 300 && err.status < 400) {
          throw new Error(`telegram-channel: @${channel} has no public preview — private channel, preview switched off, or no such channel (t.me answered ${err.status}${err.location ? ` → ${err.location}` : ''}). It cannot be read without an authenticated Telegram integration.`);
        }
        throw err;
      }
      const { posts, noPreview, textPosts } = parseChannelPage(html, channel);
      if (page === 0 && noPreview) {
        throw new Error(`telegram-channel: @${channel} has no public preview (private channel, or preview switched off) — it cannot be read without an authenticated Telegram integration`);
      }
      if (page === 0 && posts.length === 0 && textPosts > 0) {
        throw new Error(`telegram-channel: @${channel} served ${textPosts} text posts but none parsed — t.me markup changed`);
      }
      if (posts.length === 0) break;
      const oldest = Math.min(...posts.map((p) => p.id));
      if (before !== null && oldest >= before) break; // t.me re-served the same page
      read += posts.length;
      for (const post of posts) {
        if (post.postedAt !== undefined && post.postedAt < cutoff) { reachedCutoff = true; continue; }
        const job = postToJob(post);
        if (job) jobs.push(job);
      }
      if (reachedCutoff) break;
      before = oldest;
    }
    // Cap warning (same pattern as a16z-speedrun-talent/jibeapply/workday):
    // the window was not reached, so the inventory is a prefix. Silent under
    // ctx.maxPages, which is verify-portals asking for one page on purpose.
    if (page >= maxPages && !reachedCutoff && maxPages === entryPages) {
      console.error(`⚠️  telegram-channel: ${label} truncated at max_pages=${maxPages} (${read} posts read, none older than since_days=${windowDays} yet) — raise max_pages on this entry for the full window`);
    }
    return jobs;
  },
};
