import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJdSkills, extractJdSkillsByClass } from '../jd-skill-gap.mjs';

const headings = [
  'Preferred technical skills:', 'Preferred tools:', 'Bonus skills:',
  'Nice to have (any of):', '**Preferred**', '## Bonus points',
  'Preferred platforms：', '__Preferred tools__', '## Preferred tools for operating distributed services',
  '**Preferred tools for operating distributed services**',
  'Preferred Skills and Experience', 'Nice to have backend experience',
  'Bonus skills', 'Plus tools:', '【加分项】', '加分條件：',
  '## Preferred tools ##', 'Additional desired qualifications',
  'Preferred tools for operating large distributed services:',
  'It would be great if you have:',
];

const sentences = [
  'Preferred experience with Rust.', 'Plus Rust experience.',
  'Bonus points if you know Rust.', 'Nice to have Rust experience.',
  'Preferred experience with Rust!', 'Bonus points if you know Rust?',
  '**Preferred experience with Rust.**', '__Plus Rust experience!__',
  '## Preferred experience with Rust.', '## Bonus points if you know Rust?',
  '加分项 Rust。', '加分條件 Rust！',
  'Preferred experience with Rust in production systems',
  'Bonus points if you know Rust',
  'Nice to have experience with Rust',
  'Preferred Rust experience, especially in production',
  'Preferred Rust experience (especially in production)',
];

for (const newline of ['\n', '\r\n']) {
  const label = newline === '\n' ? 'LF' : 'CRLF';
  for (const heading of headings) {
    test(label + ': preferred heading shape: ' + heading, () => {
      for (const prefix of [['Requirements:', '- Python'], []]) {
        const jd = [...prefix, heading, '- Rust', '- Docker'].join(newline);
        const result = extractJdSkillsByClass(jd);
        assert.deepEqual(result.required, prefix.length ? ['Python'] : []);
        assert.deepEqual(result.preferred, ['Rust', 'Docker']);
        assert.equal(result.sawPreferred, true);
        assert.deepEqual(extractJdSkills(jd), prefix.length ? ['Python', 'Rust', 'Docker'] : ['Rust', 'Docker']);
      }
    });
  }
  for (const sentence of sentences) {
    test(label + ': preferred prose stays local: ' + sentence, () => {
      for (const spacing of [[], ['']]) {
        const jd = ['Requirements:', '- Python', ...spacing, sentence, ...spacing, '- Docker'].join(newline);
        const result = extractJdSkillsByClass(jd);
        assert.deepEqual(result.required, ['Python', 'Docker']);
        assert.deepEqual(result.preferred, ['Rust']);
        assert.equal(result.sawPreferred, false);
        assert.deepEqual(extractJdSkills(jd), ['Python', 'Rust', 'Docker']);
      }
    });
  }
  test(label + ': preferred bullet markers never switch the following block', () => {
    for (const bullet of ['- Preferred Rust:', '* **Preferred Rust:**', '1. Nice to have Rust:']) {
      const result = extractJdSkillsByClass(['Requirements:', '- Python', bullet, '- Docker'].join(newline));
      assert.deepEqual(result.required, ['Python', 'Docker']);
      assert.deepEqual(result.preferred, ['Rust']);
      assert.equal(result.sawPreferred, false);
    }
  });
  test(label + ': an inline preferred list retains its section scope', () => {
    const result = extractJdSkillsByClass(['Requirements:', '- Python', 'Preferred: Rust; Scala', '- Docker'].join(newline));
    assert.deepEqual(result.required, ['Python']);
    assert.deepEqual(result.preferred, ['Rust', 'Scala', 'Docker']);
  });
}
