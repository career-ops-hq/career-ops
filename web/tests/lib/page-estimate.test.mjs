// The live preview's page count. A two-page CV switched to One page still
// said "2 pages" because the measurement read the iframe viewport, which
// keeps the previous height. These numbers are that session: the content
// box was 626px and the viewport was still 1515px.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHeightPx, frameHeightAfterProbe, frameHeightPx, previewPageCount, PREVIEW_PAGE_PX } from "../../src/lib/cv-studio/page-estimate.mjs";

function doc({ content, viewport }) {
  return {
    body: {
      scrollHeight: content,
      querySelector(sel) {
        assert.equal(sel, ".page");
        return { scrollHeight: content };
      },
    },
    documentElement: { scrollHeight: viewport },
  };
}

test("a shorter CV estimates from the content box, not the iframe viewport", () => {
  assert.equal(contentHeightPx(doc({ content: 626, viewport: 1515 })), 626);
  assert.equal(previewPageCount(626), 1);
});

test("a repeated measure puts the measured height back, not the one-page probe", () => {
  assert.equal(frameHeightAfterProbe(2112, 2112), 2112);
  assert.equal(frameHeightAfterProbe(0, 2112), 2112);
  assert.equal(frameHeightAfterProbe(1800, PREVIEW_PAGE_PX), 1800);
});

test("content taller than one page estimates two", () => {
  assert.equal(previewPageCount(1515), 2);
  assert.equal(previewPageCount(PREVIEW_PAGE_PX), 1);
  assert.equal(previewPageCount(PREVIEW_PAGE_PX + 1), 2);
});

test("sibling .page boxes are measured from the first one's top to the last one's bottom", () => {
  const page = (top, height) => ({ scrollHeight: height, getBoundingClientRect: () => ({ top, height }) });
  const pages = [page(8, 1000), page(1024, 900)];
  const twoPages = {
    body: {
      scrollHeight: 1000,
      querySelector: () => pages[0],
      querySelectorAll(sel) {
        assert.equal(sel, ".page");
        return pages;
      },
    },
    documentElement: { scrollHeight: 1932 },
  };
  assert.equal(contentHeightPx(twoPages), 1916);
  assert.equal(previewPageCount(contentHeightPx(twoPages)), 2);
});

test("the iframe includes the margin above the page and the page count does not", () => {
  const page = (top, height) => ({ scrollHeight: height, getBoundingClientRect: () => ({ top, height }) });
  const pages = [page(8, 1048)];
  const one = {
    body: {
      scrollHeight: 1048,
      querySelector: () => pages[0],
      querySelectorAll: () => pages,
    },
  };
  assert.equal(contentHeightPx(one), 1048);
  assert.equal(frameHeightPx(one), 1056);
  assert.equal(previewPageCount(contentHeightPx(one)), 1);
  const pageIsFirstChild = {
    body: {
      children: pages,
      scrollHeight: 1048,
      querySelector: () => pages[0],
      querySelectorAll: () => pages,
    },
  };
  assert.equal(contentHeightPx(pageIsFirstChild), 1048);
  assert.equal(frameHeightPx(pageIsFirstChild), 1056);
  assert.equal(frameHeightPx(null), 0);
});

