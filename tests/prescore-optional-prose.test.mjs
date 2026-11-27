import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJdSkills, extractJdSkillsByClass } from '../jd-skill-gap.mjs';

for (const newline of ['\n', '\r\n']) {
  const label = newline === '\n' ? 'LF' : 'CRLF';
  test(label + ': explicit not-required wording stays local to the requirement', () => {
    const jd = ['Requirements:', '- Rust is preferred but not required', '- Docker'].join(newline);
    const result = extractJdSkillsByClass(jd);
    assert.deepEqual(result.required, ['Docker']);
    assert.deepEqual(result.preferred, ['Rust']);
    assert.deepEqual(extractJdSkills(jd), ['Rust', 'Docker']);
  });
  test(label + ': a required skill is not optional merely because it mentions a plus', () => {
    const jd = ['Requirements:', '- Rust is required, not just a plus', '- Docker'].join(newline);
    assert.deepEqual(extractJdSkillsByClass(jd).required, ['Rust', 'Docker']);
    assert.deepEqual(extractJdSkillsByClass(jd).preferred, []);
  });
  test(label + ': bonus prose extracts its skill without changing the following bullet', () => {
    const jd = ['Requirements:', '- Python', 'Bonus points if you know Rust.', '- Docker'].join(newline);
    const result = extractJdSkillsByClass(jd);
    assert.deepEqual(extractJdSkills(jd), ['Python', 'Rust', 'Docker']);
    assert.deepEqual(result.required, ['Python', 'Docker']);
    assert.deepEqual(result.preferred, ['Rust']);
  });
  test(label + ': bonus separator still opens a preferred section', () => {
    const jd = ['Requirements:', '- Python', 'Bonus points:', '- Rust', '- Docker'].join(newline);
    const result = extractJdSkillsByClass(jd);
    assert.deepEqual(extractJdSkills(jd), ['Python', 'Rust', 'Docker']);
    assert.deepEqual(result.required, ['Python']);
    assert.deepEqual(result.preferred, ['Rust', 'Docker']);
    assert.equal(result.sawPreferred, true);
  });
}
