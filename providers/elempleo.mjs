// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const MAX_PAGES = 5;
const DEFAULT_MAX_JOBS = 50;

import { decodeEntities } from './_html-entities.mjs';

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** @type {Provider} */
export default {
  id: 'elempleo',

  detect(entry) {
    if (entry.provider === 'elempleo') return { url: entry.api || entry.careers_url };
    const raw = entry.api || entry.careers_url || '';
    if (raw.includes('elempleo.com')) return { url: raw };
    return null;
  },

  async fetch(entry, ctx) {
    const listUrl = entry.api || entry.careers_url;
    if (!listUrl) throw new Error(`elempleo: no URL provided for ${entry.name}`);

    const origin = new URL(listUrl).origin;
    const maxPages = entry.max_pages || MAX_PAGES;
    const maxJobs = entry.max_jobs || DEFAULT_MAX_JOBS;
    const jobs = [];
    const seen = new Set();
    
    // Función de espera 
    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await wait(1000 + Math.random() * 1500); 
      
      const pageUrl = listUrl.includes('?') ? `${listUrl}&pagina=${page}` : `${listUrl}?pagina=${page}`;
      
      let html;
      try {
        html = await ctx.fetchText(pageUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          }
        });
      } catch (err) {
        if (page === 1) throw err;
        break; // Stop paginating on error
      }

      const anchors = html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
      let fresh = 0;

      for (const match of anchors) {
        let href = match[1];
        const inner = match[2];

        // Normalizamos la ruta ya que a veces tienen rutas relativas que empiezan sin slash
        if (!href.startsWith('http') && !href.startsWith('/')) href = '/' + href;

        // Filtramos para asegurar que es un trabajo (Elempleo usa /co/ofertas-trabajo/)
        if (!href.includes('/ofertas-trabajo/')) continue;
        
        let url;
        try {
          url = new URL(href, origin).href;
        } catch {
          continue;
        }

        const urlId = url.split('?')[0];
        if (seen.has(urlId)) continue;
        seen.add(urlId);

        // Extraer título limpiando HTML. Elempleo suele poner el título en h2 class text-ellipsis
        const titleMatch = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || 
                           inner.match(/<span[^>]*class="[^"]*text-ellipsis[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        
        const title = clean(titleMatch ? titleMatch[1] : inner);
        if (!title || title.length < 3) continue;

        jobs.push({ title, url, company: entry.name, location: 'Colombia' });
        fresh++;
        if (jobs.length >= maxJobs) break;
      }

      // Estructura alternativa basada en divs (si las anclas están estructuradas diferente)
      if (fresh === 0) {
         const resultItems = html.matchAll(/<div[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
         for (const itemMatch of resultItems) {
            const itemHtml = itemMatch[1];
            const aMatch = itemHtml.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (!aMatch) continue;

            let href = aMatch[1];
            if (!href.startsWith('http') && !href.startsWith('/')) href = '/' + href;
            if (!href.includes('/ofertas-trabajo/')) continue;

            let url;
            try { url = new URL(href, origin).href; } catch { continue; }

            const urlId = url.split('?')[0];
            if (seen.has(urlId)) continue;
            seen.add(urlId);

            const title = clean(aMatch[2]);
            if (!title || title.length < 3) continue;

            jobs.push({ title, url, company: entry.name, location: 'Colombia' });
            fresh++;
            if (jobs.length >= maxJobs) break;
         }
      }

      if (fresh === 0 || jobs.length >= maxJobs) break;
    }

    return jobs.slice(0, maxJobs);
  }
};
