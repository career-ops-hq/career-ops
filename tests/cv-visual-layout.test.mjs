import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPdfLayout, missingAtsWords, parsePdfLayout } from './cv-visual/layout.mjs';

const word = (text, xMin = 40, yMin = 40, xMax = 180, yMax = yMin + 12) => ({ text, xMin, yMin, xMax, yMax });
const page = (...words) => ({ width: 595, height: 842, words });
const pair = { heading: 'Work experience', body: 'Example Organization' };

test('PDF layout parses Poppler coordinates and XML-escaped bilingual text', () => {
  const pages = parsePdfLayout(`<?xml version="1.0"?>
    <html><body><doc><page width="595.28" height="841.89"><flow><block><line>
      <word xMin="43.2" yMin="55.1" xMax="100.3" yMax="67.4">R&amp;D</word>
      <word xMin="101" yMin="55.1" xMax="150" yMax="67.4">&#x5de5;&#20316;</word>
    </line></block></flow></page></doc></body></html>`);
  assert.equal(pages[0].width, 595.28);
  assert.deepEqual(pages[0].words.map(({ text }) => text), ['R&D', '工作']);
  assert.equal(pages[0].words[0].xMin, 43.2);
  assert.throws(() => parsePdfLayout('<page width="no" height="842"></page>'), /Invalid PDF width/);
  assert.throws(() => parsePdfLayout('<html></html>'), /No pages/);
});

test('PDF clipping checks every page and all four edges, with rounding tolerance', () => {
  const result = inspectPdfLayout([
    page(word('valid', -0.5, 40, 100), word('right', 500, 50, 598), word('bottom', 40, 839, 180, 849)),
    page(word('left', -3), word('top', 40, -2)),
  ], []);
  assert.deepEqual(result.clipped, [
    { page: 1, text: 'right' }, { page: 1, text: 'bottom' },
    { page: 2, text: 'left' }, { page: 2, text: 'top' },
  ]);
});

test('PDF orphan gate sees an actual page break despite any CSS avoid declaration', () => {
  const result = inspectPdfLayout([
    page(word('WORK EXPERIENCE', 40, 800)), page(word('Example Organization')),
  ], [pair]);
  assert.deepEqual(result.orphanHeadings, [{ heading: pair.heading, headingPage: 1, bodyPage: 2 }]);
  assert.deepEqual(result.missingText, []);
});

test('a duplicate body earlier on the heading page cannot hide an orphan', () => {
  const result = inspectPdfLayout([
    page(word('Example Organization'), word('WORK EXPERIENCE', 40, 800)),
    page(word('Example Organization')),
  ], [pair]);
  assert.equal(result.orphanHeadings.length, 1);
});

test('a rail heading may align with its body even when PDF extraction places the body first', () => {
  const result = inspectPdfLayout([
    page(word('Example Organization', 150, 102), word('WORK EXPERIENCE', 40, 100)),
  ], [pair]);
  assert.deepEqual(result, { clipped: [], orphanHeadings: [], missingText: [] });
});

test('CJK word splitting, line wrapping and uppercase heading transforms are normalized', () => {
  const result = inspectPdfLayout([
    page(word('WORK'), word('EXPERIENCE', 40, 54), word('Example'), word('Organization', 100),
      word('技术'), word('能力', 75), word('工具'), word('甲', 80)),
  ], [pair, { heading: '技术能力', body: '工具甲' }]);
  assert.deepEqual(result, { clipped: [], orphanHeadings: [], missingText: [] });
});

test('a paragraph can continue on the next page once it starts below its heading', () => {
  const result = inspectPdfLayout([
    page(word('SUMMARY', 40, 770), word('First line', 40, 790)),
    page(word('continues here')),
  ], [{ heading: 'Summary', body: 'First line continues here' }]);
  assert.deepEqual(result, { clipped: [], orphanHeadings: [], missingText: [] });
});

test('missing PDF heading or body fails explicitly instead of passing an empty match', () => {
  const missingHeading = inspectPdfLayout([page(word('Unrelated'))], [pair]);
  assert.deepEqual(missingHeading.missingText, [`Heading: ${pair.heading}`]);
  const missingBody = inspectPdfLayout([page(word('WORK EXPERIENCE'))], [pair]);
  assert.deepEqual(missingBody.missingText, [`Body after ${pair.heading}: ${pair.body}`]);
});


test('ATS extraction must retain Latin words even in mixed Chinese text', () => {
  const values = ['TypeScript Service Development', '中文工具 PostgreSQL'];
  assert.deepEqual(missingAtsWords('TypeScript Service\nDevelopment 中 文 工 具 PostgreSQL', values), []);
  assert.deepEqual(missingAtsWords('Type Script Service Development 中 文 工 具 Post greSQL', values), ['typescript', 'postgresql']);
});
