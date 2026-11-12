// A Chinese or Japanese location keyword matches inside an unspaced location.
//
// Since #3930 every keyword edge that is a letter takes a word boundary. Han
// and kana are letters, but Chinese and Japanese write no separator between
// words, so the boundary rejected the keyword wherever the place name was
// followed or preceded by another character: `allow: [北京]` dropped "北京市"
// (what providers/meituan.mjs returns) and "北京市 海淀区" (providers/mokahr.mjs,
// which pairs the province with the district so that this very keyword can
// match), and `block: [上海]` let "上海市" through. The English equivalents
// ("Beijing, China", "Pudong, Shanghai") always matched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

const cases = [
  // [keyword, locations that contain the place, a location that does not]
  ['北京', ['北京', '北京市', '北京市海淀区', '中国北京', '北京市 海淀区', '北京市/上海市', '浙江 拱墅区/北京市 海淀区'], '上海市'],
  ['上海', ['上海市', '上海市浦东新区', '中国上海', '杭州/上海'], '北京市'],
  ['远程', ['远程', '远程办公', '全国远程', '远程（仅限国内）', '北京，可远程'], '北京市'],
  ['東京', ['東京', '東京都', '東京都渋谷区', '日本東京'], '大阪府'],
  ['リモート', ['リモート', 'フルリモート', 'リモート可'], '東京都'],
  ['とうきょう', ['とうきょうと'], 'おおさか'],
  // The long-vowel mark ー (U+30FC) has Script=Common and is shared by both kana.
  ['ニュージャージー', ['ニュージャージー', 'ニュージャージー州', '米国ニュージャージー州'], '東京都'],
];

for (const [keyword, containing, other] of cases) {
  test(`allow: [${keyword}] admits every location that names it`, () => {
    const accepts = buildLocationFilter({ allow: [keyword] });
    for (const location of containing) assert.equal(accepts(location), true, location);
    assert.equal(accepts(other), false, other);
  });

  test(`block and block_hard: [${keyword}] reject every location that names it`, () => {
    for (const tier of ['block', 'block_hard']) {
      const accepts = buildLocationFilter({ [tier]: [keyword] });
      for (const location of containing) assert.equal(accepts(location), false, `${tier}: ${location}`);
      assert.equal(accepts(other), true, `${tier}: ${other}`);
    }
  });

  test(`always_allow: [${keyword}] beats block for a location that names it`, () => {
    const accepts = buildLocationFilter({ always_allow: [keyword], block: [containing.at(-1)], allow: ['Neverland'] });
    for (const location of containing) assert.equal(accepts(location), true, location);
  });
}

test('control: the English keywords match the same places', () => {
  const allow = buildLocationFilter({ allow: ['Beijing'] });
  for (const location of ['Beijing', 'Beijing, China', 'Haidian District, Beijing', 'Beijing/Shanghai']) {
    assert.equal(allow(location), true, location);
  }
  const block = buildLocationFilter({ block: ['Shanghai'] });
  for (const location of ['Shanghai', 'Shanghai, China', 'Pudong, Shanghai']) {
    assert.equal(block(location), false, location);
  }
});

test('a Latin, Cyrillic or Hangul keyword still needs a word boundary', () => {
  assert.equal(buildLocationFilter({ allow: ['al'] })('Montréal'), false);
  assert.equal(buildLocationFilter({ allow: ['york'] })('Yorkshire'), false);
  assert.equal(buildLocationFilter({ allow: ['Омск'] })('Томск'), false);
  assert.equal(buildLocationFilter({ allow: ['서울'] })('서울특별시'), false);
  assert.equal(buildLocationFilter({ allow: ['서울'] })('서울, 대한민국'), true);
});

test('only the Han or kana edge loses its boundary on a mixed keyword', () => {
  // The Latin edge of "base北京" keeps its boundary; the Han edge does not.
  const accepts = buildLocationFilter({ allow: ['base北京'] });
  assert.equal(accepts('base北京市'), true);
  assert.equal(accepts('database北京市'), false);
  // A Latin keyword next to Han text is still a whole word.
  assert.equal(buildLocationFilter({ allow: ['remote'] })('北京 remote'), true);
});
