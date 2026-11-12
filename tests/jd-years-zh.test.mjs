// tests/jd-years-zh.test.mjs — the years-of-experience parser (jd-years.mjs)
// on a JD written in Chinese.
//
// "5年以上后端开发经验" states the same bar as "5+ years of backend
// experience", and the parser returned "none stated" for it, so the experience
// filter kept every posting from a Chinese board with a label that said the JD
// named no bar.
//
// The rule of the module is unchanged: a figure counts only when it is about
// the candidate's experience, and an unclear reading keeps the posting.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { parseYearsRequirement, classifyYears } from '../jd-years.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

console.log('\njd-years — years of experience stated in Chinese');

// [JD text, status, gating min, max, confident, display]
const CASES = [
  // Each Chinese line is followed by the English line it must read like.
  ['任职要求：5年以上后端开发经验。', 'stated', 5, null, true, '5+'],
  ['Requirements: 5+ years of backend development experience.', 'stated', 5, null, true, '5+'],
  ['任职要求：3-5年工作经验', 'stated', 3, 5, true, '3-5'],
  ['Requirements: 3-5 years of work experience', 'stated', 3, 5, true, '3-5'],
  ['五年以上工作经验', 'stated', 5, null, true, '5+'],
  ['Five or more years of work experience', 'stated', 5, null, true, '5+'],
  ['至少3年相关工作经验', 'stated', 3, null, true, '3+'],
  ['At least 3 years of relevant work experience', 'stated', 3, null, true, '3+'],
  // Other spellings of a floor
  ['3年+ 开发经验', 'stated', 3, null, true, '3+'],
  ['3+年开发经验', 'stated', 3, null, true, '3+'],
  ['5年及以上互联网产品经验', 'stated', 5, null, true, '5+'],
  ['3年（含）以上相关经验', 'stated', 3, null, true, '3+'],
  ['不少于5年开发经验', 'stated', 5, null, true, '5+'],
  ['十年以上经验', 'stated', 10, null, true, '10+'],
  ['任职要求：五年以上经验', 'stated', 5, null, true, '5+'],
  ['团队希望候选人拥有10年经验', 'stated', 10, null, true, '10+'],
  ['合同管理5年以上工作经验', 'stated', 5, null, true, '5+'],
  ['十五年以上从业经验', 'stated', 15, null, true, '15+'],
  ['两年以上工作经验', 'stated', 2, null, true, '2+'],
  ['2.5年以上工作经验', 'stated', 2.5, null, true, '2.5+'],
  ['5年后端开发经验', 'stated', 5, null, true, '5+'],
  ['工作年限：3年以上', 'stated', 3, null, true, '3+'],
  ['5年以上後端開發經驗', 'stated', 5, null, true, '5+'],
  // Ranges count by their floor
  ['工作经验：三到五年', 'stated', 3, 5, true, '3-5'],
  ['3～5年相关经验', 'stated', 3, 5, true, '3-5'],
  ['1至3年工作经验', 'stated', 1, 3, true, '1-3'],
  // "、" lists skills inside one clause; the comma ends it
  ['3年以上Java、Go开发经验，熟悉MySQL', 'stated', 3, null, true, '3+'],
  // The years clause is required; the clause after it carries its own cue
  ['3年以上经验，有大厂背景者优先', 'stated', 3, null, true, '3+'],
  // Preferred
  ['有3年以上工作经验者优先', 'preferred-only', null, null, false, 'pref 3+'],
  ['有3年以上工作经验的，优先考虑', 'preferred-only', null, null, false, 'pref 3+'],
  ['加分项：5年以上大厂经验', 'preferred-only', null, null, false, 'pref 5+'],
  // Years instead of a degree bind only candidates without it
  ['本科学历或5年以上工作经验', 'none', null, null, false, 'none stated'],
  ['本科及以上学历，5年以上工作经验', 'stated', 5, null, true, '5+'],
  // Degree-conditional bars: the lowest gates
  ['本科5年以上工作经验，硕士3年以上', 'stated', 3, null, true, '3/5+ by degree'],
  // "including N years" is part of the bar before it
  ['5年以上工作经验，其中2年以上团队管理经验', 'stated', 5, null, true, '5+'],
  // Sections
  ['任职要求：\n- 熟悉 Go 语言\n- 3年以上后端开发经验\n加分项：\n- 5年以上大厂经验', 'stated', 3, null, true, '3+'],
  ['加分项：\n- 5年以上大厂经验', 'preferred-only', null, null, false, 'pref 5+'],
  // Under a heading the parser does not know, the bar shows but cannot drop
  ['岗位职责：\n- 负责后端服务\n- 5年以上经验', 'stated', 5, null, false, '5+'],
  // ... unless the sentence itself says it is required
  ['岗位职责：\n- 要求5年以上经验', 'stated', 5, null, true, '5+'],
];

