import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { injectThemeStyle, readStyleTokens } from '../theme-style.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = join(ROOT, 'templates', 'cv-template.zh-minimal.html');
const FONT_SURFACES = [
  'body', '.header h1', '.contact-row', '.section-title', '.competency-tag',
  '.job-company', '.job li', '.project-title', '.edu-org', '.skill-category',
];
const BODY_SURFACES = [
  'body', '.contact-row', '.summary-text', '.competency-tag', '.job-role',
  '.job li', '.project-desc', '.edu-title', '.cert-title', '.award-title', '.skill-item',
];

test('Chinese Minimal applies profile typography and colors without changing its defaults', {
  skip: !existsSync(chromium.executablePath()) && 'Chromium is not installed',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zh-minimal-theme-'));
  let browser;
  try {
    const input = join(dir, 'payload.json');
    const output = join(dir, 'cv.html');
    const profile = join(dir, 'profile.yml');
    writeFileSync(input, JSON.stringify({
      lang: 'zh-CN', page_format: 'a4',
      candidate: { name: '测试候选人', email: 'candidate@example.com', location: '中国｜杭州' },
      summary: 'Engineer building reliable tools.', competencies: ['TypeScript'],
      experience: [{ company: 'Example Company', role: 'Engineer', dates: '2025 - Present', bullets: ['Shipped reliable tools.'] }],
      projects: [{ name: 'Example Project', badge: 'Open source', tech: 'Node.js', description: 'A useful tool.' }],
      education: [{ title: 'Computer Science', org: 'Example University', year: '2024' }],
      certifications: [{ title: 'Example Certificate', org: 'Example Institute', year: '2024' }],
      awards: [{ title: 'Example Award', org: 'Example Foundation', year: '2024' }],
      skills: [{ category: 'Engineering', items: ['TypeScript'] }],
    }));
    execFileSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT });
    const html = readFileSync(output, 'utf8');
    writeFileSync(profile, 'style:\n  font_family: "Georgia, serif"\n  font_size: "10pt"\n  accent_color: "#2563eb"\n  secondary_color: "#111827"\n');
    const tokens = readStyleTokens(profile);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });

    const readStyles = async () => page.evaluate(({ fontSurfaces, bodySurfaces }) => {
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        fonts: Object.fromEntries(fontSurfaces.map((selector) => [selector, style(selector).fontFamily])),
        sizes: Object.fromEntries(bodySurfaces.map((selector) => [selector, style(selector).fontSize])),
        colors: Object.fromEntries([
          '.section-title', '.job-company', '.job-role', '.project-title', '.project-badge', '.edu-org', '.cert-org', '.award-org',
        ].map((selector) => [selector, style(selector).color])),
        headingSize: style('.header h1').fontSize,
        chipBackground: style('.competency-tag').backgroundColor,
      };
    }, { fontSurfaces: FONT_SURFACES, bodySurfaces: BODY_SURFACES });

    await page.setContent(html);
    const defaults = await readStyles();
    assert.equal(defaults.sizes.body, '11px');
    assert.equal(defaults.sizes['.job li'], '10.5px');
    assert.equal(defaults.headingSize, '27px');
    assert.equal(defaults.colors['.section-title'], 'rgb(23, 32, 51)');
    assert.equal(defaults.colors['.job-company'], 'rgb(23, 32, 51)');
    assert.equal(defaults.colors['.job-role'], 'rgb(23, 74, 126)');
    assert.equal(defaults.colors['.edu-org'], 'rgb(23, 74, 126)');
    assert.equal(defaults.colors['.award-org'], 'rgb(115, 34, 195)');
    assert.match(defaults.fonts.body, /^"Liberation Sans"/);
    assert.match(defaults.fonts.body, /"PingFang SC"/);

    for (const [lang, fallback] of [
      ['en', 'PingFang SC'], ['zh', 'PingFang SC'], ['zh-CN', 'PingFang SC'],
      ['zh-TW', 'PingFang TC'], ['ja', 'Hiragino Sans'], ['ar', 'Tahoma'],
    ]) {
      const localized = html.replace('<html lang="zh-CN">', `<html lang="${lang}">`);
      await page.setContent(injectThemeStyle(localized, tokens));
      const custom = await readStyles();
      for (const [selector, font] of Object.entries(custom.fonts)) {
        assert.match(font, /^Georgia, serif,/, `${lang}: ${selector} should honor the selected font`);
      }
      assert.ok(custom.fonts.body.includes(fallback), `${lang}: keep the locale's fallback faces`);
      for (const [selector, size] of Object.entries(custom.sizes)) {
        assert.ok(Math.abs(parseFloat(size) - 40 / 3) < 0.001, `${lang}: ${selector} should use 10pt`);
      }
      for (const selector of ['.section-title', '.job-role', '.project-badge']) {
        assert.equal(custom.colors[selector], 'rgb(37, 99, 235)', `${lang}: ${selector} should use the accent`);
      }
      for (const selector of ['.job-company', '.project-title', '.edu-org', '.cert-org', '.award-org']) {
        assert.equal(custom.colors[selector], 'rgb(17, 24, 39)', `${lang}: ${selector} should use the secondary color`);
      }
      assert.equal(custom.headingSize, defaults.headingSize);
      assert.equal(custom.chipBackground, defaults.chipBackground);
    }

    // A partial profile must not change unrelated defaults.
    await page.setContent(injectThemeStyle(html, { '--font-size': '10pt' }));
    const sizeOnly = await readStyles();
    assert.deepEqual(sizeOnly.fonts, defaults.fonts);
    assert.deepEqual(sizeOnly.colors, defaults.colors);
    await page.setContent(injectThemeStyle(html, {}));
    assert.deepEqual(await readStyles(), defaults);
  } finally {
    if (browser) await browser.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
