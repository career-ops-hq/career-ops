const FIT = `.job-header, .edu-header, .contact-row, .cert-table, .award-table { min-width: 0; max-width: 100%; }
.job-header, .edu-header { flex-wrap: wrap; }
.job-company, .edu-title, .project-title, .skill-category { min-width: 0; overflow-wrap: anywhere; }
.job-period, .edu-year { flex-shrink: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.contact-row > * { max-width: 100%; min-width: 0; }
.summary-text, li { overflow-wrap: anywhere; }
a { white-space: normal; overflow-wrap: anywhere; }
.cert-org, .cert-year, .award-org, .award-year { white-space: normal; overflow-wrap: anywhere; }`;

const TAG = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z](?:[^>=]|=\s*"[^"]*"|=\s*'[^']*'|=(?!\s*["']))*>/y;
const RAW = /^(?:title|textarea|option|svg|math|xmp|plaintext|noembed|noframes|iframe|noscript)$/;

function renderInline(text) {
  return text
    .replace(/\*\*([^*]+?)\*\*/g, (_, inner) => `<strong>${inner}</strong>`)
    .replace(/(?<![\p{L}\p{N}_/\\])_(?=[^_\s])([^_\n]*?[^_\s])_(?![\p{L}\p{N}_/\\])/gu, (_, inner) => `<em>${inner}</em>`);
}

function mapText(html) {
  const masks = [];
  const masked = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (match) => {
    const token = `\u0000MASK${masks.length}\u0000`;
    masks.push(match);
    return token;
  });
  let plainUntil = null;
  let out = "";
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf("<", i);
    if (lt === -1) {
      out += plainUntil ? masked.slice(i) : renderInline(masked.slice(i));
      break;
    }
    out += plainUntil ? masked.slice(i, lt) : renderInline(masked.slice(i, lt));
    TAG.lastIndex = lt;
    const gt = TAG.test(masked) ? TAG.lastIndex - 1 : masked.indexOf(">", lt);
    if (gt === -1) {
      out += masked.slice(lt);
      break;
    }
    const tag = masked.slice(lt, gt + 1);
    const name = /^<\/?([A-Za-z][\w:-]*)/.exec(tag)?.[1].toLowerCase();
    if (plainUntil && (plainUntil === "option" || (tag[1] === "/" && name === plainUntil))) plainUntil = null;
    if (!plainUntil && tag[1] !== "/" && !tag.endsWith("/>") && RAW.test(name || "")) plainUntil = name;
    out += tag;
    i = gt + 1;
  }
  return out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
}

function injectFit(html) {
  const tag = `<style data-cv-preview-fit>${FIT}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  return tag + html;
}

export function previewHtml(html) {
  return injectFit(mapText(String(html ?? "")));
}
