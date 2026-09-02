// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
//
// Telegram channel provider — public channels through the t.me/s/<channel>
// web preview: a plain HTTPS page, 20 posts per page, newest first, paged back
// with `?before=<post id>`. No API key, no login.
//
// Configured under `job_boards:` (see templates/portals.example.yml). Every post
// is one Job: title = its first line, url = the post permalink (the dedup key),
// description = the whole post. A private channel, one with the preview
// switched off, or a page whose markup no longer parses is reported as an
// error — never as an empty board.

import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const CHANNEL_RE = /^[a-z0-9_]{5,32}$/i;
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES_CAP = 10;
const DEFAULT_SINCE_DAYS = 30;
const TITLE_CAP = 120;
const PAGE_DELAY_MS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** First non-empty line of a post, cut at a word boundary under TITLE_CAP. */
function headline(textHtml) {
  const first = textHtml.split(/<br\s*\/?>/i).map((l) => htmlToText(l)).find(Boolean) || '';
  if (first.length <= TITLE_CAP) return first;
  const cut = first.slice(0, TITLE_CAP);
  const space = cut.lastIndexOf(' ');
  return `${space > TITLE_CAP / 3 ? cut.slice(0, space) : cut}…`;
}

/**
 * Parse one preview page. Exported for direct unit testing.
 *
 * Each post is a `.tgme_widget_message_wrap` block whose inner div carries
 * `data-post="<channel>/<id>"`; the body is `.tgme_widget_message_text`, the
 * timestamp a `<time datetime>`. Service messages ("Channel created") and
 * media-only posts carry no text a title could be made of and are skipped.
 *
 * @param {unknown} html
 * @param {string} channel
 * @returns {{ posts: Array<{ id: number, url: string, title: string, description: string, postedAt: number|undefined }>, noPreview: boolean, textPosts: number }}
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
    const title = headline(textM[1]);
    if (!title) continue;
    const timeM = chunk.match(/<time datetime="([^"]+)"/);
    const postedAt = timeM ? Date.parse(timeM[1]) : NaN;
    seen.add(id);
    posts.push({
      id,
      url: `https://t.me/${channel}/${id}`,
      title,
      description: htmlToText(textM[1]),
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
   * @param {{ fetchText: Function, sleep?: Function, maxPages?: number }} ctx
   */
  async fetch(entry, ctx) {
    const channel = String(entry.channel || '').replace(/^@/, '').trim();
    // The handle is the only value that reaches the URL, and the pattern pins
    // it to t.me/s/<handle>: no path separators, no query, no other host.
    if (!CHANNEL_RE.test(channel)) {
      throw new Error(`telegram-channel: "${entry.name || '?'}" needs a channel handle (5-32 letters, digits or underscores, no @), got ${JSON.stringify(entry.channel)}`);
    }
    const maxPages = Math.min(pageCount(entry.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP), ctx.maxPages ?? Infinity);
    const sinceDays = Number(entry.since_days);
    const cutoff = Date.now() - (Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : DEFAULT_SINCE_DAYS) * DAY_MS;
    const company = entry.name || `@${channel}`;

    const jobs = [];
    let before = null;
    for (let page = 0; page < maxPages; page++) {
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
      let reachedCutoff = false;
      for (const post of posts) {
        if (post.postedAt !== undefined && post.postedAt < cutoff) { reachedCutoff = true; continue; }
        jobs.push({
          title: post.title,
          url: post.url,
          company,
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
