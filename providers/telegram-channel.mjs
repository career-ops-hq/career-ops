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
// public channels: 137 pass (25% of the RU/CIS corpus, none of the EN one,
// whose channels mirror boards career-ops already scans or link through
// shorteners); every rejection is a post the policy could not attribute, not
// a parser failure.
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
const BOARD_HOSTS = /(^|\.)(getmatch\.ru|finder\.work|geekjob\.ru|geeklink\.io|linkedin\.com|hh\.ru|career\.habr\.com|djinni\.co|indeed\.com|glassdoor\.com|weworkremotely\.com|remoteok\.com|arbeitnow\.com|cryptojobslist\.com|relocate\.me|lemon\.io)$/i;
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
// check a real employer name does. Measured live 2026-09-05: all 46
// hashtag-first-line posts across two fetched pages of each channel still
// resolve to an employer, none blocked by this list.
const ROLE_WORD_RE = /(?<![\p{L}\p{N}])(senior|middle|junior|lead|principal|staff|head|chief|intern|trainee|engineer|developer|manager|analyst|designer|architect|specialist|consultant|director|recruiter|scientist|инженер|разработчик|менеджер|специалист|аналитик|директор|архитектор|рекрутер|стажер|стажёр)(?![\p{L}\p{N}])/iu;

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
 * and does not need that check. Nothing else is guessed: not the channel
 * name, not the link's host, not free text — a wrong employer on a row is
 * worse than a missing row.
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
  if ((m = first.match(/^.{3,140}?\s+\|\s+([^|]{2,60})$/))) return plausibleEmployer(m[1], true);
  if ((m = second.match(/^(?:в|at)\s+([^—–,(]{2,60}?)\s*(?:[—–]|$)/u))) return plausibleEmployer(m[1], true);
  // A hashtag-only first line carries no title, and this template puts the
  // bare employer name alone on the next one, with no marker at all.
  if (HASHTAG_LINE_RE.test(first) && second) {
    const hashtagEmployer = plausibleEmployer(second, false);
    if (hashtagEmployer && !ROLE_WORD_RE.test(hashtagEmployer)) return hashtagEmployer;
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
  if (!host || NON_APPLY_HOSTS.test(host) || SHORTENER_HOSTS.test(host) || FORM_HOSTS.test(host)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return /\/jobs\/view\//.test(path) ? 'board' : null;
  // A homepage or a listing root stays one even with a tracking tail
  // (`/?utm_source=telegram` is what channel footers add); only a parameter
  // that could identify a vacancy (`?gh_jid=123`, `?id=…`) makes it a page.
  const identifying = [...u.searchParams.keys()].some((k) => !TRACKING_PARAM_RE.test(k));
  if (LOCALE_ROOT_RE.test(path) && !identifying) return null;
  if (LISTING_ROOT_RE.test(path) && !identifying) return null;
  if (!VACANCY_EVIDENCE_RE.test(path) && !identifying) return null;
  return BOARD_HOSTS.test(host) ? 'board' : 'employer';
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
  const link = applicationLink(post.hrefs);
  if (!link) return null;
  // post.title is lines[0], parsed before the policy runs. On the
  // hashtag-first template that line is tags, not a title (employerName()
  // above already skipped it to read the employer from the next line) — the
  // real title is the first line after that which is neither more tags, the
  // employer name just matched, nor a bare link (t.me autolinks a raw URL
  // with the URL itself as the anchor's visible text, so a post with no
  // third line at all leaves the link as post.lines[1]). When no such line
  // exists the shape has no title to give, and falling back to post.title
  // would emit the hashtag line itself as the title — the same
  // wrong-field-is-worse-than-a-missing-row principle applicationLink() and
  // employerName() already apply, so the post is dropped instead.
  let title = post.title;
  if (HASHTAG_LINE_RE.test(post.lines[0] || '')) {
    const isLinkLine = (l) => post.hrefs.includes(l) || /^https?:\/\//i.test(l);
    const better = post.lines.slice(1).find((l) => l !== company && !HASHTAG_LINE_RE.test(l) && !isLinkLine(l));
    if (!better) return null;
    title = headline([better]);
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
