// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
//
// Telegram channel provider — public channels through the t.me/s/<channel>
// web preview. No API key, no login, no MTProto client: the preview is a
// plain HTTPS page listing the channel's posts newest-first, 20 per page,
// and it pages back through the whole history with `?before=<post id>`.
//
// Wire in via a `job_boards:` entry:
//   - name: "Telegram @devjobs"
//     provider: telegram-channel
//     channel: devjobs      # handle without the @
//     max_pages: 2          # 20 posts per page; default 1, capped at 10
//     since_days: 14        # stop once posts are older than this; default 30
//
// Every post becomes one Job: title = the post's first line, url = the post
// permalink (the dedup key), company = the channel, description = the whole
// post so `title_filter` / `content_filter` do the matching. A private
// channel, or one with the web preview switched off, serves a "Contact
// @channel" stub instead of posts; that is reported as an error rather than
// as an empty board — silence there is not "no jobs".

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

const CHANNEL_RE = /^[a-z0-9_]{5,32}$/i;
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES_CAP = 10;
const DEFAULT_SINCE_DAYS = 30;
const TITLE_CAP = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse one preview page into posts. Exported for direct unit testing.
 *
 * Each post sits in a `.tgme_widget_message_wrap` block whose inner div
 * carries `data-post="<channel>/<id>"`; the body is `.tgme_widget_message_text`
 * and the timestamp a `<time datetime="…">`. Posts without text (media-only)
 * carry nothing a title could be made of and are skipped.
 *
 * @param {unknown} html
 * @param {string} channel
 * @returns {{ posts: Array<{ id: number, url: string, title: string, description: string, postedAt: number|undefined }>, noPreview: boolean }}
 */
export function parseChannelPage(html, channel) {
  if (typeof html !== 'string' || !html) return { posts: [], noPreview: false };
  const chunks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  const posts = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const post = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!post || post[1].toLowerCase() !== channel.toLowerCase()) continue;
    const id = Number(post[2]);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    const textM = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textM) continue;
    // The first line is what channel authors use as a headline; htmlToText
    // collapses whitespace, so split on <br> before stripping markup.
    const title = htmlToText(textM[1].split(/<br\s*\/?>/i)[0]).slice(0, TITLE_CAP);
    if (!title) continue;
    const timeM = chunk.match(/<time datetime="([^"]+)"/);
    const postedAt = timeM ? Date.parse(decodeEntities(timeM[1])) : NaN;
    seen.add(id);
    posts.push({
      id,
      url: `https://t.me/${channel}/${id}`,
      title,
      description: htmlToText(textM[1]),
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
    });
  }
  // A channel without a public preview renders the generic "Telegram: Contact
  // @handle" page: no posts, and an og:title that names a contact, not a channel.
  const noPreview = posts.length === 0 && /<meta property="og:title" content="Telegram: Contact @/i.test(html);
  return { posts, noPreview };
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
   * @param {{ fetchText: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<string> }} ctx
   */
  async fetch(entry, ctx) {
    const channel = String(entry.channel || '').replace(/^@/, '').trim();
    // The handle is the only thing that reaches the URL, and the pattern pins
    // it to t.me/s/<handle>: no path separators, no query, no other host.
    if (!CHANNEL_RE.test(channel)) {
      throw new Error(`telegram-channel: "${entry.name || '?'}" needs a channel handle (5-32 letters, digits or underscores, no @), got ${JSON.stringify(entry.channel)}`);
    }
    const maxPages = pageCount(entry.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const sinceDays = Number(entry.since_days);
    const cutoff = Date.now() - (Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : DEFAULT_SINCE_DAYS) * DAY_MS;

    const jobs = [];
    let before = null;
    for (let page = 0; page < maxPages; page++) {
      const url = `https://t.me/s/${channel}${before === null ? '' : `?before=${before}`}`;
      // redirect:'manual', not 'error': neither follows a redirect, but 'manual'
      // surfaces the 3xx as an error carrying status + location. A public
      // channel serves the preview with 200; a private one, one with the
      // preview switched off, and a handle that does not exist all answer
      // 302 → https://t.me/<handle> (the "Contact @handle" page). Under
      // 'error' that arrives as a bare "fetch failed", indistinguishable from
      // a network fault; here it becomes a named, actionable failure.
      let html;
      try {
        html = await ctx.fetchText(url, { redirect: 'manual' });
      } catch (err) {
        if (page === 0 && err?.status >= 300 && err.status < 400) {
          throw new Error(`telegram-channel: @${channel} has no public preview — private channel, preview switched off, or no such channel (t.me answered ${err.status}${err.location ? ` → ${err.location}` : ''}). It cannot be read without an authenticated Telegram integration.`);
        }
        throw err;
      }
      const { posts, noPreview } = parseChannelPage(html, channel);
      if (page === 0 && noPreview) {
        // Same stub delivered with a 200 (a proxy that followed the redirect).
        throw new Error(`telegram-channel: @${channel} has no public preview (private channel, or preview switched off) — it cannot be read without an authenticated Telegram integration`);
      }
      if (posts.length === 0) break;
      // A page that did not move back (t.me re-serving the same posts) would
      // otherwise be appended a second time before the loop noticed.
      const oldest = Math.min(...posts.map((p) => p.id));
      if (before !== null && oldest >= before) break;

      let reachedCutoff = false;
      for (const post of posts) {
        if (post.postedAt !== undefined && post.postedAt < cutoff) { reachedCutoff = true; continue; }
        jobs.push({
          title: post.title,
          url: post.url,
          company: `@${channel}`,
          location: '',
          description: post.description,
          ...(post.postedAt !== undefined ? { postedAt: post.postedAt } : {}),
        });
      }
      if (reachedCutoff) break;
      before = oldest;
    }
    return jobs;
  },
};