for (const [jd, status, min, max, confident, display] of CASES) {
  ok(`${JSON.stringify(jd)} -> ${display}`, () => {
    const r = parseYearsRequirement(jd);
    assert.deepStrictEqual(
      { status: r.status, min: r.min, max: r.max, confident: r.confident, display: r.display },
      { status, min, max, confident, display },
    );
  });
}

console.log('\njd-years — Chinese figures that are not a years requirement');

const NOT_A_BAR = [
  '公司成立5年，团队经验丰富。',          // the company's age
  '公司成立10年以上，拥有丰富的行业经验',
  '我们团队拥有10年行业经验',             // the team's experience
  '团队成员平均8年经验',
  '团队拥有10年以上行业经验',
  '5年内有相关经验',                      // a time window
  '近3年有互联网行业经验',
  '过去五年的项目经验',
  '5年以下工作经验',                      // a ceiling
  '不超过5年工作经验',
  '工作经验5年以内',
  '2021年3月起有开发经验',                // a calendar year
  '大学3年级以上，有实习经验',            // a school year
  '合同期3年，经验丰富者优先',            // a contract term
  '合同期5年以上，要求有相关工作经验。',
  '服务期不少于3年，有相关经验者优先',
  '合同期限为3年以上，需有相关经验',
  '3年制大专及以上学历，有相关经验',
  '年薪30万，五险一金，经验不限',
  '35岁以下，有销售经验',
  '5年以上',                              // experience is never named
  '3-5年',
];

for (const jd of NOT_A_BAR) {
  ok(`${JSON.stringify(jd)} states no bar`, () => {
    const r = parseYearsRequirement(jd);
    assert.strictEqual(r.status, 'none');
    assert.strictEqual(r.display, 'none stated');
    assert.deepStrictEqual(r.mentions, []);
  });
}

console.log('\njd-years — Chinese bars and the band');

ok('a Chinese bar above the band drops only when it is a clear requirement', () => {
  const band = { years: 2, stretchYears: 1 };
  assert.strictEqual(classifyYears(parseYearsRequirement('任职要求：\n- 8年以上后端开发经验'), band), 'out');
  assert.strictEqual(classifyYears(parseYearsRequirement('任职要求：\n- 3年以上后端开发经验'), band), 'in');
  assert.strictEqual(classifyYears(parseYearsRequirement('有8年以上经验者优先'), band), 'unknown');
  assert.strictEqual(classifyYears(parseYearsRequirement('岗位职责：\n- 8年以上经验'), band), 'unknown');
  assert.strictEqual(classifyYears(parseYearsRequirement('公司成立8年，团队经验丰富'), band), 'unknown');
});

ok('a short Chinese item is not read as a heading', () => {
  // Chinese has no spaces, so every item is "one word" to a word count.
  const r = parseYearsRequirement('Requirements:\n- 熟悉 Go 语言\n- 5+ years of experience');
  assert.strictEqual(r.confident, true);
  assert.strictEqual(r.mentions[0].kind, 'required');
});

ok('a mixed JD keeps both readings', () => {
  const r = parseYearsRequirement('Requirements:\n- 5+ years of experience in backend development\n任职要求：\n- 3年以上后端开发经验');
  assert.deepStrictEqual(r.mentions.map(m => m.floor), [5, 3]);
  assert.strictEqual(r.min, 3);
});
