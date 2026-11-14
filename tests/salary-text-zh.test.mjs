// tests/salary-text-zh.test.mjs — parseAmount reads Chinese salary spellings.
//
// Chinese postings write "25-40K·15薪" (monthly pay and the months of pay per
// year) or "年薪 60-80 万人民币". parseAmount returned null for every one of
// them, so salary-gap.mjs listed a Chinese report's advertised pay, and a
// Chinese profile target, under "unparseable (excluded from all math)".
import { pass, fail } from './helpers.mjs';
import { parseAmount, compensationPeriod, parseAnnualCompensation } from '../providers/_salary-text.mjs';
import { reportToObservation, fold } from '../salary-gap.mjs';

console.log('\n_salary-text — Chinese salary spellings');

const assert = (cond, name) => (cond ? pass(name) : fail(name));

function expect(raw, expected) {
  const got = parseAmount(raw);
  const same = expected === null
    ? got === null
    : got !== null && got.min === expected.min && got.max === expected.max;
  same
    ? pass(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`)
    : fail(`${JSON.stringify(raw)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// Monthly pay with a stated month count is annualized by that count.
expect('25-40K·15薪', { min: 375000, max: 600000 });
expect('25-40k · 15 薪', { min: 375000, max: 600000 });
expect('月薪 30-50K·14薪', { min: 420000, max: 700000 });
expect('税前月薪 2.5万-4万，13薪', { min: 325000, max: 520000 });
expect('20-30K*16薪', { min: 320000, max: 480000 });
expect('35K·14薪', { min: 490000, max: 490000 });
expect('25,000-40,000元/月·13薪', { min: 325000, max: 520000 });

// A parenthetical is a note. It supplies the month count only when the text
// outside it states none.
expect('25-40K·15薪（13 薪 + 2 个月浮动年终奖）', { min: 375000, max: 600000 });
expect('25-40K（15薪）', { min: 375000, max: 600000 });
expect('月薪 25-40K（13 薪 + 2 个月浮动年终奖）', { min: 325000, max: 520000 });

// 年薪 is taken as written; a month count beside it changes nothing.
expect('年薪 50 万（12 薪，另有 option）', { min: 500000, max: 500000 });
expect('年薪 60-80 万人民币', { min: 600000, max: 800000 });
expect('税前年薪 40万-60万', { min: 400000, max: 600000 });
expect('年薪 50 万·14薪', { min: 500000, max: 500000 });
expect('60-80万/年', { min: 600000, max: 800000 });
expect('年薪 60～80 万元', { min: 600000, max: 800000 });
expect('年薪 60 至 80 万 RMB', { min: 600000, max: 800000 });
expect('CNY 600,000-800,000 年薪', { min: 600000, max: 800000 });
expect('年薪 100-150 萬', { min: 1000000, max: 1500000 });
expect('25-40万/年', { min: 250000, max: 400000 });
expect('300K/年', { min: 300000, max: 300000 });
expect('300K 每年', { min: 300000, max: 300000 });
expect('25-40K（年薪）', { min: 25000, max: 40000 });

// 万 with no period word is read as written, like a bare "80-90k".
expect('60-80 万人民币', { min: 600000, max: 800000 });
expect('1.5万', { min: 15000, max: 15000 });

// A monthly amount with no month count is not annualized: the multiplier is
// not in the string, the same reason "per month" stays unparseable.
expect('月薪 35k', null);
expect('base 月薪 35k 起', null);
expect('3万/月', null);
expect('每月 2-3 万', null);
expect('30K/月', null);
expect('25-40K CNY（月薪）', null);

// Not a salary figure, or not one figure.
expect('15薪', null);
expect('13 薪 + 2 个月浮动年终奖', null);
expect('50 万用户', null);
expect('服务 50 万用户，年薪面议', null);
expect('年薪面议', null);
expect('薪资面议', null);
expect('年薪 50 万起', null);
expect('税后年薪 50 万', null);
expect('25-40K·13薪或15薪', null);
expect('25-40K·3薪', null);
expect('25-40K·0薪', null);
// The whole count is read, so "115薪" is not taken as "15薪".
expect('25-40K·115薪', null);
expect('25-40K（115薪）', null);
expect('年薪 50 万（月薪约 4 万）', null);
expect('年薪 50 万，月薪 35k', null);
expect('年薪 10-15 万美元', null);
expect('年薪 50 万（12 薪，另有 option）；年薪 50 万为 package 上限，base 月薪 35k 起', null);

// Spellings without Chinese keep their meaning.
expect('25-40K', { min: 25000, max: 40000 });
expect('80-90k', { min: 80000, max: 90000 });
expect('$123,684—$254,644 USD', { min: 123684, max: 254644 });
expect('45.000,00 EUR', { min: 45000, max: 45000 });
expect('SGD 14,000–18,000 per month', null);
expect('competitive', null);

// compensationPeriod: the period of the figure parseAmount returns.
assert(compensationPeriod('年薪 60-80 万人民币') === 'annual', '年薪 is annual');
assert(compensationPeriod('25-40K·15薪') === 'annual', 'an amount with a month count is annual');
assert(compensationPeriod('月薪 35k') === 'monthly', '月薪 with no month count is monthly');
assert(compensationPeriod('3万/月') === 'monthly', '/月 is monthly');
assert(compensationPeriod('25-40K') === null, 'no period word -> null');
assert(compensationPeriod('SGD 14,000–18,000 per month') === 'monthly', 'English monthly unchanged');
assert(parseAnnualCompensation('月薪 35k') === null, 'parseAnnualCompensation rejects 月薪 with no month count');
assert(parseAnnualCompensation('25-40K·15薪 CNY')?.max === 600000, 'parseAnnualCompensation annualizes a month count');

// salary-gap: report extraction and the profile target.
const report = (comp) => `# Report\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: Acme\nrole: Engineer\nadvertised_comp: "${comp}"\n\`\`\`\n`;
const obs = (comp) => reportToObservation(report(comp), '001', '2026-07-01').observation;

assert(obs('25-40K·15薪').parsed?.mid === 487500 && obs('25-40K·15薪').period === 'annual',
  'report: 25-40K·15薪 is parsed as an annual figure');
assert(obs('25-40K·15薪').currency === 'UNKNOWN', 'report: no currency named -> UNKNOWN, CNY is not assumed');
assert(obs('年薪 60-80 万元').currency === 'UNKNOWN', 'report: a bare 元 -> UNKNOWN');
assert(obs('年薪 60-80 万人民币').currency === 'CNY', 'report: 人民币 -> CNY');
assert(obs('年薪 60-80 万 RMB').currency === 'CNY', 'report: RMB -> CNY');
assert(obs('年薪 60-80 万 CNY').currency === 'CNY', 'report: CNY -> CNY');
assert(obs('USD 60-80 万人民币').currency === 'UNKNOWN', 'report: a code that contradicts 人民币 -> UNKNOWN');
assert(obs('CNY 60-80 万人民币').currency === 'CNY', 'report: CNY beside 人民币 -> CNY');
assert(obs('80-90k USD').currency === 'USD' && obs('80-90k').currency === 'UNKNOWN', 'report: other currencies unchanged');

const folded = fold([obs('25-40K·15薪 CNY')], { 1: { company: 'Acme', role: 'Engineer' } },
  { amount: '年薪 60-80 万人民币', currency: 'CNY' });
const app = folded.applications.find((a) => a.num === '1');
assert(app?.advertised?.value === 487500 && app.advertised.currency === 'CNY', 'fold: advertised 25-40K·15薪 CNY -> 487,500 CNY');
assert(app?.desired?.value === 700000, 'fold: profile target 年薪 60-80 万人民币 -> 700,000');
assert(folded.quality.unparseable.length === 0, 'fold: nothing reported as unparseable');

const unread = fold([obs('base 月薪 35k 起')], { 1: { company: 'Acme', role: 'Engineer' } }, null);
assert(unread.quality.unparseable.length === 1 && unread.quality.unparseable[0].raw === 'base 月薪 35k 起',
  'fold: a monthly amount with no month count is still reported as unparseable');
