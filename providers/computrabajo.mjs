// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const MAX_PAGES = 3; // Limitado para evitar baneos (usuario solicitó límite estricto)
const DEFAULT_MAX_JOBS = 15; // 10-15 resultados según lo solicitado

import { decodeEntities } from './_html-entities.mjs';

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Keep user overrides bounded so a typo cannot turn one board into a ban-prone crawl. */
function boundedPositiveInt(value, fallback, cap) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}

function companyFromCard(html, fallback) {
  const company = html.match(/class=\x22[^\x22]*(?:fc_base|company|empresa)[^\x22]*\x22[^>]*>([\s\S]*?)<\/(?:a|p|span|div)>/i);
  return company ? clean(company[1]) : fallback;
}

function titleFromCard(html, anchorHtml = '') {
  const heading = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const titleClass = html.match(/class=\x22[^\x22]*tc-it[^\x22]*\x22[^>]*>([^<]+)/i);
  return clean(heading ? heading[1] : titleClass ? titleClass[1] : anchorHtml);
}

/** @type {Provider} */
export default {
  id: 'computrabajo',

  detect(entry) {
    if (entry.provider === 'computrabajo') return { url: entry.api || entry.careers_url };
    const raw = entry.api || entry.careers_url || '';
    if (raw.includes('computrabajo.com')) return { url: raw };
    return null;
  },

  async fetch(entry, ctx) {
    const listUrl = entry.api || entry.careers_url;
    if (!listUrl) throw new Error(`computrabajo: no URL provided for ${entry.name}`);

    const origin = new URL(listUrl).origin;
    const maxPages = boundedPositiveInt(entry.max_pages, MAX_PAGES, MAX_PAGES);
    const maxJobs = boundedPositiveInt(entry.max_jobs, DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS);
    const jobs = [];
    const seen = new Set();
    
    // Tiempos de espera aleatorios (random delays de 2 a 5 segundos) solicitados
    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const randomDelay = () => wait(2000 + Math.random() * 3000);

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await randomDelay();
      
      const pageUrl = new URL(listUrl);
      pageUrl.searchParams.set('p', String(page));
      
      let html;
      try {
        html = await ctx.fetchText(pageUrl.href, {
          timeoutMs: 20_000,
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
      } catch (err) {
        if (page === 1) throw err;
        break; // Stop paginating on error
      }

      // Evitamos bloqueos de IP
      if (/cloudflare|captcha|access denied/i.test(html)) {
         console.warn(`[computrabajo] Bloqueo anti-bot detectado en página ${page}. Abortando listado.`);
         break;
      }

      // Buscar tarjetas de ofertas
      // Las vacantes suelen estar en anclas dentro de la lista de artículos
      const anchors = html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
      let fresh = 0;

      for (const match of anchors) {
        const href = match[1];
        const inner = match[2];
        const cardStart = typeof match.index === 'number' ? html.lastIndexOf('<article', match.index) : -1;
        const cardEnd = typeof match.index === 'number' ? html.indexOf('</article>', match.index) : -1;
        const cardHtml = cardStart >= 0 && cardEnd > cardStart ? html.slice(cardStart, cardEnd + 10) : inner;

        // Filtramos para asegurar que es una vacante (Computrabajo usa /ofertas-de-trabajo/ o /trabajo-de-)
        if (!href.includes('/ofertas-de-trabajo/') && !href.includes('/trabajo-de-')) continue;
        
        // Excluir enlaces a evaluaciones de empresa
        if (href.includes('/evaluaciones/')) continue;
        
        let url;
        try {
          url = new URL(href, origin).href;
        } catch {
          continue;
        }

        // Deduplicar: las urls de computrabajo a veces tienen parámetros ?busqueda=
        const urlId = url.split('?')[0];
        if (seen.has(urlId)) continue;
        seen.add(urlId);

        // Extraer título limpiando HTML. En computrabajo suele estar en un h1/h2 con class tc-it
        const titleMatch = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || 
                           inner.match(/<p[^>]*class="[^"]*tc-it[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
                           
        const title = titleFromCard(inner, titleMatch ? titleMatch[1] : inner);
        if (!title || title.length < 3) continue;

        jobs.push({ title, url, company: companyFromCard(cardHtml, entry.name), location: 'Colombia' });
        fresh++;
        if (jobs.length >= maxJobs) break;
      }

      // Fallback a artículos (<article>) si las anclas fallaron (a veces el h1/h2 no está DENTRO de la a, sino al lado)
      if (fresh === 0) {
         const articles = html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi);
         for (const match of articles) {
            const articleHtml = match[1];
            const aMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
            if (!aMatch) continue;
            
            const href = aMatch[1];
            if (!href.includes('/ofertas-de-trabajo/') && !href.includes('/trabajo-de-')) continue;
            
            let url;
            try { url = new URL(href, origin).href; } catch { continue; }
            
            const urlId = url.split('?')[0];
            if (seen.has(urlId)) continue;
            seen.add(urlId);
            
            const titleMatch = articleHtml.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
            const title = titleMatch ? clean(titleMatch[1]) : '';
            if (!title) continue;

            const company = companyFromCard(articleHtml, entry.name);
            
            jobs.push({ title, url, company, location: 'Colombia' });
            fresh++;
            if (jobs.length >= maxJobs) break;
         }
      }

      if (fresh === 0 || jobs.length >= maxJobs) break;
    }

    return jobs.slice(0, maxJobs);
  }
};
