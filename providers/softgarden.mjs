// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// softgarden provider — the hosted job widgets at
// https://{tenant}.softgarden.io/{lang}/widgets/jobs (e.g. RENK:
// renk-group.softgarden.io/de/widgets/jobs). Companies embed this Wicket page
// as an iframe on their branded career sites; fetched directly it is a plain
// server-rendered document that lists EVERY posting — no auth, no JS, no
// pagination observed (filtering happens client-side via AJAX we don't need).
//
// One posting renders as:
//   <div class="matchElement" id="job_id_{id}">
//     <div class="matchValue date">04.07.26</div>
//     <div class="matchValue title">
//       <a href="../../job/{id}/{slug}?jobDbPVId=…&l=de">{Title}</a></div>
//     <div class="matchValue audience">…</div>
//     <div class="matchValue ProjectGeoLocationCity">…
//       <span class="location-view-item">{City}</span>…</div>
//   </div>
//
// The href is relative to the /{lang}/widgets/ path — we resolve it against
// the widget URL so it lands on {origin}/job/{id}/{slug}?… (verified live).
// The date is the locale's short form (de: D.M.YY with dots; en variants use
// slashes M/D/YY) — same heuristic as the successfactors CSB parser.

const MAX_JOBS = 1000; // cap postings taken from one widget page

// Minimal HTML entity decoder — titles carry named (&amp;) and numeric
// (&#252; / &#xfc;) entities. Mirrors successfactors.mjs / dassault.mjs.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Resolve the widget URL: explicit /widgets/jobs URLs pass through, any other
 * *.softgarden.io URL defaults to the German jobs widget. */
export function resolveWidgetUrl(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.host.toLowerCase();
  if (host !== 'softgarden.io' && !host.endsWith('.softgarden.io')) return null;
  if (/\/widgets\/jobs\/?$/.test(u.pathname)) return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  const lang = (u.pathname.match(/^\/([a-z]{2})(\/|$)/) || [])[1] || 'de';
  return `${u.origin}/${lang}/widgets/jobs`;
}

// Widget dates are the locale's SHORT form: de widgets emit D.M.YY with dots,
// en variants M/D/YY with slashes. Separator infers the field order; 2-digit
// years are 20YY. Junk → undefined ("unknown date", never a bogus timestamp).
/** @param {unknown} raw @returns {number | undefined} */
export function parseSoftgardenDate(raw) {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  let a, b, year;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (slash) {
    [, a, b, year] = slash; // M/D/Y
  } else if (dot) {
    [, b, a, year] = dot; // D.M.Y → swap to month/day
  } else {
    return undefined;
  }
  const month = Number(a);
  const day = Number(b);
  let y = Number(year);
  if (y < 100) y += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(y, month - 1, day);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Parse the widget page into raw {id, title, url, location, postedAt} records.
 * @param {string} html @param {string} widgetUrl
 */
export function parseWidget(html, widgetUrl) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  const blocks = html.split(/<div class="matchElement" id="job_id_/).slice(1);
  for (const block of blocks) {
    const id = (block.match(/^(\d+)"/) || [])[1];
    if (!id || seen.has(id)) continue;
    const linkM = block.match(/<a href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    const title = clean(linkM[2]);
    if (!title) continue;
    let url;
    try {
      // hrefs are relative to the /{lang}/widgets/ path ("../../job/…").
      url = new URL(decodeEntities(linkM[1]), widgetUrl).href;
    } catch {
      continue;
    }
    const cities = [];
    const cityRe = /class="location-view-item"[^>]*>([\s\S]*?)<\/span>/g;
    let cm;
    while ((cm = cityRe.exec(block)) !== null) {
      const c = clean(cm[1]);
      if (c && !cities.includes(c)) cities.push(c);
    }
    const dateM = block.match(/class="matchValue date"[^>]*>([\s\S]*?)<\/div>/);
    seen.add(id);
    out.push({
      id,
      title,
      url,
      location: cities.join(' / '),
      postedAt: parseSoftgardenDate(dateM ? clean(dateM[1]) : undefined),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'softgarden',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveWidgetUrl({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const widgetUrl = resolveWidgetUrl(entry);
    if (!widgetUrl) throw new Error(`softgarden: cannot resolve widget URL for ${entry.name}`);

    const html = await ctx.fetchText(widgetUrl, { headers: { accept: 'text/html' } });
    const rows = parseWidget(html, widgetUrl);
    const jobs = [];
    for (const row of rows) {
      const job = { title: row.title, url: row.url, company: entry.name, location: row.location };
      if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
      jobs.push(job);
      if (jobs.length >= MAX_JOBS) break;
    }
    return jobs;
  },
};
