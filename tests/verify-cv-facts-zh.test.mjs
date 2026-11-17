// tests/verify-cv-facts-zh.test.mjs — verify-cv-facts.mjs on a Simplified
// Chinese CV checked against a Simplified Chinese cv.md (#6941).
//
// Three edits the gate blocks in an English CV passed in the Chinese one:
// a raised count ("8年" for "5年"), a changed start date ("2019年3月 - 至今"
// for "2021年3月 - 至今") and a tool added to a list ("使用 Go、Kafka 和
// Elasticsearch"). Each case below runs the Chinese CV and the English CV
// that says the same thing, and expects the same verdict.
//
// All names and figures are synthetic.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyFacts, metricClaims, factClaims, diagnoseCoverage } from '../verify-cv-facts.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const ZH_SOURCE = `# 张三

## 工作经历

### 示例科技
**后端工程师**
2021年3月 - 至今

- 拥有5年后端开发经验，带领12人团队。
- 接口日均调用300万次，查询速度提升2倍。
- 参与了计费系统迁移。
- 使用 Go 和 Kafka 搭建消息管道。

## 技能

熟悉分布式系统。
`;

const EN_SOURCE = `# Zhang San

## Experience

### Example Tech
**Backend Engineer**
Mar 2021 - Present

- 5 years of backend experience, leading a team of 12 engineers.
- The API serves 3 million requests a day, and queries run 2x faster.
- Contributed to the billing system migration.
- Built the message pipeline using Go and Kafka.

## Skills

