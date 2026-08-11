import assert from 'node:assert/strict';
import { buildTailoringHintBlock, classifyRoleTailoringTarget } from '../role-tailoring-hints.mjs';

const people = classifyRoleTailoringTarget({
  roleTitle: 'Employee Success Business Partner Sr. Director',
  jdText: 'Lead compensation reviews, workforce planning, and succession planning for People leaders.',
});
assert.equal(people.key, 'people_hr');

const peopleHint = buildTailoringHintBlock({
  roleTitle: 'Employee Success Business Partner Sr. Director',
  jdText: 'Lead compensation reviews, workforce planning, and succession planning for People leaders.',
});
assert.match(peopleHint, /hard negative filter/i);
assert.match(peopleHint, /AI\/agentic\/homelab/i);

const generic = classifyRoleTailoringTarget({
  roleTitle: 'Director, Enterprise Transformation',
  jdText: 'Lead program management, transformation, and stakeholder alignment.',
});
assert.equal(generic.key, 'default');
assert.equal(buildTailoringHintBlock(generic), '');

console.log('role-tailoring-hints tests passed');
