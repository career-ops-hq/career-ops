// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const MAX_PAGES = 5;
const DEFAULT_MAX_JOBS = 100;

/** @param {string} s */
function clean(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** @type {Provider} */
export default {
  id: 'magneto',

  detect(entry) {
    if (entry.provider === 'magneto') return { url: entry.api || entry.careers_url };
    const raw = entry.api || entry.careers_url || '';
    if (raw.includes('magneto365.com')) return { url: raw };
    return null;
  },

  async fetch(entry, ctx) {
    const listUrl = entry.api || entry.careers_url;
    if (!listUrl) throw new Error(`magneto: no URL provided for ${entry.name}`);

    const origin = new URL(listUrl).origin;
    const maxPages = entry.max_pages || MAX_PAGES;
    const maxJobs = entry.max_jobs || DEFAULT_MAX_JOBS;
    const jobs = [];
    const seen = new Set();
    
    // Función de espera para evitar bloqueos
    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await wait(1000 + Math.random() * 1000); // 1-2s delay
      
      const pageUrl = listUrl.includes('?') ? `${listUrl}&page=${page}` : `${listUrl}?page=${page}`;
      
      let html;
      try {
        html = await ctx.fetchText(pageUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
          }
        });
      } catch (err) {
        if (page === 1) throw err;
        break; // Stop paginating on error
      }

      // Buscar anclas de trabajos en Magneto365
      const anchors = html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
      let fresh = 0;

      for (const match of anchors) {
        const href = match[1];
        const inner = match[2];

        // Filtramos para asegurar que es un trabajo (Magneto usa /empleos/, /ofertas/ o /trabajos/)
        if (!href.includes('/empleos/') && !href.includes('/ofertas/') && !href.includes('/trabajo')) continue;
        
        let url;
        try {
          url = new URL(href, origin).href;
        } catch {
          continue;
        }

        // Deduplicar
        const urlId = url.split('?')[0];
        if (seen.has(urlId)) continue;
        seen.add(urlId);

        // Extraer título limpiando HTML
        const titleMatch = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || 
                           inner.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        
        const title = clean(titleMatch ? titleMatch[1] : inner);
        if (!title || title.length < 3) continue;

        jobs.push({ title, url, company: entry.name, location: 'Colombia' });
        fresh++;
        if (jobs.length >= maxJobs) break;
      }

      // Si Magneto usa una API JSON expuesta en el tag script id="__NEXT_DATA__"
      if (fresh === 0 && html.includes('__NEXT_DATA__')) {
         const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
         if (nextDataMatch) {
            try {
               const data = JSON.parse(nextDataMatch[1]);
               // Intentar ubicar los empleos en el state de Next.js
               const offers = data.props?.pageProps?.initialState?.jobs?.data || data.props?.pageProps?.jobs || [];
               for (const offer of offers) {
                  const url = offer.slug ? new URL(`/co/empleos/${offer.slug}`, origin).href : null;
                  if (!url || seen.has(url)) continue;
                  seen.add(url);
                  jobs.push({
                     title: clean(offer.title || ''),
                     url,
                     company: clean(offer.company?.name || entry.name),
                     location: clean(offer.location?.name || 'Colombia')
                  });
                  fresh++;
                  if (jobs.length >= maxJobs) break;
               }
            } catch(e) {
               // Ignorar fallo de parseo JSON fallback
            }
         }
      }

      if (fresh === 0 || jobs.length >= maxJobs) break;
    }

    return jobs.slice(0, maxJobs);
  }
};
