/**
 * Read a tailored CV's HTML as a tree of addressable blocks, and write it back
 * with blocks hidden, reordered, or retexted.
 *
 * The tailored HTML is the artifact the pdf flow renders, so the Studio edits
 * it in place instead of rebuilding it from a payload: the header, the template
 * CSS, and every block the user leaves alone come out byte for byte. The class
 * names are build-cv-html.mjs's markup contract, which the web pdf prompt also
 * fills.
 *
 * @typedef {{id: string, start: number, end: number, inner: [number, number], text: string}} Bullet
 * @typedef {{id: string, kind: "entry"|"tag"|"text", label: string, start: number, end: number, bullets: Bullet[]}} Item
 * @typedef {{id: string, title: string, kind: SectionKind, start: number, end: number, items: Item[]}} Section
 * @typedef {"summary"|"competencies"|"experience"|"projects"|"education"|"skills"|"other"} SectionKind
 * @typedef {{html: string, sections: Section[]}} BlockTree
 */

const ENTRY_CLASSES = ["job", "project", "edu-item", "cert-item", "award-item", "skill-item"];
const ENTRY_LABEL_CLASS = { job: "job-company", project: "project-title", "edu-item": "edu-title", "cert-item": "cert-title", "award-item": "award-title", "skill-item": "skill-category" };

