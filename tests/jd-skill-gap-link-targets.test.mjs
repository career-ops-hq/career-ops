// tests/jd-skill-gap-link-targets.test.mjs — jd-skill-gap reads a markdown
// link's text, not its target, when it looks for a skill in cv.md.
//
// "[infrastructure modules](https://github.com/jane/terraform-modules)" put
// Terraform in supportedByResume through its URL alone. modes/pdf.md offers
// supportedByResume skills to the tailored CV's Skills section, so a CV that
// never names Terraform could gain it there. verify-cv-facts.mjs already reads
// link text only (#6606).
//
// Run:  node --test tests/jd-skill-gap-link-targets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { classifySkillGaps } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);

const cv = (experience, skills = 'Go, Docker, Linux') => [
  '# Jane Doe', '', '## Experience', '', '### Acme — Remote', '**Platform Engineer**', '2021 – present',
  experience, '', '## Skills', skills, '',
].join('\n');

const bucketOf = (result, skill) =>
  ['existing', 'supportedByResume', 'gap'].find((b) => result[b].includes(skill));

test('a skill named only in an inline link target is a gap', () => {
  const r = classifySkillGaps(['Terraform'], cv(
    '- Wrote the [infrastructure modules](https://github.com/jane/terraform-modules) the team still uses.'));
  assert.equal(bucketOf(r, 'Terraform'), 'gap');
});

test('a skill named only in a reference link definition is a gap', () => {
  const r = classifySkillGaps(['Terraform'], cv([
    '- Wrote the [infrastructure modules][tf] the team still uses.',
    '',
    '[tf]: https://github.com/jane/terraform-modules "Modules"',
  ].join('\n')));
  assert.equal(bucketOf(r, 'Terraform'), 'gap');
});

test('a link target holding balanced parentheses is dropped whole', () => {
  // The skill sits after the inner pair: a target cut at the first ")" would
  // leave "/kubernetes)" in the text.
  const r = classifySkillGaps(['Kubernetes'], cv(
    '- Followed the [scheduling notes](https://example.org/(notes)/kubernetes) for the rollout.'));
  assert.equal(bucketOf(r, 'Kubernetes'), 'gap');
});

test('a skill in the link text still counts', () => {
  const r = classifySkillGaps(['Terraform'], cv(
    '- Wrote the [Terraform modules](https://github.com/jane/infra) the team still uses.'));
  assert.equal(bucketOf(r, 'Terraform'), 'supportedByResume');
});

test('a skill linked in the Skills section is still a named skill', () => {
  const r = classifySkillGaps(['Kubernetes'], cv('- Ran the deployment pipeline.', 'Go, [Kubernetes](https://kubernetes.io), Linux'));
  assert.equal(bucketOf(r, 'Kubernetes'), 'existing');
});

test('a URL written out in the text is read, because a reader sees it', () => {
  const r = classifySkillGaps(['Terraform'], cv(
    '- Wrote the infrastructure modules at github.com/jane/terraform-modules.'));
  assert.equal(bucketOf(r, 'Terraform'), 'supportedByResume');
});