test("a header before .page counts toward the preview height", () => {
  const header = { getBoundingClientRect: () => ({ top: 0, height: 200 }) };
  const page = { scrollHeight: 900, getBoundingClientRect: () => ({ top: 200, height: 900 }) };
  const one = {
    body: {
      children: [header, page],
      scrollHeight: 3000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(one), 1100);
  assert.equal(frameHeightPx(one), 1100);
  assert.equal(previewPageCount(contentHeightPx(one)), 2);
});

test("a header drawn above the page counts when the page comes first in the DOM", () => {
  const header = { offsetHeight: 200, getBoundingClientRect: () => ({ top: 0, height: 200, width: 800 }) };
  const page = { scrollHeight: 900, getBoundingClientRect: () => ({ top: 200, height: 900, width: 800 }) };
  const one = {
    body: {
      children: [page, header],
      scrollHeight: 3000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(one), 1100);
  assert.equal(frameHeightPx(one), 1100);
  assert.equal(previewPageCount(contentHeightPx(one)), 2);

  const wrap = { offsetHeight: 10, getBoundingClientRect: () => ({ top: 400, height: 10, width: 800 }), children: [header] };
  const nested = {
    body: {
      children: [page, wrap],
      scrollHeight: 3000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(nested), 1100);
});

test("a footer after .page is in the height, and a stretched body scroll height is not", () => {
  const page = { scrollHeight: 1000, getBoundingClientRect: () => ({ top: 0, height: 1000 }) };
  const footer = { offsetHeight: 200, getBoundingClientRect: () => ({ top: 1000, height: 200 }) };
  const withFooter = {
    body: {
      children: [page, footer],
      scrollHeight: 2000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(withFooter), 1200);
  assert.equal(frameHeightPx(withFooter), 1200);
  assert.equal(previewPageCount(contentHeightPx(withFooter)), 2);
});

test("a footer margin is part of the preview height", () => {
  const page = { scrollHeight: 900, getBoundingClientRect: () => ({ top: 0, height: 900 }) };
  const footer = { offsetHeight: 100, getBoundingClientRect: () => ({ top: 1100, height: 100 }) };
  const withGap = {
    body: {
      children: [page, footer],
      scrollHeight: 2000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(withGap), 1200);
  assert.equal(frameHeightPx(withGap), 1200);
  assert.equal(previewPageCount(contentHeightPx(withGap)), 2);
});

test("a footer inside a boxless wrapper counts toward the preview height", () => {
  const page = { scrollHeight: 900, getBoundingClientRect: () => ({ top: 0, height: 900, width: 800 }) };
  const footer = { offsetHeight: 100, getBoundingClientRect: () => ({ top: 1100, height: 100, width: 800 }) };
  const beside = { getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }), children: [footer] };
  const siblingWrap = {
    body: {
      children: [page, beside],
      scrollHeight: 2000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(siblingWrap), 1200);
  assert.equal(frameHeightPx(siblingWrap), 1200);

  const around = {
    getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }),
    children: [page, footer],
    contains(node) { return node === page; },
  };
  const sharedWrap = {
    body: {
      children: [around],
      scrollHeight: 2000,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(sharedWrap), 1200);
  assert.equal(frameHeightPx(sharedWrap), 1200);
  assert.equal(previewPageCount(contentHeightPx(sharedWrap)), 2);
});

test("a document without .page uses the bottom of the rendered content", () => {
  const block = { offsetHeight: 1000, getBoundingClientRect: () => ({ top: 20, height: 1000, width: 800 }) };
  const wrap = { getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }), children: [block] };
  const one = {
    body: {
      children: [wrap],
      scrollHeight: 1000,
      offsetHeight: 1000,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
  assert.equal(contentHeightPx(one), 1020);
  assert.equal(frameHeightPx(one), 1020);

  const bare = {
    body: {
      scrollHeight: 400,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
  assert.equal(contentHeightPx(bare), 400);
  assert.equal(frameHeightPx(bare), 400);
});

test("a header inside a boxless wrapper counts toward the preview height", () => {
  const header = { getBoundingClientRect: () => ({ top: 0, height: 200, width: 800 }) };
  const wrap = { getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }), children: [header] };
  const page = { scrollHeight: 900, getBoundingClientRect: () => ({ top: 200, height: 900, width: 800 }) };
  const one = {
    body: {
      children: [wrap, page],
      scrollHeight: 1100,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(one), 1100);
  assert.equal(frameHeightPx(one), 1100);
  assert.equal(previewPageCount(contentHeightPx(one)), 2);
});

test("a hidden element before the page does not add a page", () => {
  const hidden = { getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }) };
  const page = { scrollHeight: 1050, getBoundingClientRect: () => ({ top: 8, height: 1050, width: 800 }) };
  const one = {
    body: {
      children: [hidden, page],
      scrollHeight: 1050,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(one), 1050);
  assert.equal(frameHeightPx(one), 1058);
  assert.equal(previewPageCount(contentHeightPx(one)), 1);
});

test("a page border counts in the one-page estimate", () => {
  const page = { scrollHeight: 1050, getBoundingClientRect: () => ({ top: 0, height: 1058, width: 800 }) };
  const one = {
    body: {
      children: [page],
      scrollHeight: 1050,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(one), 1058);
  assert.equal(frameHeightPx(one), 1058);
  assert.equal(previewPageCount(contentHeightPx(one)), 2);
});

test("a visibility:hidden box does not add a preview page", () => {
  const view = { getComputedStyle: (el) => ({ visibility: el.visibility || "visible" }) };
  const box = (top, height, visibility, children) => ({
    visibility,
    children,
    ownerDocument: { defaultView: view },
    getBoundingClientRect: () => ({ top, height, width: 800 }),
  });
  const page = { ...box(200, 900, "visible"), scrollHeight: 900 };
  const hiddenAbove = {
    body: {
      children: [box(0, 200, "hidden"), page],
      scrollHeight: 1100,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(hiddenAbove), 900);
  assert.equal(previewPageCount(contentHeightPx(hiddenAbove)), 1);

  const shownInside = box(0, 80, "visible");
  const hiddenParent = box(0, 200, "hidden", [shownInside]);
  const visibleChild = {
    body: {
      children: [hiddenParent, page],
      scrollHeight: 1100,
      querySelector: () => page,
      querySelectorAll: () => [page],
    },
  };
  assert.equal(contentHeightPx(visibleChild), 1100);
  assert.equal(previewPageCount(contentHeightPx(visibleChild)), 2);

  const pageAtTop = { ...box(0, 900, "visible"), scrollHeight: 900 };
  const hiddenFooter = {
    body: {
      children: [pageAtTop, box(900, 200, "hidden")],
      scrollHeight: 1100,
      querySelector: () => pageAtTop,
      querySelectorAll: () => [pageAtTop],
    },
  };
  assert.equal(contentHeightPx(hiddenFooter), 900);
  assert.equal(previewPageCount(contentHeightPx(hiddenFooter)), 1);

  const shownFooter = box(900, 200, "visible");
  const hiddenWrap = box(900, 200, "hidden", [shownFooter]);
  const visibleFooter = {
    body: {
      children: [pageAtTop, hiddenWrap],
      scrollHeight: 1100,
      querySelector: () => pageAtTop,
      querySelectorAll: () => [pageAtTop],
    },
  };
  assert.equal(contentHeightPx(visibleFooter), 1100);
  assert.equal(previewPageCount(contentHeightPx(visibleFooter)), 2);
});

test("a display:none page does not stretch the visible page", () => {
  const hidden = {
    getBoundingClientRect: () => ({ top: 0, height: 0, width: 0 }),
    scrollHeight: 0,
    offsetHeight: 0,
  };
  const visible = {
    getBoundingClientRect: () => ({ top: 200, height: 900, width: 800 }),
    scrollHeight: 900,
  };
  const doc = {
    body: {
      children: [hidden, visible],
      scrollHeight: 1100,
      querySelector: () => visible,
      querySelectorAll: () => [hidden, visible],
    },
  };
  assert.equal(contentHeightPx(doc), 900);
  assert.equal(previewPageCount(contentHeightPx(doc)), 1);
});

test("an unmeasured preview estimates one page", () => {
  assert.equal(contentHeightPx(null), 0);
  assert.equal(previewPageCount(0), 1);
});