const KIND_BY_CLASS = [
  ["summary-text", "summary"],
  ["competency-tag", "competencies"],
  ["job", "experience"],
  ["project", "projects"],
  ["edu-item", "education"],
  ["skill-item", "skills"],
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** @param {string} html */
export function htmlText(html) {
  let text = String(html);
  // Tags whose insides cannot hold another "<". Repeat until stable so a nested
  // scrape like <scr<script>ipt> collapses; then drop any leftover angle brackets.
  for (let prev = null; text !== prev; ) {
    prev = text;
    text = text.replace(/<\/?[a-zA-Z!][^<>]*>/g, "");
  }
  text = text.replace(/[<>]/g, " ");
  return text
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text */
export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function closeOf(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function elementsWithClass(html, from, to, tag, cls) {
  const re = new RegExp(`<${tag}\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`, "gi");
  re.lastIndex = from;
  const out = [];
  for (let m = re.exec(html); m && m.index < to; m = re.exec(html)) {
    const end = closeOf(html, m.index, tag);
    if (end < 0 || end > to) break;
    out.push({ start: m.index, open: m.index + m[0].length, end });
    re.lastIndex = end;
  }
  return out;
}

function innerOf(el, tag) {
  return [el.open, el.end - `</${tag}>`.length];
}

function bulletsIn(html, from, to, prefix) {
  const out = [];
  const re = /<li\b[^>]*>/gi;
  re.lastIndex = from;
  for (let m = re.exec(html); m && m.index < to; m = re.exec(html)) {
    const close = html.indexOf("</li>", m.index);
    if (close < 0 || close > to) break;
    const inner = [m.index + m[0].length, close];
    out.push({ id: `${prefix}b${out.length}`, start: m.index, end: close + 5, inner, text: htmlText(html.slice(...inner)) });
    re.lastIndex = close + 5;
  }
  return out;
}

function sectionKind(body) {
  for (const [cls, kind] of KIND_BY_CLASS) if (new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s|")`).test(body)) return kind;
  return "other";
}

/**
 * @param {string} html
 * @returns {BlockTree}
 */
export function parseBlocks(html) {
  const sections = elementsWithClass(html, 0, html.length, "div", "section").map((el, si) => {
    const id = `s${si}`;
    const titleEl = elementsWithClass(html, el.open, el.end, "div", "section-title")[0];
    const title = titleEl ? htmlText(html.slice(...innerOf(titleEl, "div"))) : "";
    const body = html.slice(el.open, el.end);
    const kind = sectionKind(body);
    /** @type {Item[]} */
    let items = [];
    if (kind === "summary") {
      const t = elementsWithClass(html, el.open, el.end, "div", "summary-text")[0];
      if (t) {
        const inner = innerOf(t, "div");
        items = [{ id: `${id}i0`, kind: "text", label: title, start: t.start, end: t.end, bullets: [{ id: `${id}i0b0`, start: t.start, end: t.end, inner, text: htmlText(html.slice(...inner)) }] }];
      }
    } else if (kind === "competencies") {
      items = elementsWithClass(html, el.open, el.end, "span", "competency-tag").map((t, k) => ({ id: `${id}i${k}`, kind: "tag", label: htmlText(html.slice(t.open, t.end)), start: t.start, end: t.end, bullets: [] }));
    } else {
      const cls = ENTRY_CLASSES.find((c) => new RegExp(`class="${c}"`).test(body));
      if (cls) {
        items = elementsWithClass(html, el.open, el.end, "div", cls).map((e, k) => {
          const labelMatch = new RegExp(`class="${ENTRY_LABEL_CLASS[cls]}"[^>]*>([\\s\\S]*?)</`).exec(html.slice(e.open, e.end));
          const label = htmlText(labelMatch ? labelMatch[1].split("<")[0] : html.slice(e.open, e.end)).slice(0, 80);
          return { id: `${id}i${k}`, kind: "entry", label: label.replace(/:$/, ""), start: e.start, end: e.end, bullets: bulletsIn(html, e.open, e.end, `${id}i${k}`) };
        });
      }
    }
    return { id, title, kind, start: el.start, end: el.end, items };
  });
  return { html, sections };
}

/**
 * The visible state of each block. Absent ids keep their source order and text.
 *
 * @typedef {{hidden: Set<string>, order: Record<string, string[]>, text: Record<string, string>}} BlockView
 */

/** @template {{id: string}} T @param {T[]} children @param {string[] | undefined} order @returns {T[]} */
export function arrange(children, order) {
  if (!order) return children;
  const byId = new Map(children.map((c) => [c.id, c]));
  const picked = order.map((id) => byId.get(id)).filter(Boolean);
  return [...picked, ...children.filter((c) => !order.includes(c.id))];
}

function renderRange(html, start, end, children, ordered, hidden, renderChild) {
  const slots = [...children].sort((a, b) => a.start - b.start);
  if (!slots.length) return html.slice(start, end);
  const gaps = slots.slice(1).map((s, k) => html.slice(slots[k].end, s.start));
  const visible = ordered.filter((c) => !hidden.has(c.id));
  let out = html.slice(start, slots[0].start);
  visible.forEach((c, k) => {
    out += renderChild(c);
    if (k < visible.length - 1) out += gaps[Math.min(k, gaps.length - 1)] ?? "";
  });
  return out + html.slice(slots[slots.length - 1].end, end);
}

/**
 * @param {BlockTree} tree
 * @param {BlockView} view
 * @param {{added?: Record<string, string[]>}} [extra] new bullets appended to an entry, by item id
 * @returns {string}
 */
export function renderBlocks(tree, view, extra = {}) {
  const { html } = tree;
  const renderBullet = (b) => {
    const text = view.text[b.id];
    if (text === undefined) return html.slice(b.start, b.end);
    return html.slice(b.start, b.inner[0]) + escapeHtml(text) + html.slice(b.inner[1], b.end);
  };
  const renderItem = (item) => {
    const added = (extra.added?.[item.id] ?? []).filter((t) => t.trim());
    if (!item.bullets.length) return html.slice(item.start, item.end);
    let out = renderRange(html, item.start, item.end, item.bullets, arrange(item.bullets, view.order[item.id]), view.hidden, renderBullet);
    if (added.length && item.kind === "entry") {
      const li = html.slice(item.bullets[0].start, item.bullets[0].inner[0]);
      const extraLis = added.map((t) => `${li}${escapeHtml(t)}</li>`).join("\n    ");
      out = out.replace(/(\s*)<\/ul>/, (m, ws) => `\n    ${extraLis}${ws}</ul>`);
    }
    return out;
  };
  const renderSection = (s) => {
    if (s.items.length && s.items.every((i) => view.hidden.has(i.id))) return "";
    return renderRange(html, s.start, s.end, s.items, arrange(s.items, view.order[s.id]), view.hidden, renderItem);
  };
  return renderRange(html, 0, html.length, tree.sections, arrange(tree.sections, view.order.root), view.hidden, renderSection);
}
