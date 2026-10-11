/** Run through page.evaluate at the PDF's printable width, in print media. */
export function collectDomLayout() {
  const tolerance = 1;
  const root = document.documentElement;
  const container = document.querySelector('.page') || document.body;
  const label = (el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''}`;
  const visibleText = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!node.textContent.trim() || el.closest('script, style')
      || getComputedStyle(el).visibility !== 'visible') continue;
    const range = document.createRange();
    // Whitespace surrounding an inline node is not an ink collision.
    range.setStart(node, node.textContent.search(/\S/));
    range.setEnd(node, node.textContent.trimEnd().length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length) visibleText.push({ el, text: node.textContent.trim(), rects });
  }

  const overflowing = [...container.querySelectorAll('*')]
    .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + tolerance)
    .map(label);
  const clipped = [];
  for (const { el, text, rects } of visibleText) {
    let outside = rects.some((r) => r.left < -tolerance || r.right > root.clientWidth + tolerance);
    // scrollWidth alone misses vertical clipping and clipping on ancestors.
    for (let ancestor = el; ancestor && !outside; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const r = ancestor.getBoundingClientRect();
      const left = r.left + ancestor.clientLeft;
      const top = r.top + ancestor.clientTop;
      const clips = (overflow) => ['hidden', 'clip', 'auto', 'scroll'].includes(overflow);
      outside = rects.some((textRect) =>
        (clips(style.overflowX) && (textRect.left < left - tolerance || textRect.right > left + ancestor.clientWidth + tolerance))
        || (clips(style.overflowY) && (textRect.top < top - tolerance || textRect.bottom > top + ancestor.clientHeight + tolerance)));
    }
    if (outside) clipped.push(`${label(el)}: ${text.slice(0, 80)}`);
  }

  const photo = container.querySelector('.cv-photo')?.getBoundingClientRect();
  const photoCollisions = photo ? visibleText.filter(({ rects }) => rects.some((r) =>
    Math.min(r.right, photo.right) - Math.max(r.left, photo.left) > tolerance
    && Math.min(r.bottom, photo.bottom) - Math.max(r.top, photo.top) > tolerance
  )).map(({ text }) => text.slice(0, 80)) : [];
  const headingPairs = [...container.querySelectorAll('.section-title')].flatMap((heading) => {
    if (!visibleText.some(({ el }) => heading.contains(el))) return [];
    const section = heading.closest('.section');
    const first = visibleText.find(({ el }) => section?.contains(el) && !heading.contains(el));
    // Empty sections are not an orphan heading: the builder strips them, and
    // the content-presence assertions separately cover unexpectedly lost data.
    return first ? [{ heading: heading.textContent.trim(), body: first.text }] : [];
  });

  return {
    bodyOverflow: document.body.scrollWidth > root.clientWidth + tolerance,
    overflowing: [...new Set(overflowing)],
    clipped: [...new Set(clipped)],
    photoOverlap: photoCollisions.length > 0,
    photoCollisions,
    headings: headingPairs.length,
    headingPairs,
  };
}

function decodeXml(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()];
    return String.fromCodePoint(entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  });
}

/** Parse Poppler's local `pdftotext -bbox-layout` XHTML; no XML dependencies. */
export function parsePdfLayout(xml) {
  const number = (attributes, key) => {
    const match = attributes.match(new RegExp(`\\b${key}=["']([^"']+)["']`));
    if (!match || !Number.isFinite(Number(match[1]))) throw new Error(`Invalid PDF ${key} coordinate`);
    return Number(match[1]);
  };
  const pages = [...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)].map(([, attributes, body]) => ({
    width: number(attributes, 'width'),
    height: number(attributes, 'height'),
    words: [...body.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(([, attrs, text]) => ({
      text: decodeXml(text),
      ...Object.fromEntries(['xMin', 'yMin', 'xMax', 'yMax'].map((key) => [key, number(attrs, key)])),
    })),
  }));
  if (!pages.length) throw new Error('No pages in pdftotext bounding-box output');
  return pages;
}

const normalize = (text) => text.normalize('NFC').toLowerCase().replace(/[\s\u00ad\u200b]/gu, '');

/**
 * Check actual PDF glyph bounds and keep each heading with its first body text.
 * PDF points, not CSS pixels. Page-edge checks are independent of each
 * template's @page margins; callers can request a larger safety margin.
 */
export function inspectPdfLayout(pages, headingPairs, { marginPoints = 0, tolerance = 1 } = {}) {
  const clipped = [];
  const words = [];
  let text = '';
  for (const [index, page] of pages.entries()) {
    for (const word of page.words) {
      if (word.xMin < marginPoints - tolerance || word.yMin < marginPoints - tolerance
        || word.xMax > page.width - marginPoints + tolerance || word.yMax > page.height - marginPoints + tolerance) {
        clipped.push({ page: index + 1, text: word.text });
      }
      const start = text.length;
      text += normalize(word.text);
      if (text.length > start) words.push({ ...word, start, end: text.length, page: index + 1 });
    }
  }
  const locate = (offset) => words.find((word) => word.end > offset);
  const orphanHeadings = [];
  const missingText = [];
  let cursor = 0;
  for (const pair of headingPairs) {
    const heading = normalize(pair.heading);
    const body = normalize(pair.body);
    const headingAt = heading ? text.indexOf(heading, cursor) : -1;
    if (headingAt < 0) {
      missingText.push(`Heading: ${pair.heading}`);
      continue;
    }
    cursor = headingAt + heading.length;
    const first = locate(headingAt);
    const last = locate(cursor - 1);
    // Layout extraction can put a label rail after its body. Search all body
    // matches and use coordinates on that page, not the extractor's order.
    // Matching across pages also permits a long paragraph to continue after
    // its first line, which is a valid break, not an orphaned heading.
    let bodyAt = body ? text.indexOf(body) : -1;
    let next = null;
    while (bodyAt >= 0) {
      const candidate = locate(bodyAt);
      const sameLine = candidate.yMin >= first.yMin - Math.max(first.yMax - first.yMin, candidate.yMax - candidate.yMin) / 2;
      if (candidate.page === first.page && sameLine) {
        next = candidate;
        break;
      }
      if (candidate.page > first.page && !next) next = candidate;
      bodyAt = text.indexOf(body, bodyAt + 1);
    }
    if (!next) missingText.push(`Body after ${pair.heading}: ${pair.body}`);
    else if (first.page !== last.page || first.page !== next.page) {
      orphanHeadings.push({ heading: pair.heading, headingPage: first.page, bodyPage: next.page });
    }
  }
  return { clipped, orphanHeadings, missingText };
}

/** Preserve Latin word integrity even where CJK extraction inserts whitespace. */
export function missingAtsWords(text, values) {
  const extracted = new Set(text.toLowerCase().match(/[a-z]{3,}/g) || []);
  const words = new Set(values.flatMap((value) => value.toLowerCase().match(/[a-z]{3,}/g) || []));
  return [...words].filter((word) => !extracted.has(word));
}