Familiar with distributed systems.
`;

const cv = (company, role, period, bullets) => `<html><body><div class="job"><span class="job-company">${company}</span><span class="job-role">${role}</span><span class="job-period">${period}</span><ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul></div></body></html>`;

const ZH_BULLETS = ['拥有5年后端开发经验，带领12人团队。', '接口日均调用300万次，查询速度提升2倍。', '参与了计费系统迁移。', '使用 Go 和 Kafka 搭建消息管道。'];
const EN_BULLETS = ['5 years of backend experience, leading a team of 12 engineers.', 'The API serves 3 million requests a day, and queries run 2x faster.', 'Contributed to the billing system migration.', 'Built the message pipeline using Go and Kafka.'];
const zhCv = ({ period = '2021年3月 - 至今', bullets = ZH_BULLETS } = {}) => cv('示例科技', '后端工程师', period, bullets);
const enCv = ({ period = 'Mar 2021 - Present', bullets = EN_BULLETS } = {}) => cv('Example Tech', 'Backend Engineer', period, bullets);

const work = mkdtempSync(join(tmpdir(), 'cv-facts-zh-'));
const zhSrc = join(work, 'zh-src.md');
const enSrc = join(work, 'en-src.md');
const cfg = join(work, 'cfg.json');
writeFileSync(zhSrc, ZH_SOURCE);
writeFileSync(enSrc, EN_SOURCE);
writeFileSync(cfg, '{}');
const check = (html, source) => verifyFacts(html, { sourcePaths: [source], configPath: cfg });
const facts = result => result.unsupportedFacts.map(({ kind, value }) => `${kind}: ${value}`);

try {
  console.log('\nverify-cv-facts — a Chinese CV gets the verdict of its English twin');

  ok('the unchanged CV passes in both languages, with nothing left unchecked', () => {
    for (const result of [check(zhCv(), zhSrc), check(enCv(), enSrc)]) {
      assert.strictEqual(result.verdict, 'pass');
      assert.strictEqual(result.coverage, null);
    }
  });

  ok('raised counts block: years, team size, volume, multiplier', () => {
    const en = check(enCv({ bullets: ['8 years of backend experience, leading a team of 30 engineers.', 'The API serves 5 million requests a day, and queries run 3x faster.', ...EN_BULLETS.slice(2)] }), enSrc);
    assert.strictEqual(en.verdict, 'block');
    assert.deepStrictEqual([...en.invented].sort(), ['30 engineers', '3x', '5m requests', '8 years']);
    const zh = check(zhCv({ bullets: ['拥有8年后端开发经验，带领30人团队。', '接口日均调用500万次，查询速度提升3倍。', ...ZH_BULLETS.slice(2)] }), zhSrc);
    assert.strictEqual(zh.verdict, 'block');
    assert.deepStrictEqual([...zh.invented].sort(), ['30人', '3倍', '500万', '8年']);
  });

  ok('one raised count blocks on its own', () => {
    for (const [from, to, claim] of [['5年', '8年', '8年'], ['12人', '30人', '30人'], ['300万次', '500万次', '500万'], ['2倍', '3倍', '3倍']]) {
      const result = check(zhCv({ bullets: ZH_BULLETS.map(b => b.replace(from, to)) }), zhSrc);
      assert.deepStrictEqual(result.invented, [claim], `${from} -> ${to}`);
    }
  });

  ok('a changed start year blocks as employment-dates', () => {
    const en = check(enCv({ period: 'Mar 2019 - Present' }), enSrc);
    assert.deepStrictEqual(facts(en), ['employment-dates: example tech: mar 2019 - present']);
    const zh = check(zhCv({ period: '2019年3月 - 至今' }), zhSrc);
    assert.strictEqual(zh.verdict, 'block');
    assert.deepStrictEqual(facts(zh), ['employment-dates: 示例科技: 2019年3月 - 至今']);
  });

  ok('Chinese date spellings compare by value', () => {
    // Same dates, written another way: still supported.
    for (const period of ['2021年3月至今', '2021年03月 - 现在', '2021年3月 — 至今', '2021年 - 至今', '2021年至今', '2021年3月到现在', '2021年3月至目前', '2021年3月～至今']) {
      assert.strictEqual(check(zhCv({ period }), zhSrc).verdict, 'pass', period);
    }
    // A different month, a different year, or an end date the source does not have.
    for (const period of ['2021年5月 - 至今', '2020年至今', '2019年3月到现在', '2021年3月 - 2023年6月', '2021年3月至2023年6月']) {
      assert.deepStrictEqual(facts(check(zhCv({ period }), zhSrc)), [`employment-dates: 示例科技: ${period}`], period);
    }
  });

  ok('a closed Chinese date range is read at both ends', () => {
    const src = join(work, 'zh-closed.md');
    writeFileSync(src, ZH_SOURCE.replace('2021年3月 - 至今', '2019年7月至2023年6月'));
    assert.strictEqual(check(zhCv({ period: '2019年7月 - 2023年6月' }), src).verdict, 'pass');
    assert.strictEqual(check(zhCv({ period: 'Jul 2019 - Jun 2023' }), src).verdict, 'pass');
    assert.deepStrictEqual(facts(check(zhCv({ period: '2019年7月 - 2024年6月' }), src)), ['employment-dates: 示例科技: 2019年7月 - 2024年6月']);
  });

  ok('a tool added to a 使用 list blocks', () => {
    const en = check(enCv({ bullets: [...EN_BULLETS.slice(0, 3), 'Built the message pipeline using Go, Kafka and Elasticsearch.'] }), enSrc);
    assert.deepStrictEqual(facts(en), ['tool: elasticsearch']);
    const zh = check(zhCv({ bullets: [...ZH_BULLETS.slice(0, 3), '使用 Go、Kafka 和 Elasticsearch 搭建消息管道。'] }), zhSrc);
    assert.strictEqual(zh.verdict, 'block');
    assert.deepStrictEqual(facts(zh), ['tool: elasticsearch']);
  });

  ok('a tool list written without spaces is found in a source written the same way', () => {
    const src = join(work, 'zh-unspaced.md');
    writeFileSync(src, ZH_SOURCE.replace('使用 Go 和 Kafka 搭建消息管道。', '使用Go和Kafka搭建消息管道。'));
    const bullets = same => [...ZH_BULLETS.slice(0, 3), same];
    assert.strictEqual(check(zhCv({ bullets: bullets('使用Go和Kafka搭建消息管道。') }), src).verdict, 'pass');
    assert.strictEqual(check(zhCv({ bullets: bullets('基于Kafka与Go搭建消息管道。') }), src).verdict, 'pass');
    assert.deepStrictEqual(facts(check(zhCv({ bullets: bullets('使用Go、Kafka和Elasticsearch搭建消息管道。') }), src)), ['tool: elasticsearch']);
    // A longer name in the source does not vouch for a shorter one.
    writeFileSync(src, ZH_SOURCE.replace('使用 Go 和 Kafka 搭建消息管道。', '使用Golang和Kafka搭建消息管道。'));
    assert.deepStrictEqual(facts(check(zhCv({ bullets: bullets('使用Go和Kafka搭建消息管道。') }), src)), ['tool: go']);
  });

  console.log('\nverify-cv-facts — Chinese counts');

  const counts = text => [...metricClaims(text)].sort();
  ok('a digit run with a measure word is a claim', () => {
    assert.deepStrictEqual(counts('拥有8年后端开发经验'), ['8年']);
    assert.deepStrictEqual(counts('带领30人团队'), ['30人']);
    assert.deepStrictEqual(counts('带领 30 名工程师'), ['30人']);
    assert.deepStrictEqual(counts('管理15位成员'), ['15人']);
    assert.deepStrictEqual(counts('查询速度提升3倍'), ['3倍']);
    assert.deepStrictEqual(counts('性能提升2.5倍'), ['2.5倍']);
    assert.deepStrictEqual(counts('服务20家企业客户，上线6个月'), ['20家', '6个月']);
    assert.deepStrictEqual(counts('完成3次架构升级，获得5项专利，负责4个模块'), ['3次', '4个', '5项']);
    assert.deepStrictEqual(counts('10+年经验，团队50余人'), ['10年', '50人']);
    assert.deepStrictEqual(counts('经验达到5年，用户增长至3倍'), ['3倍', '5年']);
  });

  ok('万 and 亿 are magnitudes, and the figure is keyed without its measure word', () => {
    assert.deepStrictEqual(counts('接口日均调用500万次'), ['500万']);
    assert.deepStrictEqual(counts('日均调用量达500万'), ['500万']);
    assert.deepStrictEqual(counts('注册用户1.5亿，日活300多万'), ['1.5亿', '300万']);
    assert.deepStrictEqual(counts('覆盖2,000万用户'), ['2000万']);
    assert.deepStrictEqual(counts('GMV 超过 3 千万'), ['3千万']);
  });

  ok('a spelled number counts like its digits', () => {
    assert.deepStrictEqual(counts('拥有八年后端开发经验'), ['8年']);
    assert.deepStrictEqual(counts('十余年经验，带领二十人团队，效率提升两倍'), ['10年', '20人', '2倍']);
    assert.deepStrictEqual(counts('十五名工程师'), ['15人']);
  });

  ok('what is not a count is not a claim', () => {
    for (const text of [
      '2021年3月加入示例科技',     // a calendar year and a month
      '2019年至2023年',
      '大学3年级',
      '获得第3名',                 // an ordinal
      '3-5年经验',                 // a range
      '3至5年经验', '3到5年经验', '3~5年经验', '3–5年经验', '三至五年经验', '三到五年经验',
      '使用 Python3 与 GPT-4 开发', // digits inside a name
      '负责二次开发',              // 二次 is a word, not two times
      '一名工程师，一年后转正',    // 一 is left alone, like "one"
      '数十人团队',                // not a figure
      '两位数增长',
      '人民币结算，人工审核',
    ]) assert.deepStrictEqual(counts(text), [], text);
  });

  ok('a plan horizon is not a record', () => {
    assert.deepStrictEqual(counts('未来3年希望深耕支付领域'), []);
    assert.deepStrictEqual(counts('入职后前3个月将梳理现有系统'), []);
    assert.deepStrictEqual(counts('接下来的6个月计划完成迁移'), []);
    // The same span as a record of past work is a claim.
    assert.deepStrictEqual(counts('前3年负责支付系统'), ['3年']);
    assert.deepStrictEqual([...metricClaims('入职后前3个月将梳理现有系统', { keepPlanHorizons: true })], ['3个月']);
  });

  ok('percentages in a Chinese sentence are read as before', () => {
    assert.deepStrictEqual(counts('转化率提升60%，耗时降低3倍'), ['3倍', '60%']);
  });

  ok('an allow_metrics entry written the Chinese way is honoured', () => {
    const allow = join(work, 'allow.json');
    writeFileSync(allow, JSON.stringify({ allow_metrics: ['8年', '30人团队', '500万次', '3倍'] }));
    const html = zhCv({ bullets: ['拥有8年后端开发经验，带领30人团队。', '接口日均调用500万次，查询速度提升3倍。', ...ZH_BULLETS.slice(2)] });
    assert.strictEqual(verifyFacts(html, { sourcePaths: [zhSrc], configPath: allow }).verdict, 'pass');
  });

  ok('spaced Chinese counts are checked, so they are no longer reported as unread', () => {
    assert.strictEqual(diagnoseCoverage('拥有 8 年后端开发经验，带领 30 人团队。'), null);
    assert.deepStrictEqual(counts('拥有 8 年后端开发经验，带领 30 人团队。'), ['30人', '8年']);
    // A plan horizon was read, so it is not reported as unread either.
    assert.strictEqual(diagnoseCoverage('未来 3 个月计划完成迁移。未来 6 年希望深耕支付领域。'), null);
    // Counts in a language with no lexicon are still reported.
    assert.strictEqual(diagnoseCoverage('Gestioné 45 empleados en 3 instalaciones.')?.reason, 'no-count-claims-recognized');
  });

  console.log('\nverify-cv-facts — Chinese tool lists');

  const tools = text => factClaims(text).filter(c => c.kind === 'tool').map(c => c.value);
  ok('使用 / 基于 / 采用 / 技术栈： open a list of names', () => {
    assert.deepStrictEqual(tools('使用 Go、Kafka 和 Elasticsearch 搭建消息管道。'), ['go', 'kafka', 'elasticsearch']);
    assert.deepStrictEqual(tools('使用Go、Kafka和Elasticsearch搭建消息管道。'), ['go', 'kafka', 'elasticsearch']);
    assert.deepStrictEqual(tools('基于 Spring Boot 与 MySQL 开发订单服务'), ['spring boot', 'mysql']);
    assert.deepStrictEqual(tools('采用 React, TypeScript 及 Node.js 重构前端。'), ['react', 'typescript', 'node.js']);
    assert.deepStrictEqual(tools('技术栈：Go、gRPC、PostgreSQL 等'), ['go', 'grpc', 'postgresql']);
    assert.deepStrictEqual(tools('使用 C++ 以及 CI/CD 流水线'), ['c++', 'ci/cd']);
  });

  ok('the list ends at the first Chinese word', () => {
    assert.deepStrictEqual(tools('使用 Go 语言开发，并与 Finance 团队合作'), ['go']);
    assert.deepStrictEqual(tools('使用自研框架搭建消息管道'), []);
    assert.deepStrictEqual(tools('基于用户反馈优化 Checkout 流程'), []);
    assert.deepStrictEqual(tools('熟悉 Go 和 Kafka'), []);
  });

  ok('English tool lists are read as before', () => {
    assert.deepStrictEqual(tools('Built the message pipeline using Go, Kafka and Elasticsearch.'), ['go', 'kafka', 'elasticsearch']);
    assert.deepStrictEqual(tools('Tech stack: React, Kafka'), ['react', 'kafka']);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
