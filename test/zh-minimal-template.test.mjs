import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTemplates, resolveTemplate, validateTemplate } from '../cv-templates.mjs';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'templates', 'cv-template.zh-minimal.html');
const HAS_PDFTOTEXT = spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).status === 0;

test('Chinese Minimal template is discoverable and valid', () => {
  const listed = listTemplates('cv');
  const entry = listed.find((item) => item.name === 'zh-minimal');
  assert.equal(entry?.displayName, 'Chinese Minimal');
  assert.equal(resolveTemplate('cv', 'zh-minimal'), TEMPLATE);
  assert.deepEqual(validateTemplate(TEMPLATE, 'cv'), { ok: true, missing: [] });
});

test('Chinese Minimal uses one restrained accent and removes chip styling', () => {
  const html = readFileSync(TEMPLATE, 'utf8');
  assert.match(html, /--zhm-accent:\s*#174a7e/);
  assert.match(html, /\.header-gradient\s*\{[^}]*height:\s*1px[^}]*background:\s*var\(--zhm-ink\)/s);
  assert.match(html, /\.competency-tag\s*\{[^}]*background:\s*none[^}]*border:\s*0/s);
  assert.doesNotMatch(html.slice(html.indexOf('CHINESE MINIMAL DESIGN')), /hsl\(270/);
});

test('Chinese Minimal renders a complete mixed-language payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zh-minimal-'));
  const input = join(dir, 'cv.json');
  const output = join(dir, 'cv.html');
  writeFileSync(input, JSON.stringify({
    lang: 'zh-CN',
    page_format: 'a4',
    candidate: { name: '测试候选人', email: 'candidate@example.com', location: '中国｜杭州' },
    sections: {
      summary: '个人简介', competencies: '核心能力', experience: '工作经历',
      projects: '精选项目', education: '教育经历', certifications: '认证', skills: '技术栈',
    },
    summary: '全栈工程师，负责 AI Agent 工作流与生产部署。',
    competencies: ['AI Agent 工作流', '后端 API 工程', '生产部署'],
    experience: [{
      company: '示例科技有限公司', role: '全栈开发工程师', dates: '2025.01 至今',
      bullets: ['交付 React、FastAPI 与数据库组成的生产系统。'],
    }],
    projects: [{ name: '开源自动化项目', badge: '开源', tech: 'Node.js · Playwright', description: '构建可验证的自动化流程。' }],
    education: [{ title: '计算机科学与技术', org: '示例大学', year: '2025' }],
    certifications: [],
    skills: [{ category: '工程能力', items: ['TypeScript', 'FastAPI', 'Docker'] }],
  }));

  execFileSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT });
  const rendered = readFileSync(output, 'utf8');
  assert.match(rendered, /<html lang="zh-CN">/);
  assert.match(rendered, /测试候选人/);
  assert.match(rendered, /AI Agent 工作流/);
  assert.doesNotMatch(rendered, /Certifications/);
  assert.doesNotMatch(rendered, /\{\{[A-Z_]+\}\}/);
});

test('Chinese Minimal preserves mixed-language and job order in PDF text extraction', {
  skip: (!existsSync(chromium.executablePath()) || !HAS_PDFTOTEXT)
    && 'Chromium or pdftotext is not installed',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zh-minimal-extraction-'));
  const input = join(dir, 'cv.json');
  const output = join(dir, 'cv.html');
  const pdf = join(dir, 'cv.pdf');
  writeFileSync(input, JSON.stringify({
    lang: 'zh-CN',
    page_format: 'a4',
    candidate: { name: '测试候选人', email: 'candidate@example.com', location: '深圳' },
    sections: {
      summary: '职业概述', competencies: '核心能力', experience: '工作经历',
      projects: '项目', education: '教育背景', certifications: '认证', skills: '技能',
    },
    summary: '6 年企业数字化经验，服务 ACME、Globex、Initech、Umbrella、Hooli、Vandelay。',
    competencies: ['项目交付'],
    experience: [
      {
        company: '示例甲公司', role: '产品经理', dates: '2025 至今',
        bullets: ['交付 AI agent 产品。'],
      },
      {
        company: '示例乙公司', role: '客户经理', dates: '2022 - 2024',
        bullets: ['主导 CRM 项目。'],
      },
    ],
    projects: [],
    education: [{ title: '管理学硕士', org: '示例大学', year: '2021' }],
    certifications: [],
    skills: [{ category: '工具', items: ['CRM', 'AI agent'] }],
  }));
  execFileSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(output).href);
    await page.pdf({
      path: pdf,
      format: 'A4',
      printBackground: true,
      margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
    });
  } finally {
    await browser.close();
  }

  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })
    .replace(/\s+/g, ' ')
    .trim();
  assert.match(text, /6 年.*ACME.*Globex.*Initech.*Umbrella.*Hooli.*Vandelay/);
  assert.match(text,
    /示例甲公司 2025 至今.*产品经理.*交付 AI agent 产品.*示例乙公司 2022 - 2024.*客户经理.*主导 CRM 项目/);
  assert.doesNotMatch(text, /Certifications/);
});

test('Chinese Minimal keeps long mixed-language contacts inside the A4 page', {
  skip: !existsSync(chromium.executablePath()) && 'Chromium is not installed',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zh-minimal-layout-'));
  const input = join(dir, 'cv.json');
  const output = join(dir, 'cv.html');
  writeFileSync(input, JSON.stringify({
    lang: 'zh-CN', page_format: 'a4',
    candidate: {
      name: '测试候选人',
      email: 'candidate-with-an-intentionally-long-address-for-print-regression@example-company.cn',
      location: '中国｜杭州',
      portfolio: 'https://example.com/一个很长的中英文混合项目地址/remote-agent-production-delivery',
    },
    summary: '全栈工程师，负责 AI Agent 工作流与生产部署。',
    competencies: ['AI Agent 工作流'],
    experience: [{ company: '示例科技有限公司', role: '工程师', dates: '2025 至今', bullets: ['交付生产系统。'] }],
    projects: [], education: [], certifications: [], skills: [],
  }));
  execFileSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.emulateMedia({ media: 'print' });
    await page.goto(pathToFileURL(output).href);
    const layout = await page.evaluate(() => {
      const printable = document.querySelector('.page');
      const right = printable.getBoundingClientRect().right;
      const overflow = [...printable.querySelectorAll('*')]
        .filter((element) => element.getBoundingClientRect().right > right + 0.5)
        .map((element) => element.className || element.tagName);
      return { documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, overflow };
    });
    assert.equal(layout.documentOverflow, false);
    assert.deepEqual(layout.overflow, []);
  } finally {
    await browser.close();
  }
});
