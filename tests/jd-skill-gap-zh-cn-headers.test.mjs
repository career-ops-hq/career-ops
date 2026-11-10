// tests/jd-skill-gap-zh-cn-headers.test.mjs — Simplified Chinese (zh-CN)
// requirement and closing headings must be recognized.
//
// REQUIREMENT_HEADER_RE's CJK list was written with Traditional code points
// (職 U+8077, 資 U+8CC7, 條 U+689D, 項 U+9805) even where the comment says
// "(zh-CN)". A Simplified posting spells the same headings with 职 U+804C,
// 资 U+8D44, 条 U+6761, 项 U+9879, so "职位要求" / "任职资格" never matched,
// no requirements block opened, and jd-skill-gap reported
// LOW CONFIDENCE (no-requirements-section) for every mainland-China JD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { extractJdSkills } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);

const BULLETS = '\n- 熟悉 Python 和 Kubernetes\n- 了解 Terraform\n';
const EXPECTED = ['Kubernetes', 'Python', 'Terraform'];

function assertExtracts(jd, label) {
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, EXPECTED, `${label}: expected ${EXPECTED.join(', ')}, got ${found.join(', ') || '(none)'}`);
}

test('control: the Traditional heading 職位要求 still works', () => {
  assertExtracts(`職位要求${BULLETS}`, 'zh-TW control');
});

for (const heading of ['职位要求', '岗位要求', '任职要求', '任职资格', '条件要求', '岗位基本要求', '职位要求:', '【任职要求】']) {
  test(`Simplified heading "${heading}" opens a requirements block`, () => {
    assertExtracts(`${heading}${BULLETS}`, heading);
  });
}

test('Simplified preferred heading 加分项 opens a block', () => {
  assertExtracts(`加分项${BULLETS}`, '加分项');
});

test('a Simplified closing heading (公司介绍) ends the requirements block', () => {
  const jd = `职位要求${BULLETS}\n公司介绍\n- 团队使用 Kafka 和 Flink\n`;
  assertExtracts(jd, 'zh-CN closer');
});
